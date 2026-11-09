// ---- Hisaab core logic (pure functions) ----
// All money is whole rupees (integers), so every total is exact.

// Split `amount` among `participants` exactly. Everyone gets the same
// whole-rupee share; the few leftover rupees (fewer than the number of
// people) go one each, starting with the payer if he is included.
// Shares always add up to exactly `amount` and differ by at most Rs 1.
function splitAmount(amount, participants, payer) {
  amount = Math.round(Number(amount));
  var list = [];
  participants.forEach(function (p) { if (list.indexOf(p) < 0) list.push(p); });
  var n = list.length;
  if (!n) return {};
  var order = list.indexOf(payer) >= 0
    ? [payer].concat(list.filter(function (p) { return p !== payer; }))
    : list.slice();
  var base = Math.floor(amount / n);
  var rem = amount - base * n;
  var shares = {};
  order.forEach(function (p, i) { shares[p] = base + (i < rem ? 1 : 0); });
  return shares;
}

// A payment only counts once the receiver has approved it.
// (Old payments without a status count as approved.)
function isCounted(p) { return !p.status || p.status === "approved"; }

// Net balance per member: positive = will receive, negative = has to pay.
function computeBalances(memberIds, expenses, payments) {
  var net = {};
  memberIds.forEach(function (id) { net[id] = 0; });
  var add = function (id, v) { net[id] = (net[id] || 0) + v; };
  expenses.forEach(function (e) {
    add(e.paidBy, Number(e.amount) || 0);
    var sh = e.shares || {};
    Object.keys(sh).forEach(function (id) { add(id, -(Number(sh[id]) || 0)); });
  });
  payments.filter(isCounted).forEach(function (p) {
    var a = Number(p.amount) || 0;
    add(p.from, a);
    add(p.to, -a);
  });
  return net;
}

// Who owes whom, person to person. Every expense creates a debt from each
// eater to the payer; debts in both directions between the same two people
// cancel out. So if Sohaib owes you Rs 100 and tomorrow he pays for a meal
// where your share is Rs 100, the two of you are even automatically.
// Approved payments reduce the debt. Returns [{from, to, amount}], amount > 0.
function pairwiseDebts(expenses, payments) {
  var bal = {}; // key "a|b" with a < b: positive => a owes b
  function owe(from, to, v) {
    if (!from || !to || from === to || !v) return;
    if (from < to) bal[from + "|" + to] = (bal[from + "|" + to] || 0) + v;
    else bal[to + "|" + from] = (bal[to + "|" + from] || 0) - v;
  }
  expenses.forEach(function (e) {
    var sh = e.shares || {};
    Object.keys(sh).forEach(function (id) { owe(id, e.paidBy, Number(sh[id]) || 0); });
  });
  payments.filter(isCounted).forEach(function (p) {
    // money handed from -> to: the receiver now owes it back
    owe(p.to, p.from, Number(p.amount) || 0);
  });
  var out = [];
  Object.keys(bal).forEach(function (k) {
    var v = bal[k], ab = k.split("|");
    if (v > 0) out.push({ from: ab[0], to: ab[1], amount: v });
    else if (v < 0) out.push({ from: ab[1], to: ab[0], amount: -v });
  });
  out.sort(function (x, y) { return y.amount - x.amount || (x.from + x.to < y.from + y.to ? -1 : 1); });
  return out;
}

// For one person: who owes him (receive) and whom he owes (pay).
function personSummary(id, pairs) {
  var receive = pairs.filter(function (p) { return p.to === id; });
  var pay = pairs.filter(function (p) { return p.from === id; });
  var sum = function (l) { return l.reduce(function (a, p) { return a + p.amount; }, 0); };
  return { receive: receive, pay: pay, toReceive: sum(receive), toPay: sum(pay) };
}

// Everything that makes up the balance between `me` and `other`, item by item.
// amount > 0: this item means `other` owes me more; amount < 0: I owe `other` more.
// The items always add up to exactly the pairwise balance shown on the home screen.
function pairBreakdown(me, other, expenses, payments) {
  var items = [];
  expenses.forEach(function (e) {
    var sh = e.shares || {};
    if (e.paidBy === me && sh[other]) {
      items.push({ kind: "expense", id: e.id, date: e.date, createdAt: e.createdAt || 0, note: e.note, meal: e.meal,
        paidBy: me, total: Number(e.amount) || 0, share: Number(sh[other]) || 0, amount: Number(sh[other]) || 0 });
    } else if (e.paidBy === other && sh[me]) {
      items.push({ kind: "expense", id: e.id, date: e.date, createdAt: e.createdAt || 0, note: e.note, meal: e.meal,
        paidBy: other, total: Number(e.amount) || 0, share: Number(sh[me]) || 0, amount: -(Number(sh[me]) || 0) });
    }
  });
  payments.forEach(function (p) {
    var involved = (p.from === other && p.to === me) || (p.from === me && p.to === other);
    if (!involved) return;
    var a = Number(p.amount) || 0;
    items.push({ kind: "payment", id: p.id, date: p.date, createdAt: p.createdAt || 0, from: p.from, to: p.to, method: p.method,
      status: p.status || "approved", counted: isCounted(p), amount: isCounted(p) ? (p.from === other ? -a : a) : 0, paid: a });
  });
  items.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : x.createdAt - y.createdAt; });
  var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
  return { items: items, total: total };
}

