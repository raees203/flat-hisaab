import sys, os, re, json, shutil
from playwright.sync_api import sync_playwright
WWW = "/home/claude/flat-hisaab/www"
OUT = "/home/claude/visual/shots"; os.makedirs(OUT, exist_ok=True)
html = open(WWW + "/index.html").read()
logic = re.findall(r"<script>(.*?)</script>", html, re.S)[0]
# serve: mock + logic + seed replace config/supabase
def page_html(onboard):
    seed = "" if onboard else open("/home/claude/visual/seed.js").read()
    head = "<script>" + open("/home/claude/visual/sbmock-browser.js").read() + "</script><script>" + logic + "</script>"
    if onboard:
        head += "<script>window.supabase={createClient:function(){var c=window.SBMOCK.makeClient('new');return c;}};window.HISAAB_CONFIG={url:'x',anonKey:'k'};</script>"
    else:
        head += "<script>" + seed + "</script><script>try{localStorage.setItem('hisaab.flat','f1')}catch(e){}</script>"
    return html.replace('<script src="config.js"></script>', head).replace('<script src="supabase.js"></script>', "")
open(WWW + "/_seed.html", "w").write(page_html(False))
open(WWW + "/_onboard.html", "w").write(page_html(True))

CHECK = """() => {
  const bad = [];
  document.querySelectorAll('.t, .s, .k, .v, .amt, h1, h2, h3, .btn, .chip, .lbl, .pill, td, th, label, .lab').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
    const words = (el.textContent || '').trim().split(/\\s+/).filter(Boolean);
    const lines = Math.round(r.height / lh);
    // one-letter-per-line style squeeze: far more lines than words, or a box narrower than ~3 letters
    if (words.length && lines >= 2 && (lines > words.length + 1 || r.width < parseFloat(cs.fontSize) * 3))
      bad.push(el.className + ': "' + el.textContent.trim().slice(0, 30) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto' && cs.textOverflow !== 'ellipsis' && !el.closest('.tablewrap'))
      bad.push('overflow ' + el.className + ': "' + el.textContent.trim().slice(0, 30) + '"');
  });
  if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('PAGE SCROLLS SIDEWAYS ' + document.documentElement.scrollWidth);
  return bad;
}"""
sizes = [("320", 320, 640), ("360", 360, 780), ("390", 390, 844), ("768", 768, 1024), ("1280", 1280, 800)]
problems = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--allow-file-access-from-files"])
    for label, w, h in sizes:
        for scale in ([1.0, 1.3] if w <= 390 else [1.0]):
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 700 else 1)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            def shot(name):
                key = f"{label}{'-big' if scale > 1 else ''}-{name}"
                if scale > 1: pg.add_style_tag(content="html{font-size:%d%%}" % int(scale * 100))
                pg.wait_for_timeout(250)
                bad = pg.evaluate(CHECK)
                if bad: problems[key] = bad
                if label in ("360", "390", "1280") or scale > 1:
                    pg.screenshot(path=f"{OUT}/{key}.png", full_page=False)
            pg.goto("file://" + WWW + "/_onboard.html"); pg.wait_for_timeout(600); shot("start")
            pg.goto("file://" + WWW + "/_seed.html"); pg.wait_for_timeout(900); shot("home")
            pg.click('[data-act="open-person"][data-id="m1"]'); shot("person")
            pg.click('[data-act="close-all"]')
            pg.click('[data-act="open-expense"][data-id="e1"]'); shot("reported")
            pg.click('[data-act="close-all"]')
            pg.goto("file://" + WWW + "/_seed.html"); pg.wait_for_timeout(900)
            pg.click('[data-tab="history"]'); pg.click('[data-act="open-expense"][data-id="e2"]'); shot("report-btn")
            pg.click('[data-act="close-all"]'); pg.click('[data-tab="home"]')
            pg.click('.fab'); pg.wait_for_timeout(300); pg.fill("#ex-amt", "1000"); pg.dispatch_event("#ex-amt", "input"); shot("expense")
            pg.click('[data-act="close-all"]')
            pg.click('[data-tab="today"]'); shot("today")
            pg.click('[data-tab="report"]'); shot("report")
            pg.click('[data-act="open-settings"]'); shot("settings")
            pg.click('[data-act="close-all"]')
            pg.click('[data-tab="home"]'); pg.click('[data-act="add-payment"]') if pg.query_selector('[data-act="add-payment"]') else None
            if errs: problems[f"{label}-js"] = errs
            ctx.close()
    b.close()
print(json.dumps(problems, indent=1) if problems else "NO LAYOUT PROBLEMS FOUND")
