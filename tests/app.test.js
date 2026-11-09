const { JSDOM } = require("jsdom");
const fs = require("fs");
const { makeClient, db } = require("./sbmock.js");
const dir = process.argv[2];
let html = fs.readFileSync(dir + "/index.html", "utf8");
html = html.replace('<script src="config.js"></script>', '<script>window.HISAAB_CONFIG={url:"https://x.supabase.co",anonKey:"k",webUrl:"https://raees203.github.io/flat-hisaab/"};</script>').replace('<script src="supabase.js"></script>', "");

function phone(name) {
  const client = makeClient(name);
  const shared = [], copied = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://localhost/",
    beforeParse(w) {
      w.supabase = { createClient: () => client };
      w.scrollTo = () => {};
      w.Capacitor = { Plugins: { Share: { share: async (o) => { shared.push(o); } }, Clipboard: { write: async (o) => { copied.push(o.string); } } } };
    },
  });
  const w = dom.window, d = w.document, errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  const P = {
    w, d, errors, shared, copied, name,
    q: (sel) => d.querySelector(sel),
    click(sel) { const el = d.querySelector(sel); if (!el) throw new Error(name + " missing " + sel); el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); },
    set(id, v) { const el = d.getElementById(id); if (!el) throw new Error(name + " missing #" + id); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); el.dispatchEvent(new w.Event("change", { bubbles: true })); },
    main: () => d.getElementById("main").textContent.replace(/\s+/g, " "),
    sheet: () => d.getElementById("sheetRoot").textContent.replace(/\s+/g, " "),
    summary: () => [...d.querySelectorAll(".summary .v")].map((x) => x.textContent).join(" | "),
    toast: () => d.getElementById("toast").textContent,
  };
  return P;
}
const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const mid = (n) => db.members.find((m) => m.name === n).id;

