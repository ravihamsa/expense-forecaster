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
- **Pre-save review.** The **Ready to save** screen lists every queued row with the same
  editable fields. You can change amount/name/kind/category/account, return a row to SMS
  review, or ignore it. **Ignored SMS** lists parser-dismissed messages and lets you
  un-ignore them so they come back for review.
- **Existing tables.** Confirmed rows go to `cash_flows` (as `one_time`) and `actuals`
  (with the same `flowId-epochMillis` event key the web app uses). Both rows carry
  `source = 'sms'`, so the web app can filter them under **SMS** and remove them with
  **Remove SMS imports** without touching manual entries. Learned vendor preferences are
  stored locally and upserted to `vendor_rules`.
- **Dashboard.** A signed-in dashboard uses cards and stat tiles to show the sum of account
  opening balances, this month's planned income from cash-flow schedules and monthly incomes,
  this month's planned spends from `budgets`, this month's recorded amounts from `actuals`,
  and a prominent month-end projection. Accounts and **Recent activity** get their own compact
  lists; recent titles follow edits to budgets and actuals instead of stale SMS cash flows.
  A dedicated **Category spend vs budget** section compares this month's recorded spend with
  the matching `budgets` amount for every budgeted or recorded category. It shows over, under
  and on-budget categories together, sorted by variance, with a short summary of each group.
  Calendar splits are honored through `cash_flow_overrides`, so a split reduces the original
  entry instead of adding a second full amount. Tapping a category card opens a detail screen
  with that category's recorded spends and an **Edit spend** action that patches the underlying
  `actuals` row (and the linked `cash_flows` row for SMS imports). Account names and the
  currency label come from Supabase.
- **Cash-flow CRUD.** The **Cash flows** tab lists planned entries from `cash_flows` and
  lets you add, edit or delete them. Name, amount, kind, category, account, schedule, start
  date and repeat interval are editable. Calendar splits appear as split-adjusted amounts
  with the original schedule noted; SMS-imported rows keep `source = 'sms'` when edited.
  Deleting a plan does not delete recorded actuals.
- **Month view with editable expenses.** The **Month** tab shows a seven-column calendar
  with planned and recorded entries and **All / Planned / Recorded** filters. Today is selected
  by default whenever the displayed month is the current month. Tap a day to inspect its
  entries; expense cards offer **Edit planned category** (updates
  `budgets.monthly_limit`, `name` and `category`), **Move planned date** (adds a
  `budget_moves` row for that occurrence), or **Edit recorded category** (updates
  `actuals.amount`, `name` and `category`; SMS imports also update their linked `cash_flows`
  row). Changes are PATCHed to Supabase for the signed-in user and the month reloads.
  Split-adjusted income entries are marked as such.
- **Add categories.** The **Categories** tab lists your expense and income names and can
  add a new one to `categories`. It immediately becomes available in cash-flow and SMS
  review pickers. `Other` exists in both lists as the fallback.
- **Navigation and feedback.** The bottom bar keeps **Plan / SMS / Ready / Month / Ignored**
  one tap away in a compact bar with an active-tab pill and counts for pending, ready and
  ignored messages. The SMS screen has
  search and **Load more**, the Scan button shows progress, and **Save selected** asks for
  confirmation. Screen state, filters and scroll position survive rotation, and Back returns
  to SMS review from any other screen.
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

`cash_flows` and `actuals` are pre-existing tables; `accounts`, `categories` and
`vendor_rules` (with per-user RLS) are defined in `supabase/schema.sql` too. Re-run that
schema, or the shorter `supabase/migrations/002_multi_accounts.sql`, in the Supabase SQL
editor before first use. It adds the `source` column used by the SMS tag, text-id defaults
for accounts/categories, and the default category lists. If `vendor_rules` is missing,
cash flows and actuals still save; only the vendor-rule upsert fails. Retrying that row
reuses the stored flow id, so it will not create a duplicate cash flow.

### Upgrading an older build

Version 3 of the local database clears previously reviewed SMS suggestions so the corrected
parser can classify them again. Learned vendor rules are preserved. Tap **Scan SMS** again
after installing. Because the session format now includes a refresh token, sign in again if
**Save selected** reports that the session expired.

## Reviewing parser output

Tap **More ▾ → Export CSV** to write every received message from the current month to
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
