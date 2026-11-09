// Seeds a realistic flat into the in-browser mock, then hands the app a client signed in as Raees (owner).
(function () {
  var M = window.SBMOCK, db = M.db;
  var me = "raees-uid", now = Date.now(), d = function (n) { var x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  var flat = { id: "f1", name: "Markhor Flat", code: "MRK7Q2", owner_id: me, created_at: new Date().toISOString() };
  db.flats.push(flat);
  var names = ["Raees", "Sohaib", "Muhammad Abdullah Khan", "Zain", "Ali"];
  var uids = [me, "s-uid", "a-uid", "z-uid", null];
  names.forEach(function (n, i) { db.members.push({ id: "m" + i, flat_id: "f1", name: n, user_id: uids[i], active: true, created_at: new Date(now + i).toISOString() }); });
  ["raees-uid", "s-uid", "a-uid", "z-uid"].forEach(function (u) { db.flat_users.push({ flat_id: "f1", user_id: u }); });
  function ex(id, by, amt, day, meal, note, parts) {
    var sh = splitAmount(amt, parts, by);
    db.expenses.push({ id: id, flat_id: "f1", amount: amt, paid_by: by, date: d(day), meal: meal, note: note, shares: sh, receipt_path: null, created_by: by === "m0" ? me : "x", created_by_member: by, created_at: new Date(now - day * 864e5).toISOString() });
  }
  ex("e1", "m0", 1500, 3, "lunch", "Roti and daal", ["m0", "m1", "m2"]);
  ex("e2", "m1", 2400, 2, "dinner", "Chicken karahi", ["m0", "m1", "m2", "m3"]);
  ex("e3", "m0", 1000, 1, "dinner", "Vegetables", ["m0", "m2"]);
  ex("e4", "m3", 650, 0, "nashta", "Doodh, anday, paratha", ["m0", "m1", "m3"]);
  ex("e5", "m2", 3200, 0, "other", "Gas cylinder refill", ["m0", "m1", "m2", "m3", "m4"]);
  var e1 = db.expenses.find(function (e) { return e.id === "e1"; });
  e1.disputed_by = "m1"; e1.dispute_note = "I only had half"; e1.disputed_at = new Date().toISOString();
  db.payments.push({ id: "p1", flat_id: "f1", from_member: "m1", to_member: "m0", amount: 500, method: "JazzCash", date: d(0), status: "pending", created_by: "s-uid", created_by_member: "m1", created_at: new Date().toISOString() });
  db.payments.push({ id: "p2", flat_id: "f1", from_member: "m3", to_member: "m0", amount: 300, method: "Cash", date: d(1), status: "approved", created_by: me, created_by_member: "m0", created_at: new Date().toISOString() });
  // payment accounts: Sohaib (Raees owes him Rs 100) has Easypaisa + a Meezan IBAN changed yesterday; Raees has two
  var old = new Date(now - 20 * 864e5).toISOString(), yday = new Date(now - 864e5).toISOString();
  function acc(id, m, kind, provider, title, number, primary, upd) {
    db.payment_accounts.push({ id: id, flat_id: "f1", member_id: m, kind: kind, provider: provider, title: title, number: number, is_primary: primary, created_at: old, updated_at: upd || old });
  }
  acc("a1", "m1", "easypaisa", "", "Sohaib Khan", "03001234567", true);
  acc("a2", "m1", "bank", "Meezan Bank", "Sohaib Khan Niazi", "PK23MEZN0001020104567890", false, yday);
  acc("a3", "m0", "jazzcash", "", "Raees Ahmad", "03211234567", true);
  acc("a4", "m0", "bank", "HBL", "Raees Ahmad", "PK72HABB0012345678901234", false);
  var client = M.makeClient("raees");
  client.auth.signInAnonymously().then(function (r) { r.data.session.user.id = me; });
  client.auth.getSession = async function () { return { data: { session: { user: { id: me } } } }; };
  window.supabase = { createClient: function () { return client; } };
  window.HISAAB_CONFIG = { url: "https://x.supabase.co", anonKey: "k", webUrl: "https://raees203.github.io/flat-hisaab/" };
})();
