# Flat Hisaab

Android app for flatmates to split daily food costs: who paid, who ate, who owes whom.

- **App**: `src/` (HTML/JS), packaged with Capacitor into `android/`
- **Backend**: Supabase (free plan). Schema and all security rules: `supabase/migrations/` (001 initial, 002 no-tampering)
- **APK** (Android): built by GitHub Actions on every push to `main` (`.github/workflows/build.yml`).
  Download it from the latest Release, or from the `apk` branch.
- **Web app** (iPhone / any browser): the same app, published to GitHub Pages at
  https://raees203.github.io/flat-hisaab/ — on iPhone open it in Safari, then Share → Add to Home Screen.

## How the rules are enforced (server side)
- Only phones that joined a flat with its 6-letter code can read or write that flat.
- You can only add an expense **you** paid (the owner may add one for a member with no phone).
- You can only record a payment you made or received; it counts only after the **receiver** approves.
- You can only mark your own meals (the owner can mark anyone), and only delete entries you added.
- Only the owner renames the flat or manages members; anyone can rename himself.
- An expense's shares must add up exactly to its amount (whole rupees).
- A name can be linked to only one phone; only the flat owner can unlink a lost phone.

## Tests
- `npm test` — money logic (exact splits, balances, per-person breakdowns; thousands of random flats)
- `supabase/test/rules_test.sql` — every security rule against a real Postgres
- `tests/app.test.js` — three simulated phones using the app together (needs `jsdom`)
- `tests/layout_check.py` — screenshots every screen at 320–1280px and large font, flags squeezed text

## Local commands
```
npm ci
npm test            # money logic tests (3000 random flats)
python3 build.py    # builds www/ using supabase/config.json
npx cap sync android
cd android && ./gradlew assembleRelease
```

## Signing key
The APK is signed with a key kept **outside** this repository, in two GitHub Actions secrets:
`KEYSTORE_BASE64` (the .jks file, base64) and `KEYSTORE_PASSWORD`. The same key must sign
every build so updates install over the old app — keep a private backup of it.
