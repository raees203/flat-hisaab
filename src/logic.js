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

if (typeof module !== "undefined") {
  module.exports = { splitAmount: splitAmount, isCounted: isCounted, computeBalances: computeBalances,
    pairwiseDebts: pairwiseDebts, personSummary: personSummary, pairBreakdown: pairBreakdown, memberTotals: memberTotals };
}
