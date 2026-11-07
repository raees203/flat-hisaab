#!/usr/bin/env python3
"""Builds www/ (the app Capacitor packages into the APK).

Supabase settings come from environment variables SUPABASE_URL and
SUPABASE_ANON_KEY, or from supabase/config.json. The anon (publishable) key
is safe to ship inside the app: all access is controlled by the database's
row level security rules.
"""
import json, os, shutil, pathlib

root = pathlib.Path(__file__).parent
src, www = root / "src", root / "www"
www.mkdir(exist_ok=True)

cfg = {"url": os.environ.get("SUPABASE_URL", ""), "anonKey": os.environ.get("SUPABASE_ANON_KEY", ""), "webUrl": ""}
cfg_file = root / "supabase" / "config.json"
if (not cfg["url"] or not cfg["anonKey"]) and cfg_file.exists():
    cfg.update({k: v for k, v in json.loads(cfg_file.read_text()).items() if k in ("url", "anonKey", "webUrl") and v})

html = (src / "app.html").read_text()
html = html.replace("/*__STYLE__*/", (src / "style.css").read_text())
html = html.replace("/*__LOGIC__*/", (src / "logic.js").read_text())
(www / "index.html").write_text(html)
(www / "config.js").write_text("window.HISAAB_CONFIG = " + json.dumps(cfg) + ";\n")
shutil.copy(root / "node_modules/@supabase/supabase-js/dist/umd/supabase.js", www / "supabase.js")
(www / "fonts").mkdir(exist_ok=True)
for w in ("400", "500", "600"):           # bundled font: same look on every phone, works offline
    shutil.copy(root / f"node_modules/@fontsource/dm-sans/files/dm-sans-latin-{w}-normal.woff2", www / "fonts" / f"dm-sans-{w}.woff2")
for f in (src / "web").iterdir():          # web app manifest + icons (for iPhone / browser use)
    shutil.copy(f, www / f.name)
print("built www/ for", cfg["url"] or "(no Supabase URL set)")
