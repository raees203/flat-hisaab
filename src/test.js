const assert = require("assert");
const L = require("./logic.js");
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// --- exact splits ---
assert.deepStrictEqual(L.splitAmount(1200, ["a", "b", "c", "d"], "a"), { a: 300, b: 300, c: 300, d: 300 });
assert.deepStrictEqual(L.splitAmount(1000, ["a", "b", "c"], "a"), { a: 334, b: 333, c: 333 });
assert.deepStrictEqual(L.splitAmount(1001, ["b", "a", "c"], "c"), { c: 334, b: 334, a: 333 });
assert.deepStrictEqual(L.splitAmount(500, ["b", "c", "d"], "a"), { b: 167, c: 167, d: 166 }); // payer not eating
assert.deepStrictEqual(L.splitAmount(2, ["a", "b", "c"], "a"), { a: 1, b: 1, c: 0 });

// --- Sohaib scenario: he owes me 100 today, tomorrow he pays for food ---
let ex = [{ paidBy: "me", amount: 200, shares: { me: 100, sohaib: 100 } }];
let pairs = L.pairwiseDebts(ex, []);
assert.deepStrictEqual(pairs, [{ from: "sohaib", to: "me", amount: 100 }]);
ex.push({ paidBy: "sohaib", amount: 200, shares: { me: 100, sohaib: 100 } });
pairs = L.pairwiseDebts(ex, []);
assert.deepStrictEqual(pairs, [], "Sohaib's spending should cancel his Rs 100 debt");
// partial offset: next meal my share is only 60 -> he still owes me 40
pairs = L.pairwiseDebts([ex[0], { paidBy: "sohaib", amount: 180, shares: { me: 60, sohaib: 60, ali: 60 } }], []);
assert.deepStrictEqual(pairs.find((p) => p.to === "me" || p.from === "me"), { from: "sohaib", to: "me", amount: 40 });

// --- approvals: pending / rejected payments don't count ---
const base = [{ paidBy: "ali", amount: 300, shares: { ali: 100, hamza: 100, usman: 100 } }];
const pend = [{ from: "hamza", to: "ali", amount: 100, status: "pending" }];
assert.strictEqual(L.computeBalances(["ali", "hamza", "usman"], base, pend).hamza, -100);
assert.strictEqual(L.pairwiseDebts(base, pend).length, 2);
const ok = [{ from: "hamza", to: "ali", amount: 100, status: "approved" }];
assert.strictEqual(L.computeBalances(["ali", "hamza", "usman"], base, ok).hamza, 0);
assert.deepStrictEqual(L.pairwiseDebts(base, ok), [{ from: "usman", to: "ali", amount: 100 }]);
const rej = [{ from: "hamza", to: "ali", amount: 100, status: "rejected" }];
assert.strictEqual(L.computeBalances(["ali", "hamza", "usman"], base, rej).hamza, -100);
// overpayment flips the direction
assert.deepStrictEqual(L.pairwiseDebts(base, [{ from: "hamza", to: "ali", amount: 150 }]).find((p) => p.to === "hamza"), { from: "ali", to: "hamza", amount: 50 });

