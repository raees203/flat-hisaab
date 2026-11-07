# Flat Hisaab

Android app for flatmates to split daily food costs: who paid, who ate, who owes whom.

- **App**: `src/` (HTML/JS), packaged with Capacitor into `android/`
- **Backend**: Supabase (free plan). Schema and all security rules: `supabase/schema.sql`
- **APK**: built by GitHub Actions on every push to `main` (`.github/workflows/build-apk.yml`).
  Download it from the latest Release, or from the `apk` branch.

## How the rules are enforced (server side)
- Only phones that joined a flat with its 6-letter code can read or write that flat.
- A payment counts only after the person who **received** it approves it, from his own phone.
- An expense's shares must add up exactly to its amount (whole rupees).
- A name can be linked to only one phone; only the flat owner can unlink a lost phone.

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