// Per-member totals for a set of expenses/payments (e.g. one month).
function memberTotals(memberIds, expenses, payments) {
  var t = {};
  var get = function (id) { return t[id] || (t[id] = { paid: 0, share: 0, sent: 0, received: 0 }); };
  memberIds.forEach(get);
  expenses.forEach(function (e) {
    get(e.paidBy).paid += Number(e.amount) || 0;
    var sh = e.shares || {};
    Object.keys(sh).forEach(function (id) { get(id).share += Number(sh[id]) || 0; });
  });
  payments.filter(isCounted).forEach(function (p) {
    get(p.from).sent += Number(p.amount) || 0;
    get(p.to).received += Number(p.amount) || 0;
  });
  return t;
}

// ---- Payment accounts (Easypaisa / JazzCash / bank / other) ----
// The database checks exactly the same rules (supabase/migrations/004_payment_accounts.sql).
var ACCOUNT_KINDS = ["easypaisa", "jazzcash", "bank", "other"];

// Tidy what someone typed: no spaces or dashes; +92 / 0092 / 92 mobile numbers become 03…;
// bank numbers in capitals (IBANs start with PK).
function cleanAccountNumber(kind, raw) {
  var s = String(raw == null ? "" : raw).replace(/[\s-]/g, "");
  if (kind === "easypaisa" || kind === "jazzcash") return s.replace(/^(\+92|0092|92)(3\d{9})$/, "0$2");
  if (kind === "bank") return s.toUpperCase();
  return s;
}
function cleanText(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

// Pakistani IBAN: PK + 2 check digits + 4-letter bank code + 16 characters, valid mod-97 checksum.
// The checksum catches any single mistyped character and any two swapped neighbours.
function ibanOk(v) {
  if (!/^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/.test(v)) return false;
  var s = v.slice(4) + v.slice(0, 4), r = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    r = c >= 48 && c <= 57 ? (r * 10 + c - 48) % 97 : (r * 100 + c - 55) % 97;
  }
  return r === 1;
}

// "" when the account is fine, otherwise what's wrong in plain words.
function accountProblem(a) {
  var kind = a.kind, provider = cleanText(a.provider), title = cleanText(a.title);
  var n = cleanAccountNumber(kind, a.number);
  if (ACCOUNT_KINDS.indexOf(kind) < 0) return "Pick the type of account.";
  if (kind === "bank" && !provider) return "Pick the bank.";
  if (kind === "other" && !provider) return "Write which app or service it is.";
  if (provider.length > 30) return "That name is too long.";
  if (!n) return kind === "easypaisa" || kind === "jazzcash" ? "Enter the mobile number." : "Enter the account number.";
  if (kind === "easypaisa" || kind === "jazzcash") {
    if (!/^03\d{9}$/.test(n)) return "Enter the mobile number like 03001234567 (11 digits).";
  } else if (kind === "bank") {
    if (/^PK/.test(n)) {
      if (n.length !== 24) return "An IBAN has 24 characters. This one has " + n.length + ".";
      if (!ibanOk(n)) return "That IBAN has a mistake. Check it again.";
    } else if (!/^\d{6,20}$/.test(n)) return "Enter the account number (6 to 20 digits) or the IBAN.";
  } else if (!/^[0-9A-Za-z@._+]{4,34}$/.test(n)) return "That account number doesn't look right.";
  if (title.length < 2) return "Write the name on the account.";
  if (title.length > 40) return "The name is too long (40 letters at most).";
  return "";
}

// How a number is shown: 0300 1234567 · PK36 SCBL 0000 0011 2345 6702 · others as they are.
// (Copying always uses the plain number, which every app accepts.)
function formatAccountNumber(n) {
  n = String(n || "");
  if (/^03\d{9}$/.test(n)) return n.slice(0, 4) + " " + n.slice(4);
  if (/^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/.test(n)) return n.replace(/(.{4})(?!$)/g, "$1 ");
  return n;
}
function accountLabel(a) {
  if (a.kind === "easypaisa") return "Easypaisa";
  if (a.kind === "jazzcash") return "JazzCash";
  return a.provider || (a.kind === "bank" ? "Bank" : "Other");
}
// What the payment form should pre-select after paying into this account.
function methodForAccount(a) { return a.kind === "easypaisa" ? "Easypaisa" : a.kind === "jazzcash" ? "JazzCash" : "Bank"; }
// One person's accounts: preferred first, then in the order they were added.
function accountsFor(memberId, accounts) {
  return accounts.filter(function (a) { return a.memberId === memberId; })
    .sort(function (x, y) { return (y.primary ? 1 : 0) - (x.primary ? 1 : 0) || x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1); });
}
// Details added or changed in the last `days` days: payers are asked to double-check those.
function recentlyChanged(a, nowMs, days) { return !!a.updatedAt && nowMs - a.updatedAt < days * 864e5; }

if (typeof module !== "undefined") {
  module.exports = { splitAmount: splitAmount, isCounted: isCounted, computeBalances: computeBalances,
    pairwiseDebts: pairwiseDebts, personSummary: personSummary, pairBreakdown: pairBreakdown, memberTotals: memberTotals,
    cleanAccountNumber: cleanAccountNumber, cleanText: cleanText, ibanOk: ibanOk, accountProblem: accountProblem, formatAccountNumber: formatAccountNumber,
    accountLabel: accountLabel, methodForAccount: methodForAccount, accountsFor: accountsFor, recentlyChanged: recentlyChanged };
}
