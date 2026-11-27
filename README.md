# FinPlannar

A personal finance planner that forecasts your cash flow months ahead, tracks recurring and one-off
income/expenses, manages loans, and suggests practical ways to balance your finances.

Built with **React + Vite + TypeScript** and **Supabase** (email/password auth + Postgres data).
If Supabase credentials are not configured, the app automatically runs in a **local demo mode** so
you can try everything immediately — data is stored in that browser only.

## Features

- Email + password sign up / sign in (Supabase Auth), with per-user row-level security.
- Multiple money accounts: `Cash in hand` and `Bank balance` are built in; create your own (e.g. a **farm-house build fund**) with its own opening balance. Every account is a separate balance bucket included in net worth and the forecast. Cash flows, loans, payments and SMS imports can all be assigned to any account.
- Net-neutral transfers between accounts, with both legs recorded at the same amount so your total never changes.
- Reusable expense/income categories managed on the **Categories** page. Add, rename or remove your own names once and pick them in cash flows, budgets and SMS imports; removed categories move existing entries to `Other`.
- Expected income planned month by month directly in the dashboard's month preview (editable any time, carried forward when a month is skipped) with optional annual income growth, plus a starting balance that is the sum of every account's opening balance and optional expense inflation.
- Cash flow entries with schedules:
  - monthly
  - yearly
  - every N months
  - every N years
  - one-time / ad-hoc (income or expense)
  - per-occurrence fixed amounts: edit any monthly/yearly (or other scheduled) income or expense directly in the dashboard's month preview; unedited occurrences keep the custom amount
- 1–36 month rolling forecast showing:
  - monthly net cash flow (surplus or deficit)
  - projected closing balance
  - months that may run into a deficit
- Month preview on the dashboard: pick any forecast month (or click a chart bar / use prev-next buttons) to see every dated income, expense and loan cash flow with totals, edit expected income or any occurrence's amount inline, or add a new monthly/yearly entry
- Calendar view: drag scheduled incomes and expenses to another date, or click an entry to move, duplicate, split, record an actual or delete it. Moves shift money between months and update the balance carried forward; duplicates and splits are saved as one-time entries.
  - Delete offers **just this date** (skips one occurrence, with a restore chip) or **whole entry** (deletes the underlying recurring cash flow). For expected monthly income the choices are **just this month** or **from this month onward**.
  - Recorded actuals are shown with a check on the calendar chip and feed budgets and the Actual vs plan page.
- Category budgets: monthly limits per expense category, optional rollover of unused (or overspent) amounts, and a month-by-month comparison of planned, recorded and spent amounts.
- Goals & sinking funds: target, current savings, monthly contribution and target month, with required monthly amount, projected gap and a check against the average forecast surplus.
- Planned vs actual: record the real amount for any forecast occurrence from the calendar or the Actual vs plan page, or import a CSV with `date,name,amount` columns. Only rows that match a planned occurrence are imported.
- Loans with original amount, outstanding balance, interest rate, EMI, due day and tenure.
  - amortisation-based payoff estimates
  - interest remaining
  - warning when an EMI does not cover monthly interest
  - interest-free hand loans with no EMI, repaid by a planned lump-sum date and/or multiple recorded one-time payments, each with its own date
  - loans given to others (receivables): each repayment received is counted as income in the month it lands, with no limit on how many repayment dates you record
  - the dashboard shows “You owe” and “Owed to you” as separate numbers; only borrowed EMIs count as monthly outgoings and lent EMIs count as income
  - payments recorded for today reduce the outstanding balance straight away; future-dated ones stay as planned forecast events
- Strict money trail (double-entry style): every recorded movement has a source account and a destination account for the same amount, including custom accounts and transfers. Existing entries dated today or earlier are included automatically, so you can see exactly where money came from and where it went.
- Balance Plan:
  - trim flexible spending by a percentage and see the effect instantly
  - add an extra monthly loan prepayment, targeting a specific loan or the highest-interest loan
  - before/after chart, deficit reduction, interest saved, balance improvement, loans cleared sooner
  - contextual suggestions based on your actual plan