(async () => {
  // ---- first screen: two clear choices ----
  const raees = phone("raees");
  await tick();
  ok(raees.q('[data-act="ob-step"][data-v="join"]') && raees.q('[data-act="ob-step"][data-v="create"]') && !raees.q("#ob-code"), "first screen shows only two clear choices");

  raees.click('[data-act="ob-step"][data-v="create"]'); await tick(50);
  raees.set("ob-name", "Markhor Flat"); raees.set("ob-you", "Raees"); raees.set("ob-m0", "Sohaib"); raees.set("ob-m1", "Ali");
  raees.click('[data-act="ob-create"]'); await tick(600);
  ok(raees.d.getElementById("flatName").textContent === "Markhor Flat" && raees.d.getElementById("meLine").textContent === "You're Raees", "flat created, Raees linked");
  const code = db.flats[0].code;
  raees.click('[data-act="open-settings"]'); await tick(50);
  raees.click('[data-act="share-invite"]'); await tick(50);
  ok(raees.shared[0] && raees.shared[0].text.includes(code) && raees.shared[0].text.includes("raees203.github.io"), "invite has the code and the iPhone link");
  raees.click('[data-act="close-all"]');

  // ---- Sohaib joins ----
  const sohaib = phone("sohaib"); await tick();
  sohaib.click('[data-act="ob-step"][data-v="join"]'); await tick(50);
  sohaib.set("ob-code", code.toLowerCase()); sohaib.click('[data-act="ob-join"]'); await tick(600);
  ok(sohaib.q(`[data-act="set-me"][data-id="${mid("Raees")}"]`).disabled, "Raees's name is locked for Sohaib");
  sohaib.click(`[data-act="set-me"][data-id="${mid("Sohaib")}"]`); await tick(500);
  ok(sohaib.d.getElementById("meLine").textContent === "You're Sohaib", "Sohaib linked");

  // ---- Zain joins and adds himself ----
  const zain = phone("zain"); await tick();
  zain.click('[data-act="ob-step"][data-v="join"]'); await tick(50);
  zain.set("ob-code", code); zain.click('[data-act="ob-join"]'); await tick(600);
  zain.set("self-name", "Zain"); zain.click('[data-act="add-self"]'); await tick(500);
  ok(zain.d.getElementById("meLine").textContent === "You're Zain", "Zain added himself");

  // ---- attendance: own only (owner can mark Ali who has no phone) ----
  sohaib.click('[data-tab="today"]'); await tick(100);
  ok(sohaib.q(`[data-act="toggle-eat"][data-meal="lunch"][data-id="${mid("Raees")}"]`).disabled, "Sohaib can't change Raees's meals");
  ok(!sohaib.q(`[data-act="toggle-eat"][data-meal="lunch"][data-id="${mid("Sohaib")}"]`).disabled, "Sohaib can change his own meals");
  raees.click('[data-tab="today"]'); await tick(100);
  raees.click(`[data-act="toggle-eat"][data-meal="lunch"][data-id="${mid("Ali")}"]`); await tick(500);
  ok(/Lunch\s*3 eating/.test(sohaib.main()), "owner marked Ali out of lunch; Sohaib sees it live");

  // ---- expenses: only what you paid ----
  sohaib.click('[data-act="add-expense"][data-meal="lunch"]'); await tick(300);
  ok(!sohaib.q("#ex-by"), "Sohaib's form has no 'Paid by' (always himself)");
  sohaib.set("ex-amt", "1000"); sohaib.set("ex-note", "Roti"); await tick(50);
  console.log("   preview:", sohaib.q("#ex-prev").textContent);
  sohaib.click('[data-act="ex-save"]'); await tick(600);
  const roti = db.expenses.find((e) => e.note === "Roti");
  ok(roti && !(mid("Ali") in roti.shares) && roti.shares[mid("Sohaib")] === 334 && roti.shares[mid("Raees")] === 333, "Roti 1000 split 334/333/333 without Ali");

  raees.click('[data-act="add-expense"]'); await tick(200);
  const opts = [...raees.q("#ex-by").options].map((o) => o.textContent);
  ok(opts.join(",") === "Raees,Ali", "owner can pay as himself or Ali (no phone): " + opts.join(","));
  raees.click('[data-act="ex-meal"][data-v="other"]'); await tick(300);
  raees.click(`[data-act="ex-part"][data-id="${mid("Ali")}"]`); raees.click(`[data-act="ex-part"][data-id="${mid("Zain")}"]`);
  raees.set("ex-amt", "600"); raees.set("ex-note", "Chicken"); await tick(50);
  raees.click('[data-act="ex-save"]'); await tick(600);

  // ---- home: who owes whom for Raees, and the breakdown ----
  raees.click('[data-tab="home"]'); await tick(300);
  ok(raees.summary() === "Rs 0 | Rs 33", "Raees: get 0, owe 33 → " + raees.summary());
  raees.click(`[data-act="open-person"][data-id="${mid("Sohaib")}"]`); await tick(50);
  const sh = raees.sheet();
  console.log("   breakdown:", sh.slice(0, 260));
  ok(/You owe Sohaib\s*Rs 33/.test(sh) && /Roti.*−Rs 333/.test(sh) && /Chicken.*\+Rs 300/.test(sh) && /Total\s*−Rs 33/.test(sh), "breakdown: Roti −333, Chicken +300, total −33");
  raees.click('[data-act="open-expense"][data-back]'); await tick(50);
  ok(/Expense/.test(raees.sheet()) && raees.q('[data-act="close"]'), "item opens its expense with a back button");
  raees.click('[data-act="close"]'); await tick(50);
  ok(/How it adds up/.test(raees.sheet()), "back returns to the breakdown");

  // ---- pay from breakdown → only Sohaib approves ----
  raees.click('[data-act="add-payment"][data-dir="out"]'); await tick(50);
  ok(raees.q("#py-amt").value === "33" && raees.q("#py-other").value === mid("Sohaib"), "payment form pre-filled: Rs 33 to Sohaib");
  raees.click('[data-act="py-save"]'); await tick(600);
  ok(db.payments[0].status === "pending", "payment is pending");
  ok(!raees.q('[data-act="approve"]') && !zain.q('[data-act="approve"]'), "Raees and Zain can't approve");
  sohaib.click('[data-tab="home"]'); await tick(200);
  ok(sohaib.d.getElementById("bellBadge").textContent === "1" && !!sohaib.q('[data-act="approve"]'), "Sohaib sees the approval");
  sohaib.click('[data-act="approve"]'); await tick(700);
  ok(raees.summary() === "Rs 0 | Rs 0", "after approval Raees is settled with Sohaib → " + raees.summary());

  // ---- delete: only who added it ----
  zain.click('[data-tab="history"]'); await tick(200);
  zain.click(`[data-act="open-expense"][data-id="${roti.id}"]`); await tick(50);
  ok(!zain.q('[data-act="del-ask"]'), "Zain can't delete Sohaib's expense");
  raees.click('[data-tab="history"]'); await tick(200);
  raees.click(`[data-act="open-expense"][data-id="${roti.id}"]`); await tick(50);
  ok(!raees.q('[data-act="del-ask"]'), "even the owner can't delete Sohaib's expense");
  raees.click('[data-act="close-all"]');

  // ---- report a wrong expense ----
  zain.click('[data-act="close-all"]');
  zain.click(`[data-act="open-expense"][data-id="${roti.id}"]`); await tick(50);
  ok(!!zain.q('[data-act="report-open"]'), "Zain (in the Roti expense) sees Report as wrong");
  zain.click('[data-act="report-open"]'); await tick(50);
  zain.set("rep-note", "I didn't eat lunch"); zain.click('[data-act="report-send"]'); await tick(700);
  ok(db.expenses.find((e) => e.id === roti.id).disputed_by === mid("Zain"), "report saved");
  sohaib.click('[data-tab="home"]'); await tick(200);
  ok(/Zain says “Roti” is wrong/.test(sohaib.main()) && sohaib.d.getElementById("bellBadge").textContent === "1", "Sohaib (who added it) sees the report + bell");
  ok(/Zain says “Roti”/.test(sohaib.toast()), "Sohaib got an alert: " + sohaib.toast());
  raees.click('[data-tab="history"]'); await tick(200);
  raees.click(`[data-act="open-expense"][data-id="${roti.id}"]`); await tick(50);
  ok(!!raees.q('[data-act="del-ask"]') && /Reported as wrong/.test(raees.sheet()), "owner can now remove the reported expense");
  raees.click('[data-act="close-all"]');
  sohaib.click(`[data-act="clear-report"][data-id="${roti.id}"]`); await tick(700);
  ok(!db.expenses.find((e) => e.id === roti.id).disputed_by, "Sohaib marks it correct, report cleared");
  zain.click('[data-act="close-all"]'); zain.click(`[data-act="open-expense"][data-id="${roti.id}"]`); await tick(50);
  zain.click('[data-act="report-open"]'); await tick(50); zain.click('[data-act="report-send"]'); await tick(700);
  sohaib.click(`[data-act="quick-delete"][data-id="${roti.id}"]`); await tick(50);
  sohaib.click('[data-act="del-yes"]'); await tick(700);
  ok(!db.expenses.find((e) => e.id === roti.id), "after a second report Sohaib deletes it in two taps");
  zain.click('[data-act="close-all"]');

  // ---- settings: only owner manages others ----
  sohaib.click('[data-act="open-settings"]'); await tick(50);
  ok(!sohaib.q(`#mn-${mid("Raees")}`) && !!sohaib.q(`#mn-${mid("Sohaib")}`) && !sohaib.q('[data-act="mem-add"]') && !sohaib.q("#st-name"), "Sohaib can only rename himself");
  sohaib.click('[data-act="close-all"]');
  raees.click('[data-act="open-settings"]'); await tick(50);
  ok(!!raees.q(`#mn-${mid("Sohaib")}`) && !!raees.q('[data-act="mem-add"]') && !!raees.q("#st-name"), "owner manages members and flat name");
  raees.click('[data-act="close-all"]');

  // ---- report ----
  raees.click('[data-tab="report"]'); await tick(100);
  ok(/Rs 600/.test(raees.main()) && !/Rs 1,600/.test(raees.main()), "report total updated after delete (Rs 600)");

  // ---- payment accounts ----
  // Sohaib owes Raees Rs 333 now (Chicken 300 + the 33 Raees paid him)
  sohaib.click('[data-tab="home"]'); await tick(200);
  ok(!!sohaib.q('[data-act="nudge-later"]') && /Add your account/.test(sohaib.main()), "Sohaib (no account yet) is asked on Home to add one");
  sohaib.click('[data-act="nudge-later"]'); await tick(50);
  ok(!sohaib.q('[data-act="nudge-later"]'), "'Later' hides it");

  raees.click('[data-tab="home"]'); await tick(100);
  raees.click('[data-act="open-settings"]'); await tick(50);
  ok(/Your accounts/.test(raees.sheet()) && !!raees.q('#sheetRoot [data-act="acc-add"]'), "Settings has 'Your accounts' with Add");
  raees.click('#sheetRoot [data-act="acc-add"]'); await tick(50);
  ok(/Add account/.test(raees.sheet()) && raees.q('[data-act="acc-kind"][aria-pressed="true"]').textContent === "Easypaisa", "form opens on Easypaisa");
  raees.set("acc-num", "0300123456"); raees.set("acc-title", "Raees Ahmad"); raees.click('[data-act="acc-save"]'); await tick(300);
  ok(/11 digits/.test(raees.q("#acc-err").textContent) && !db.payment_accounts.length, "a 10-digit number is caught before saving: " + raees.q("#acc-err").textContent);
  raees.set("acc-num", "+92 300 1234567"); raees.click('[data-act="acc-save"]'); await tick(700);
  const ep = db.payment_accounts.find((a) => a.number === "03001234567");
  ok(ep && ep.kind === "easypaisa" && ep.is_primary && ep.member_id === mid("Raees") && ep.title === "Raees Ahmad", "Easypaisa 03001234567 saved as Raees's preferred");
  ok(/Settings/.test(raees.sheet()) && /0300 1234567 · Raees Ahmad/.test(raees.sheet()), "back in Settings, the account is listed");
  raees.click('#sheetRoot [data-act="acc-add"]'); await tick(50);
  raees.click('[data-act="acc-kind"][data-v="bank"]'); await tick(50);
  ok(raees.q("#acc-title").value === "Raees Ahmad" && !!raees.q("#acc-bank"), "bank form: name filled in from his first account");
  raees.set("acc-bank", "Meezan Bank"); await tick(20);
  raees.set("acc-num", "PK23 MEZN 0001 0201 0456 7891"); raees.click('[data-act="acc-save"]'); await tick(300);
  ok(/mistake/.test(raees.q("#acc-err").textContent), "a mistyped IBAN is caught: " + raees.q("#acc-err").textContent);
  raees.set("acc-num", "pk23 mezn 0001 0201 0456 7890"); raees.click('[data-act="acc-save"]'); await tick(700);
  const iban = db.payment_accounts.find((a) => a.kind === "bank");
  ok(iban && iban.number === "PK23MEZN0001020104567890" && iban.provider === "Meezan Bank" && !iban.is_primary, "Meezan IBAN saved (not preferred)");
  raees.click('[data-act="close-all"]');

  sohaib.click(`[data-act="open-person"][data-id="${mid("Raees")}"]`); await tick(100);
  let ps = sohaib.sheet();
  ok(/You owe Raees\s*Rs 333/.test(ps) && /Send to Raees/.test(ps) && /0300 1234567/.test(ps) && /PK23 MEZN 0001 0201 0456 7890/.test(ps) && /Raees Ahmad/.test(ps),
    "Sohaib sees where to send Rs 333: Easypaisa and Meezan IBAN with Raees's name");
  ok(ps.indexOf("Easypaisa") < ps.indexOf("Meezan Bank") && /Preferred/.test(ps), "preferred account comes first");
  ok(!sohaib.q('[data-act="acc-edit"]'), "Sohaib can't edit Raees's accounts");
  sohaib.click(`[data-act="acc-copy"][data-id="${iban.id}"]`); await tick(50);
  ok(sohaib.copied.at(-1) === "PK23MEZN0001020104567890" && /Raees's Meezan Bank IBAN copied/.test(sohaib.toast()), "Copy puts the plain IBAN on the clipboard: " + sohaib.toast());
  sohaib.click('[data-act="acc-copy-amt"]'); await tick(50);
  ok(sohaib.copied.at(-1) === "333", "Copy amount gives 333");
  sohaib.click('[data-act="add-payment"][data-dir="out"]'); await tick(50);
  ok(sohaib.q('[data-act="py-method"][aria-pressed="true"]').textContent === "Bank" && sohaib.q("#py-amt").value === "333", "I've paid → form set to Bank (the IBAN he copied), Rs 333");
  sohaib.click('[data-act="close-all"]');

  // Sohaib's own settings: only his own accounts; the database refuses edits to Raees's
  sohaib.click('[data-act="open-settings"]'); await tick(50);
  ok(/Your accounts/.test(sohaib.sheet()) && !/0300 1234567/.test(sohaib.sheet()), "Sohaib's Settings shows only his own (none yet)");
  sohaib.click('[data-act="close-all"]');

  // Raees changes his number: Sohaib's open screen updates, flagged as changed
  sohaib.click(`[data-act="open-person"][data-id="${mid("Raees")}"]`); await tick(50);
  raees.click('[data-act="open-settings"]'); await tick(50);
  raees.click(`[data-act="acc-edit"][data-id="${ep.id}"]`); await tick(50);
  ok(raees.q("#acc-num").value === "0300 1234567" && !!raees.q('[data-act="acc-del-ask"]'), "edit form shows his number and Delete");
  raees.set("acc-num", "0301-9998877"); raees.click('[data-act="acc-save"]'); await tick(800);
  ps = sohaib.sheet();
  ok(/0301 9998877/.test(ps) && /Changed today/.test(ps) && !/0300 1234567/.test(ps), "Sohaib sees the new number live, marked 'Changed today'");
  sohaib.click('[data-act="close-all"]');

  // make the IBAN preferred, then the remind message lists both
  raees.click(`[data-act="acc-edit"][data-id="${iban.id}"]`); await tick(50);
  raees.q("#acc-primary").checked = true; raees.click('[data-act="acc-save"]'); await tick(700);
  ok(db.payment_accounts.find((a) => a.id === iban.id).is_primary && !db.payment_accounts.find((a) => a.id === ep.id).is_primary, "IBAN is now preferred, Easypaisa isn't");
  raees.click('[data-act="close-all"]');
  raees.click(`[data-act="open-person"][data-id="${mid("Sohaib")}"]`); await tick(50);
  raees.click('[data-act="remind"]'); await tick(50);
  const rem = raees.shared.at(-1).text;
  ok(/You can send it to:/.test(rem) && /Meezan Bank IBAN: PK23MEZN0001020104567890 \(Raees Ahmad\)/.test(rem) && /Easypaisa: 03019998877/.test(rem), "Remind message lists Raees's accounts");
  raees.click('[data-act="close-all"]');

  // Zain has no account: Sohaib, who owes him, can ask for one
  zain.click('[data-act="add-expense"]'); await tick(200);
  zain.click('[data-act="ex-meal"][data-v="other"]'); await tick(300);
  zain.click(`[data-act="ex-part"][data-id="${mid("Raees")}"]`); zain.click(`[data-act="ex-part"][data-id="${mid("Ali")}"]`);
  zain.set("ex-amt", "300"); zain.set("ex-note", "Milk"); zain.click('[data-act="ex-save"]'); await tick(700);
  sohaib.click(`[data-act="open-person"][data-id="${mid("Zain")}"]`); await tick(50);
  ok(/You owe Zain\s*Rs 150/.test(sohaib.sheet()) && /Zain hasn't added an account yet/.test(sohaib.sheet()) && !!sohaib.q('[data-act="acc-ask"]'), "no account: Sohaib sees 'Ask for account'");
  sohaib.click('[data-act="acc-ask"]'); await tick(50);
  ok(/Settings → Your accounts/.test(sohaib.shared.at(-1).text) && /Rs 150/.test(sohaib.shared.at(-1).text), "the ask message says where to add it");
  sohaib.click('[data-act="close-all"]');

  // delete the preferred one: the other becomes preferred
  raees.click('[data-act="open-settings"]'); await tick(50);
  raees.click(`[data-act="acc-edit"][data-id="${iban.id}"]`); await tick(50);
  raees.click('[data-act="acc-del-ask"]'); await tick(20); raees.click('[data-act="acc-del-yes"]'); await tick(700);
  ok(!db.payment_accounts.find((a) => a.id === iban.id) && db.payment_accounts.find((a) => a.id === ep.id).is_primary, "deleted the IBAN; Easypaisa is preferred again");
  raees.click('[data-act="close-all"]');

  const errs = [...raees.errors, ...sohaib.errors, ...zain.errors];
  ok(errs.length === 0, "no script errors " + JSON.stringify(errs));
  console.log(fails ? fails + " FAILED" : "ALL APP TESTS PASSED");
})().catch((e) => { console.log("ERR", e.stack); fails++; }).finally(() => setTimeout(() => process.exit(fails ? 1 : 0), 100));
