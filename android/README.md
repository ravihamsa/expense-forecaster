# FinPlannar Android companion

A small Java-only companion app for the FinPlannar web planner. It imports bank/UPI SMS
transactions into the same Supabase account.

## What it does

- **Manual scan only.** Permission is requested when you tap **Scan SMS**; there is no
  background service, no `RECEIVE_SMS` receiver, and the app never becomes the default
  SMS app.
- **Foreground read.** Only received messages (`type = 1`) newer than the last successful
  scan are read. Each message gets a SHA-256 fingerprint of `sender|date|body`, so
  re-scans cannot create duplicates.
- **On-device parsing.** Amount, direction (expense/income), merchant, category and
  cash/bank account are inferred locally with regex rules. No SMS text is sent to an
  AI service or third party.
- **Editable review.** Candidates appear with editable amount, name and category, an account
  spinner, and **Expense / Income / Ignore** buttons. Nothing is uploaded until you tap
  **Save selected**.
- **Existing tables.** Confirmed rows go to `cash_flows` (as `one_time`) and `actuals`
  (with the same `flowId-epochMillis` event key the web app uses). Learned vendor
  preferences are stored locally and upserted to `vendor_rules`.
- **Session.** Email/password sign-in uses Supabase Auth; the access token, user id and
  email are kept in `SharedPreferences` (`fp_companion_session`). Sign out clears them.

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
in the Supabase SQL editor before first use. If `vendor_rules` is missing, cash flows and
actuals still save; only the vendor-rule upsert fails. Retrying that row reuses the
stored flow id, so it will not create a duplicate cash flow.

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