- JSON export/import in Settings: download a portable backup or move local demo data into a Supabase account. Ids, owner and references are remapped on import, with merge or replace choice and a preview before committing.
- INR formatting by default (₹ with Indian digit grouping); USD, EUR and GBP can be selected in Settings.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. Without a `.env.local` file you will be in local demo mode.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql),
   and run it. This creates `profiles`, `monthly_incomes`, `cash_flows`, `cash_flow_overrides`,
   `cash_flow_moves`, `cash_flow_skips`, `budgets`, `goals`, `actuals`, `loans`, `loan_payments`,
   `categories`, `accounts` and `transfers`, the `account` columns used by the money trail, the
   income `day` used by the calendar, `vendor_rules` learned by the SMS companion, row-level
   security policies and a trigger that creates a profile (with cash, bank and default categories)
   for every new user. Existing projects get their cash/bank balances and default categories
   backfilled. Re-run this file whenever you upgrade the app so new tables and policies are added;
   [`supabase/migrations/002_multi_accounts.sql`](supabase/migrations/002_multi_accounts.sql)
   contains just the newer accounts/transfers/categories changes if you want a shorter upgrade.
3. Copy `.env.example` to `.env.local` and fill in your project URL and anon public key:

   ```bash
   cp .env.example .env.local
   ```

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
   ```

4. Restart the dev server. Sign up, and your data will be stored in Supabase.

> Enable email confirmation under **Authentication → Providers → Email** if you want verified
> sign-ups. The app handles both flows (immediate session and "check your email" confirmation).

## Move demo data into Supabase (JSON export/import)

Local demo accounts live in your browser's `localStorage`, so enabling Supabase keys starts with an
empty cloud account. To bring your demo plan across:

1. In demo mode, open **Settings → Move your data → Download JSON**. (If you already enabled
   Supabase, the older demo accounts are listed under **Demo data still in this browser** — download
   one there instead.)
2. Create/sign in to your Supabase account, then open **Settings → Move your data → Import JSON**.
3. Pick the downloaded file. The app validates it and shows a preview with entry counts.
4. Choose **Merge with existing** (keep what is in the account and add the imported entries) or
   **Replace everything** (delete existing entries first — cannot be undone), then confirm.

On import, every row gets a fresh id, `user_id` becomes the signed-in user, references such as
`cash_flow_id` / `loan_id` are rewritten, and recorded actual keys are updated so they still attach
to the right occurrence. Profile settings are always taken from the file. The file is a plain JSON
object with `app`, `version`, `exportedAt`, `source`, `account` and the full planner data under `data`,
so it also works as a backup you can move between browsers.

## Deploy to GitHub Pages

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and deploys the site on every
push to `main` (and on manual run from the Actions tab).

1. Make sure Actions are enabled under **Settings → Actions → General**.
2. In GitHub, open **Settings → Pages → Build and deployment** and choose **GitHub Actions** as the
   source. The workflow will configure this automatically on its first run.
3. Add repository secrets under **Settings → Secrets and variables → Actions → New repository
   secret**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Skip these if you want the deployed app to stay in local demo mode. Use the **anon public** key,
   never the service-role key. Re-run the workflow after adding secrets so they are baked into the
   build.
4. Push to `main`, then open **Actions → Deploy to GitHub Pages** to watch the deployment.
5. The site will be available at https://ravihamsa.github.io/expense-forecaster/.

If you use Supabase, add that URL to **Supabase → Authentication → URL Configuration → Site URL**
and **Redirect URLs** so email confirmation links return to the deployed app. If you rename the
repository, update the `base` path in [`vite.config.ts`](vite.config.ts) too.

## Android SMS companion

The [`android/`](android/) folder is a separate Java Android app that imports transactions into the
same planner. It is **manual and foreground-only**: nothing watches SMS in the background.

1. Tap **Scan SMS**. The app asks for `READ_SMS` permission only at that point.
2. It reads received messages from the **current month only** (50 per tap), parses them on the
   device, and shows each as an editable suggestion.
3. Mark each message **Expense**, **Income**, or **Ignore**. Vendor is pre-filled from learned
   rules; the category and account pickers list the same reusable categories and money accounts
   you created in the web app (including custom funds), fetched from Supabase when the companion
   starts.
4. Tap **Save selected**. Confirmed messages become one-time cash flows plus matching actuals, so
   they appear in the web dashboard, Actual vs plan, and the money trail. The rows are tagged
   `source = sms`.

The app also has three more tabs:

- **Dashboard** — account opening balances, this month's planned and recorded income/expenses,
  and a simple month-end projection.
- **Cash flows** — add, edit or delete planned entries. SMS-imported entries keep their `sms`
  source tag when edited.
- **Categories** — add expense or income names that immediately appear in the cash-flow and SMS
  review pickers. `Other` is always kept as the fallback.

In the web app, **Cash flow → SMS** and **Planned vs actual → SMS** show only imported rows with an
**SMS** badge. **Remove SMS imports** deletes those rows (and their recorded amounts) while leaving
manual entries untouched. Re-run `supabase/schema.sql` before using this filter so the `source`
columns exist.

Vendor rules are saved per signed-in user in Supabase (`public.vendor_rules`). Once you classify a
vendor, future messages from the same sender and merchant are pre-filled with the same kind,
category, and account. Rules are included in JSON exports and imports.

To build it:

```bash
cp android/gradle.properties.example android/gradle.properties
# fill in supabaseUrl and supabaseAnonKey (anon public key, not service role)
cd android
./gradlew assembleDebug
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` on the phone and sign in with the same
email/password as the web app. Re-run `supabase/schema.sql` first so the `vendor_rules` table and
policies exist.

Google Play restricts SMS access. This is designed as a personal/sideloaded companion; a Play Store
release would need a permission declaration and review.

## Production build

```bash
npm run build
npm run preview
```

Host the `dist/` folder on any static host (Vercel, Netlify, Cloudflare Pages, etc.). Add the two
`VITE_SUPABASE_*` variables to the host's build environment. The anon key is safe to expose —
access is controlled by the Supabase RLS policies in the schema.

## Project structure

```
src/
  App.tsx                 app state, auth and data orchestration
  components/             auth screen, layout, modal, forms
  pages/                  dashboard, cash flow, budgets, goals, actuals, loans, balance plan, calendar, money trail, settings
  lib/
    advice.ts             recommendations based on the current plan
    actuals.ts            actual creation and CSV import helpers
    budgets.ts            per-category budget and rollover calculations
    categories.ts         default category seeds and reusable-list helpers
    data.ts               Supabase/local demo persistence, auth and JSON export/import
    format.ts             currency and date formatting
    goals.ts              goal funding and progress calculations
    ledger.ts             strict paired-account money trail derived from recorded data
    projections.ts        cash flow simulation and loan amortisation
    schedule.ts           recurrence rules
    types.ts              shared types
    supabaseClient.ts     Supabase client / configuration check
supabase/schema.sql       database schema, RLS policies, signup trigger
.github/workflows/deploy.yml  GitHub Pages build and deployment workflow
android/                  Java Android companion app (dashboard, cash-flow CRUD, categories, manual SMS scan)
```

## How the forecast works

Each month, the simulator adds your planned expected income for that month (plus any scheduled
income), subtracts recurring and one-time expenses, accrues and pays loan EMIs, and carries the resulting balance
forward. A fixed amount set for a specific occurrence is used exactly as entered, while other
occurrences keep the cash flow's custom amount (with inflation applied to expenses). Calendar moves are applied before monthly totals are calculated, so an entry dragged into another month changes both months' net and the balance carried forward. Skipped occurrences are excluded from both the forecast and the money trail. A month is marked as a deficit when its net cash flow is negative. Prepaid loan amounts are
distributed to the chosen loan first, then to the next highest-interest loan. All of this runs
entirely in the browser, so the what-if sliders are instant and never overwrite your saved entries.
The Money trail is separate: only entries dated today or earlier become balanced ledger pairs, while
future dates stay in the forecast.
