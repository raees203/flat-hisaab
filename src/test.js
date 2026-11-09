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
// --- payment accounts: tidy, check, show ---
{
  const C = L.cleanAccountNumber, P = L.accountProblem;
  assert.strictEqual(C("easypaisa", "+92 300-1234567"), "03001234567");
  assert.strictEqual(C("jazzcash", "923001234567"), "03001234567");
  assert.strictEqual(C("jazzcash", "0092 3001234567"), "03001234567");
  assert.strictEqual(C("easypaisa", "0300 123 4567"), "03001234567");
  assert.strictEqual(C("bank", "pk36 scbl 0000 0011 2345 6702"), "PK36SCBL0000001123456702");
  assert.strictEqual(C("other", " 0321-1234567 "), "03211234567");
  const ep = (number, title = "Raees Ahmad") => P({ kind: "easypaisa", number, title });
  assert.strictEqual(ep("03001234567"), "");
  assert.strictEqual(ep("+923001234567"), "");
  assert.ok(ep("0300123456"), "10 digits is too short");
  assert.ok(ep("04235761234"), "landline is not a wallet");
  assert.ok(ep(""), "empty number");
  assert.ok(ep("03001234567", "R"), "one-letter title");
  assert.ok(ep("03001234567", "x".repeat(41)), "title too long");
  assert.strictEqual(P({ kind: "bank", provider: "Standard Chartered", number: "PK36SCBL0000001123456702", title: "Ali" }), "");
  assert.ok(/mistake/.test(P({ kind: "bank", provider: "Standard Chartered", number: "PK36SCBL0000001123456703", title: "Ali" })));
  assert.ok(/24 characters/.test(P({ kind: "bank", provider: "HBL", number: "PK36SCBL00000011234567", title: "Ali" })));
  assert.strictEqual(P({ kind: "bank", provider: "Meezan Bank", number: "0102 0104567890", title: "Ali" }), "");
  assert.ok(P({ kind: "bank", provider: "", number: "01020104567890", title: "Ali" }), "bank must be picked");
  assert.ok(P({ kind: "bank", provider: "HBL", number: "12345", title: "Ali" }), "5 digits is too short");
  assert.ok(P({ kind: "other", provider: "", number: "03001234567", title: "Ali" }), "other needs a name");
  assert.strictEqual(P({ kind: "other", provider: "SadaPay", number: "0300 1234567", title: "Ali" }), "");
  assert.ok(P({ kind: "cash", number: "1", title: "Ali" }), "unknown kind");
  assert.strictEqual(L.formatAccountNumber("03001234567"), "0300 1234567");
  assert.strictEqual(L.formatAccountNumber("PK36SCBL0000001123456702"), "PK36 SCBL 0000 0011 2345 6702");
  assert.strictEqual(L.formatAccountNumber("01020104567890"), "01020104567890");
  assert.strictEqual(L.accountLabel({ kind: "bank", provider: "Meezan Bank" }), "Meezan Bank");
  assert.strictEqual(L.accountLabel({ kind: "jazzcash", provider: "" }), "JazzCash");
  assert.strictEqual(L.methodForAccount({ kind: "other" }), "Bank");
  assert.strictEqual(L.methodForAccount({ kind: "easypaisa" }), "Easypaisa");
  const acc = [{ id: "a", memberId: "m1", createdAt: 1 }, { id: "b", memberId: "m1", createdAt: 2, primary: true }, { id: "c", memberId: "m2", createdAt: 0 }, { id: "d", memberId: "m1", createdAt: 3 }];
  assert.deepStrictEqual(L.accountsFor("m1", acc).map((a) => a.id), ["b", "a", "d"], "preferred first, then oldest");
  assert.ok(L.recentlyChanged({ updatedAt: 1000 }, 1000 + 2 * 864e5, 3) && !L.recentlyChanged({ updatedAt: 1000 }, 1000 + 4 * 864e5, 3));
  // IBAN checksum: random valid IBANs pass; any one mistyped character or two swapped neighbours fail
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", D = "0123456789";
  const make = (bank, acct) => { const n = BigInt([...(bank + acct + "PK00")].map((c) => parseInt(c, 36)).join("")); return "PK" + String(98n - (n % 97n)).padStart(2, "0") + bank + acct; };
  seed = 4242;
  for (let run = 0; run < 400; run++) {
    const bank = Array.from({ length: 4 }, () => A[ri(0, 25)]).join(""), acct = Array.from({ length: 16 }, () => D[ri(0, 9)]).join("");
    const iban = make(bank, acct);
    assert.ok(L.ibanOk(iban), "valid IBAN " + iban);
    assert.strictEqual(L.accountProblem({ kind: "bank", provider: "Any Bank", number: L.formatAccountNumber(iban).toLowerCase(), title: "Ali" }), "");
    const pos = ri(2, 23), pool = pos >= 4 && pos < 8 ? A : D;
    let c; do { c = pool[ri(0, pool.length - 1)]; } while (c === iban[pos]);
    assert.ok(!L.ibanOk(iban.slice(0, pos) + c + iban.slice(pos + 1)), "one wrong character must fail");
    const k = ri(8, 22);
    if (iban[k] !== iban[k + 1]) assert.ok(!L.ibanOk(iban.slice(0, k) + iban[k + 1] + iban[k] + iban.slice(k + 2)), "swapped digits must fail");
  }
}
console.log("all tests passed (incl. 3000 random flats + 1500 breakdown flats + 400 random IBANs)");
