// In-memory stand-in for supabase-js that mirrors the real schema's rules,
// shared between several simulated phones.
const crypto = require("crypto");
const LG = typeof window !== "undefined" ? window : require("../src/logic.js");   // same number checks as the app
const db = { flats: [], flat_users: [], members: [], expenses: [], payments: [], attendance: [], payment_accounts: [] };
const files = {};
const channels = new Set();
const now = () => new Date().toISOString();
const isMember = (uid, f) => db.flat_users.some((x) => x.flat_id === f && x.user_id === uid);
const memberOf = (id) => db.members.find((m) => m.id === id);
function emit(table) { setTimeout(() => channels.forEach((c) => c.fire(table)), 5); }
const err = (message) => ({ data: null, error: { message } });
// payment_accounts guard, as in 004_payment_accounts.sql
function accountGuard(r, old) {
  if (old && (r.member_id !== old.member_id || r.flat_id !== old.flat_id)) return "An account can't be moved to someone else";
  r.title = LG.cleanText(r.title);
  r.provider = r.kind === "easypaisa" || r.kind === "jazzcash" ? "" : LG.cleanText(r.provider);
  r.number = LG.cleanAccountNumber(r.kind, r.number);
  const p = LG.accountProblem(r);
  if (p) return p;
  if (db.payment_accounts.some((a) => a.member_id === r.member_id && a.kind === r.kind && a.number === r.number && a.id !== r.id)) return "You already saved this account";
  return "";
}