// --- randomized property tests ---
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
for (let run = 0; run < 3000; run++) {
  const n = ri(2, 8);
  const ids = Array.from({ length: n }, (_, i) => "m" + i);
  const exps = [], pays = [];
  for (let k = ri(1, 25); k > 0; k--) {
    const parts = ids.filter(() => rnd() < 0.7);
    if (!parts.length) parts.push(ids[ri(0, n - 1)]);
    const payer = ids[ri(0, n - 1)];
    const amount = ri(1, 50000);
    const shares = L.splitAmount(amount, parts, payer);
    // exactness of every split
    assert.strictEqual(sum(shares), amount);
    const v = Object.values(shares);
    assert.ok(v.every((x) => Number.isInteger(x) && x >= 0));
    assert.ok(Math.max(...v) - Math.min(...v) <= 1);
    assert.deepStrictEqual(Object.keys(shares).sort(), [...new Set(parts)].sort());
    exps.push({ paidBy: payer, amount, shares });
  }
  for (let k = ri(0, 6); k > 0; k--) {
    const a = ids[ri(0, n - 1)];
    let b = ids[ri(0, n - 1)];
    if (a === b) continue;
    pays.push({ from: a, to: b, amount: ri(1, 20000), status: ["approved", "pending", "rejected", undefined][ri(0, 3)] });
  }
  const net = L.computeBalances(ids, exps, pays);
  assert.strictEqual(sum(net), 0, "balances must sum to zero");
  const pr = L.pairwiseDebts(exps, pays);
  // at most one direction per pair, all positive integers
  const seen = new Set();
  pr.forEach((p) => {
    const k = [p.from, p.to].sort().join("|");
    assert.ok(!seen.has(k)); seen.add(k);
    assert.ok(Number.isInteger(p.amount) && p.amount > 0);
  });
  // each person's (receive - pay) equals his overall balance
  ids.forEach((id) => {
    const s = L.personSummary(id, pr);
    assert.strictEqual(s.toReceive - s.toPay, net[id]);
  });
  // settling every pair exactly brings everyone to zero
  const settled = L.pairwiseDebts(exps, pays.concat(pr.map((p) => ({ from: p.from, to: p.to, amount: p.amount, status: "approved" }))));
  assert.deepStrictEqual(settled, []);
  const after = L.computeBalances(ids, exps, pays.concat(pr.map((p) => ({ ...p, status: "approved" }))));
  assert.ok(Object.values(after).every((x) => x === 0));
}
// --- breakdown: the example from the flat (Ali owes me 1000 = 500 roti + 500 chicken) ---
{
  const ex = [
    { id: "e1", paidBy: "me", amount: 1500, date: "2026-11-05", note: "roti", shares: { me: 500, ali: 500, zain: 500 } },
    { id: "e2", paidBy: "me", amount: 1000, date: "2026-11-06", note: "chicken", shares: { me: 500, ali: 500 } },
  ];
  const b = L.pairBreakdown("me", "ali", ex, []);
  assert.deepStrictEqual(b.items.map((i) => [i.note, i.amount]), [["roti", 500], ["chicken", 500]]);
  assert.strictEqual(b.total, 1000);
  const b2 = L.pairBreakdown("ali", "me", ex, [{ id: "p", from: "ali", to: "me", amount: 300, date: "2026-11-07", status: "pending" }]);
  assert.strictEqual(b2.total, -1000, "pending payment shown but not counted");
  assert.strictEqual(b2.items[2].kind, "payment"); assert.strictEqual(b2.items[2].amount, 0);
}
// --- breakdown always matches the pairwise balance, for every pair, in random flats ---
seed = 999;
for (let run = 0; run < 1500; run++) {
  const n = ri(2, 7);
  const ids = Array.from({ length: n }, (_, i) => "m" + i);
  const exps = [], pays = [];
  for (let k = ri(1, 20); k > 0; k--) {
    const parts = ids.filter(() => rnd() < 0.6); if (!parts.length) parts.push(ids[0]);
    const payer = ids[ri(0, n - 1)], amount = ri(1, 9000);
    exps.push({ id: "e" + k, paidBy: payer, amount, date: "2026-11-" + String(ri(1, 28)).padStart(2, "0"), shares: L.splitAmount(amount, parts, payer) });
  }
  for (let k = ri(0, 5); k > 0; k--) {
    const a = ids[ri(0, n - 1)], b = ids[ri(0, n - 1)]; if (a === b) continue;
    pays.push({ id: "p" + k, from: a, to: b, amount: ri(1, 5000), date: "2026-11-15", status: ["approved", "pending", "rejected"][ri(0, 2)] });
  }
  const pr = L.pairwiseDebts(exps, pays);
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const owed = (pr.find((p) => p.from === b && p.to === a) || { amount: 0 }).amount - (pr.find((p) => p.from === a && p.to === b) || { amount: 0 }).amount;
    assert.strictEqual(L.pairBreakdown(a, b, exps, pays).total, owed, "breakdown must equal balance");
  }
}
console.log("all tests passed (incl. 3000 random flats + 1500 breakdown flats)");
