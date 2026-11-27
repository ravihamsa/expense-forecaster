# FinPlannar Android companion

A small Java-only companion app for the FinPlannar web planner. It imports bank/UPI SMS
transactions into the same Supabase account.

## What it does

- **Manual scan only.** Permission is requested when you tap **Scan SMS**; there is no
  background service, no `RECEIVE_SMS` receiver, and the app never becomes the default
  SMS app.
- **Current month only.** Scans start at midnight on the 1st of the current month; older
  messages are never read. Each tap reads up to 50 messages in SMS-id order, so tap
  **Scan SMS** again if the toast says there are more. Older or already-synced messages
  are not re-imported.
- **Foreground read.** Only received messages (`type = 1`) are read, and only when you tap
  the button. Each message gets a SHA-256 fingerprint of `sender|date|body`, so re-scans
  cannot create duplicates.
- **On-device parsing.** Amount, direction (expense/income), merchant, category and a
  default cash/bank account are inferred locally with regex rules. Amounts prefixed with `₹`,
  `Rs`, `Rs.`, `INR` or `INR.` take priority; if a message also contains a balance, the
  currency amount nearest a debit/credit word wins. No SMS text is sent to an AI service
  or third party.
- **Editable review.** Candidates appear with an editable amount and name, plus category and
  account spinners listing the reusable categories and money accounts from your web plan
  (including custom funds), and **Expense / Income / Ignore** buttons. A choice removes the card from the
  review queue and moves it to **Ready to save**; nothing is uploaded until you tap
  **Save selected**.
- **Existing tables.** Confirmed rows go to `cash_flows` (as `one_time`) and `actuals`
  (with the same `flowId-epochMillis` event key the web app uses). Both rows carry
  `source = 'sms'`, so the web app can filter them under **SMS** and remove them with
  **Remove SMS imports** without touching manual entries. Learned vendor preferences are
  stored locally and upserted to `vendor_rules`.
- **Session.** Email/password sign-in uses Supabase Auth; the access token, refresh token,
  user id and email are kept in `SharedPreferences` (`fp_companion_session`). Access tokens
  are refreshed automatically before a save. If no refresh token is available (for example
  after upgrading from an older build), sign in again. Sign out clears everything.

## Configure Supabase

Copy the example and fill in the values from **Project Settings → API**:

```sh
cp gradle.properties.example gradle.properties
# gradle.properties:
# supabaseUrl=https://YOUR_PROJECT.supabase.co
# supabaseAnonKey=YOUR_ANON_PUBLIC_KEY
```

`gradle.properties` is gitignored. `app/build.gradle.kts` exposes these values as
`BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_ANON_KEY` (empty by default).

`cash_flows` and `actuals` are pre-existing tables; `vendor_rules` (one row per user and
`vendor_key`, with RLS) is defined in `supabase/schema.sql` too. Re-run that schema once
in the Supabase SQL editor before first use. It adds the `source` column used by the SMS
tag. If `vendor_rules` is missing, cash flows and actuals still save; only the vendor-rule
upsert fails. Retrying that row reuses the stored flow id, so it will not create a
duplicate cash flow.

### Upgrading an older build

Version 3 of the local database clears previously reviewed SMS suggestions so the corrected
parser can classify them again. Learned vendor rules are preserved. Tap **Scan SMS** again
after installing. Because the session format now includes a refresh token, sign in again if
**Save selected** reports that the session expired.

## Reviewing parser output

Tap **Export CSV** to write every received message from the current month to
`Android/data/com.finplannar.companion/files/finplannar-sms-review.csv` in app storage.
The file contains the message date, sender, body, parsed amount, kind, merchant, category,
account and whether the value came from a learned vendor rule. It stays on the device;
nothing is uploaded.

Pull it to your computer with:

```sh
adb pull /sdcard/Android/data/com.finplannar.companion/files/finplannar-sms-review.csv
```

## Build

Requires JDK 17 and Android SDK Platform 35 installed (AGP 8.7.3, Gradle 8.11.1 wrapper
included). From the `android/` directory:

```sh
./gradlew assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` on a device. Debug builds are not
signed for Play Store upload; create a release signing config for distribution.

## Play Store caveat

`READ_SMS` is a restricted permission. Google Play requires a declaration explaining why
the app needs SMS access, a privacy policy, limited use of the data, and a core feature
that depends on it. A manual-import companion may still be rejected under the SMS/Call
Log permission policy. Review the current Play policy before publishing, or consider an
export/share-sheet workflow instead of direct SMS reading.