function makeClient(phone) {
  let session = null;
  const uid = () => session && session.user.id;
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.ret = false; this.single = false; this.rng = null; }
    select() { if (this.op !== "select") this.ret = true; return this; }
    eq(c, v) { this.f.push([c, v]); return this; }
    order() { return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.single = true; return this; }
    insert(p) { this.op = "insert"; this.p = p; return this; }
    update(p) { this.op = "update"; this.p = p; return this; }
    upsert(p) { this.op = "upsert"; this.p = p; return this; }
    delete() { this.op = "delete"; return this; }
    then(a, b) { return new Promise((r) => setTimeout(() => r(this.run()), 2)).then(a, b); }
    rows() {
      const visible = db[this.t].filter((r) => {
        const f = this.t === "flats" ? r.id : r.flat_id;
        return isMember(uid(), f);
      });
      return visible.filter((r) => this.f.every(([c, v]) => r[c] === v));
    }
    run() {
      const t = this.t, u = uid();
      if (this.op === "select") {
        let rows = this.rows();
        if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
        return { data: this.single ? rows[0] || null : JSON.parse(JSON.stringify(rows)), error: null };
      }
      if (this.op === "insert" || this.op === "upsert") {
        const r = { ...this.p };
        if (!isMember(u, r.flat_id)) return err("new row violates row-level security policy for table \"" + t + "\"");
        const owner = (db.flats.find((f) => f.id === r.flat_id) || {}).owner_id === u;
        const mine = (id) => { const m = memberOf(id); return !!m && m.user_id === u; };
        const rls = () => err("new row violates row-level security policy for table \"" + t + "\"");
        if (t === "members") {
          if (r.user_id && r.user_id !== u) return err("You can only link a name to your own phone");
          const hasMe = db.members.some((m) => m.flat_id === r.flat_id && m.user_id === u);
          if (!((owner && !r.user_id) || (r.user_id === u && !hasMe))) return rls();
          Object.assign(r, { id: crypto.randomUUID(), active: true, created_at: now(), user_id: r.user_id || null });
        }
        if (t === "attendance" && !(mine(r.member_id) || owner)) return rls();
        if (t === "expenses" && !(mine(r.paid_by) || (owner && !(memberOf(r.paid_by) || {}).user_id))) return rls();
        if (t === "payments" && !(mine(r.from_member) || mine(r.to_member))) return rls();
        if (t === "payment_accounts") {
          if (!mine(r.member_id)) return rls();
          const e = accountGuard(r, null);
          if (e) return err(e);
          const list = db.payment_accounts.filter((a) => a.member_id === r.member_id);
          if (list.length >= 5) return err("You can save up to 5 accounts");
          const ts = now();
          Object.assign(r, { id: crypto.randomUUID(), created_at: ts, updated_at: ts, is_primary: !list.length || !!r.is_primary });
          if (r.is_primary) list.forEach((a) => { a.is_primary = false; });
        }
        if (t === "expenses") {
          const sum = Object.values(r.shares).reduce((a, b) => a + b, 0);
          if (sum !== r.amount) return err(`Shares (${sum}) must add up exactly to the amount (${r.amount})`);
          Object.assign(r, { id: crypto.randomUUID(), created_at: now(), created_by: u, created_by_member: (db.members.find((m) => m.flat_id === r.flat_id && m.user_id === u) || {}).id || null });
        }
        if (t === "payments") {
          const rec = memberOf(r.to_member);
          r.status = rec && rec.user_id === u ? "approved" : "pending";
          Object.assign(r, { id: crypto.randomUUID(), created_at: now(), created_by: u, created_by_member: (db.members.find((m) => m.flat_id === r.flat_id && m.user_id === u) || {}).id || null });
        }
        if (t === "attendance" && this.op === "upsert") {
          const i = db.attendance.findIndex((a) => a.flat_id === r.flat_id && a.date === r.date && a.member_id === r.member_id);
          if (i >= 0) db.attendance[i] = r; else db.attendance.push(r);
        } else db[t].push(r);
        emit(t);
        return { data: this.ret ? [{ id: r.id }] : null, error: null };
      }
      if (this.op === "update") {
        let rows = this.rows();
        const ownerOf = (f) => (db.flats.find((x) => x.id === f) || {}).owner_id === u;
        if (t === "flats") rows = rows.filter((r) => r.owner_id === u);
        if (t === "payments") rows = rows.filter((r) => (memberOf(r.to_member) || {}).user_id === u);
        if (t === "payment_accounts") {
          rows = rows.filter((r) => (memberOf(r.member_id) || {}).user_id === u);
          for (const r of rows) {
            const next = { ...r, ...this.p };
            const e = accountGuard(next, r);
            if (e) return err(e);
            if (r.is_primary && next.is_primary === false) return err("Make another account preferred instead");
            if (["kind", "provider", "title", "number"].some((k) => next[k] !== r[k])) next.updated_at = new Date(Math.max(Date.now(), Date.parse(r.updated_at) + 1)).toISOString();
            if (next.is_primary && !r.is_primary) db.payment_accounts.forEach((a) => { if (a.member_id === r.member_id && a !== r) a.is_primary = false; });
            Object.assign(r, next);
          }
          emit(t);
          return { data: this.ret ? rows.map((r) => ({ id: r.id })) : null, error: null };
        }
        if (t === "expenses") {
          const myMem = (f) => (db.members.find((m) => m.flat_id === f && m.user_id === u) || {}).id;
          for (const r of rows) {
            const keys = Object.keys(this.p);
            if (keys.some((k) => !["disputed_by", "dispute_note"].includes(k))) return err("An expense can't be edited. Delete it and add it again.");
            if (!r.disputed_by && this.p.disputed_by) {
              if (this.p.disputed_by !== myMem(r.flat_id)) return err("You can only report as yourself");
              if (!(this.p.disputed_by in r.shares)) return err("Only people who are part of this expense can report it");
              if (r.created_by === u) return err("You added this expense, so you can delete it instead");
              r.disputed_at = now();
            } else if (r.disputed_by && this.p.disputed_by === null) {
              if (!(r.created_by === u || r.disputed_by === myMem(r.flat_id))) return err("Only the person who added it or who reported it can clear this");
              r.disputed_at = null;
            } else return err("This expense has already been reported");
          }
        }
        for (const r of rows) {
          if (t === "members" && ("name" in this.p || "active" in this.p) && !(ownerOf(r.flat_id) || r.user_id === u)) return err("Only the flat owner or that person can change this");
          if (t === "payments") {
            if (r.status !== "pending") return err("Only pending payments can be approved or rejected");
            if ((memberOf(r.to_member) || {}).user_id !== u) return err("Only the person who received the money can approve it");
          }
          Object.assign(r, this.p);
        }
        emit(t);
        return { data: this.ret ? rows.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (this.op === "delete") {
        const rows = this.rows().filter((r) => {
          const owner = (db.flats.find((f) => f.id === r.flat_id) || {}).owner_id === u;
          const myMem = (db.members.find((m) => m.flat_id === r.flat_id && m.user_id === u) || {}).id;
          if (t === "expenses") return r.created_by === u || (owner && r.disputed_by && r.disputed_by !== myMem);
          if (t === "payments") return r.status !== "approved" && r.created_by === u;
          if (t === "payment_accounts") return (memberOf(r.member_id) || {}).user_id === u;
          return false;
        });
        db[t] = db[t].filter((r) => !rows.includes(r));
        if (t === "payment_accounts") rows.forEach((d) => {
          const left = db.payment_accounts.filter((a) => a.member_id === d.member_id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
          if (left.length && !left.some((a) => a.is_primary)) left[0].is_primary = true;
        });
        emit(t);
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
    }
  }
  const rpcs = {
    create_flat({ p_name, p_members, p_me }) {
      const f = { id: crypto.randomUUID(), name: p_name, code: Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(6, "Q"), owner_id: uid(), created_at: now() };
      db.flats.push(f); db.flat_users.push({ flat_id: f.id, user_id: uid() });
      p_members.forEach((n, i) => db.members.push({ id: crypto.randomUUID(), flat_id: f.id, name: n, user_id: i + 1 === p_me ? uid() : null, active: true, created_at: new Date(Date.now() + i).toISOString() }));
      return f.id;
    },
    join_flat({ p_code }) {
      const f = db.flats.find((x) => x.code === p_code.toUpperCase());
      if (!f) throw new Error("No flat with that code");
      if (!isMember(uid(), f.id)) db.flat_users.push({ flat_id: f.id, user_id: uid() });
      return f.id;
    },
    claim_member({ p_member }) {
      const m = memberOf(p_member);
      if (m.user_id && m.user_id !== uid()) throw new Error("That name is linked to another phone");
      db.members.forEach((x) => { if (x.flat_id === m.flat_id && x.user_id === uid()) x.user_id = null; });
      m.user_id = uid(); emit("members");
    },
    unlink_member({ p_member }) { const m = memberOf(p_member); m.user_id = null; emit("members"); },
  };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => { session = { user: { id: phone + "-" + crypto.randomUUID().slice(0, 4) } }; return { data: { session }, error: null }; },
    },
    from: (t) => new Q(t),
    rpc: async (name, args) => { try { return { data: rpcs[name](args), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
    storage: { from: () => ({
      upload: async (path, blob) => { files[path] = blob; return { data: { path }, error: null }; },
      createSignedUrl: async (path) => ({ data: files[path] ? { signedUrl: "blob:fake/" + path } : null, error: files[path] ? null : { message: "not found" } }),
      remove: async (paths) => { paths.forEach((p) => delete files[p]); return { error: null }; },
    }) },
    channel() {
      const subs = [];
      const ch = { on(_t, opts, cb) { subs.push([opts.table, cb]); return ch; }, subscribe() { channels.add(ch); return ch; }, fire(table) { subs.filter((s) => s[0] === table).forEach((s) => s[1]()); } };
      return ch;
    },
    removeChannel(ch) { channels.delete(ch); },
  };
}
module.exports = { makeClient, db, files };
