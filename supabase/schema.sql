-- FinPlannar — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  currency text not null default 'INR',
  monthly_income numeric(14, 2) not null default 0 check (monthly_income >= 0),
  cash_in_hand numeric(14, 2) not null default 0 check (cash_in_hand >= 0),
  bank_balance numeric(14, 2) not null default 0 check (bank_balance >= 0),
  opening_balance numeric(14, 2) not null default 0,
  horizon_months integer not null default 12 check (horizon_months between 1 and 36),
  income_growth_pct numeric(6, 2) not null default 0,
  expense_inflation_pct numeric(6, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month char(7) not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14, 2) not null check (amount >= 0),
  day integer not null default 1 check (day between 1 and 31),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

create index if not exists monthly_incomes_user_idx on public.monthly_incomes(user_id);

-- Calendar rescheduling stores the payment day for planned monthly income.
alter table public.monthly_incomes add column if not exists day integer not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_incomes_day_check') then
    alter table public.monthly_incomes add constraint monthly_incomes_day_check check (day between 1 and 31);
  end if;
end $$;

alter table public.monthly_incomes enable row level security;
drop policy if exists "monthly_incomes_select_own" on public.monthly_incomes;
drop policy if exists "monthly_incomes_insert_own" on public.monthly_incomes;
drop policy if exists "monthly_incomes_update_own" on public.monthly_incomes;
drop policy if exists "monthly_incomes_delete_own" on public.monthly_incomes;
create policy "monthly_incomes_select_own" on public.monthly_incomes
  for select to authenticated using (auth.uid() = user_id);
create policy "monthly_incomes_insert_own" on public.monthly_incomes
  for insert to authenticated with check (auth.uid() = user_id);
create policy "monthly_incomes_update_own" on public.monthly_incomes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "monthly_incomes_delete_own" on public.monthly_incomes
  for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.cash_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  name text not null,
  amount numeric(14, 2) not null check (amount > 0),
  category text not null default 'Other',
  account text not null default 'bank',
  recurrence text not null default 'monthly'
    check (recurrence in ('one_time', 'monthly', 'yearly', 'every_n_months', 'every_n_years')),
  interval_count integer not null default 1 check (interval_count > 0),
  start_date date not null default current_date,
  end_date date,
  source text not null default 'manual' check (source in ('manual', 'sms')),
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint cash_flows_date_order check (end_date is null or end_date >= start_date)
);

-- Existing projects: add the import tag without changing manual rows.
alter table public.cash_flows add column if not exists source text not null default 'manual';
do $$
begin
  alter table public.cash_flows
    add constraint cash_flows_source_check check (source in ('manual', 'sms'));
exception
  when duplicate_object then null;
end $$;

-- Fixed amounts for individual occurrences of a scheduled cash flow.
create table if not exists public.cash_flow_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cash_flow_id uuid not null references public.cash_flows(id) on delete cascade,
  month char(7) not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, cash_flow_id, month)
);

create index if not exists cash_flow_overrides_user_idx on public.cash_flow_overrides(user_id);

alter table public.cash_flow_overrides enable row level security;
drop policy if exists "cash_flow_overrides_select_own" on public.cash_flow_overrides;
drop policy if exists "cash_flow_overrides_insert_own" on public.cash_flow_overrides;
drop policy if exists "cash_flow_overrides_update_own" on public.cash_flow_overrides;
drop policy if exists "cash_flow_overrides_delete_own" on public.cash_flow_overrides;
create policy "cash_flow_overrides_select_own" on public.cash_flow_overrides
  for select to authenticated using (auth.uid() = user_id);
create policy "cash_flow_overrides_insert_own" on public.cash_flow_overrides
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_overrides_update_own" on public.cash_flow_overrides
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_overrides_delete_own" on public.cash_flow_overrides
  for delete to authenticated using (auth.uid() = user_id);

-- Calendar moves: one scheduled occurrence is rescheduled to a new date.
create table if not exists public.cash_flow_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cash_flow_id uuid not null references public.cash_flows(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, cash_flow_id, from_date)
);

create index if not exists cash_flow_moves_user_idx on public.cash_flow_moves(user_id);
create index if not exists cash_flow_moves_flow_idx on public.cash_flow_moves(cash_flow_id);

alter table public.cash_flow_moves enable row level security;
drop policy if exists "cash_flow_moves_select_own" on public.cash_flow_moves;
drop policy if exists "cash_flow_moves_insert_own" on public.cash_flow_moves;
drop policy if exists "cash_flow_moves_update_own" on public.cash_flow_moves;
drop policy if exists "cash_flow_moves_delete_own" on public.cash_flow_moves;
create policy "cash_flow_moves_select_own" on public.cash_flow_moves
  for select to authenticated using (auth.uid() = user_id);
create policy "cash_flow_moves_insert_own" on public.cash_flow_moves
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_moves_update_own" on public.cash_flow_moves
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_moves_delete_own" on public.cash_flow_moves
  for delete to authenticated using (auth.uid() = user_id);

-- Calendar delete: one occurrence of a cash flow is skipped, not the whole plan.
create table if not exists public.cash_flow_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cash_flow_id uuid not null references public.cash_flows(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, cash_flow_id, date)
);

create index if not exists cash_flow_skips_user_idx on public.cash_flow_skips(user_id);
create index if not exists cash_flow_skips_flow_idx on public.cash_flow_skips(cash_flow_id);

alter table public.cash_flow_skips enable row level security;
drop policy if exists "cash_flow_skips_select_own" on public.cash_flow_skips;
drop policy if exists "cash_flow_skips_insert_own" on public.cash_flow_skips;
drop policy if exists "cash_flow_skips_update_own" on public.cash_flow_skips;
drop policy if exists "cash_flow_skips_delete_own" on public.cash_flow_skips;
create policy "cash_flow_skips_select_own" on public.cash_flow_skips
  for select to authenticated using (auth.uid() = user_id);
create policy "cash_flow_skips_insert_own" on public.cash_flow_skips
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_skips_update_own" on public.cash_flow_skips
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.cash_flows
      where id = cash_flow_id and user_id = auth.uid()
    )
  );
create policy "cash_flow_skips_delete_own" on public.cash_flow_skips
  for delete to authenticated using (auth.uid() = user_id);

-- Monthly spending limits by category.
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  monthly_limit numeric(14, 2) not null check (monthly_limit >= 0),
  rollover boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, category)
);

create index if not exists budgets_user_idx on public.budgets(user_id);

alter table public.budgets enable row level security;
drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;
drop policy if exists "budgets_delete_own" on public.budgets;
create policy "budgets_select_own" on public.budgets
  for select to authenticated using (auth.uid() = user_id);
create policy "budgets_insert_own" on public.budgets
  for insert to authenticated with check (auth.uid() = user_id);
create policy "budgets_update_own" on public.budgets
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_delete_own" on public.budgets
  for delete to authenticated using (auth.uid() = user_id);

-- Savings goals and sinking funds.
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14, 2) not null default 0 check (target_amount >= 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  target_date char(7),
  monthly_contribution numeric(14, 2) not null default 0 check (monthly_contribution >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists goals_user_idx on public.goals(user_id);

alter table public.goals enable row level security;
drop policy if exists "goals_select_own" on public.goals;
drop policy if exists "goals_insert_own" on public.goals;
drop policy if exists "goals_update_own" on public.goals;
drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_select_own" on public.goals
  for select to authenticated using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals
  for insert to authenticated with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals_delete_own" on public.goals
  for delete to authenticated using (auth.uid() = user_id);

-- Vendor rules learned by the SMS companion. One signed-in user owns each rule.
create table if not exists public.vendor_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_key text not null,
  vendor_name text not null default '',
  kind text not null check (kind in ('income', 'expense')),
  category text not null default 'Other',
  account text not null default 'bank',
  auto_apply boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, vendor_key)
);

create index if not exists vendor_rules_user_idx on public.vendor_rules(user_id);

alter table public.vendor_rules enable row level security;
drop policy if exists "vendor_rules_select_own" on public.vendor_rules;
drop policy if exists "vendor_rules_insert_own" on public.vendor_rules;
drop policy if exists "vendor_rules_update_own" on public.vendor_rules;
drop policy if exists "vendor_rules_delete_own" on public.vendor_rules;
create policy "vendor_rules_select_own" on public.vendor_rules
  for select to authenticated using (auth.uid() = user_id);
create policy "vendor_rules_insert_own" on public.vendor_rules
  for insert to authenticated with check (auth.uid() = user_id);
create policy "vendor_rules_update_own" on public.vendor_rules
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vendor_rules_delete_own" on public.vendor_rules
  for delete to authenticated using (auth.uid() = user_id);

-- Recorded amounts for planned occurrences. event_key is the stable forecast id.
create table if not exists public.actuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  cash_flow_id uuid references public.cash_flows(id) on delete set null,
  date date not null,
  name text not null,
  category text not null default '',
  kind text not null check (kind in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount >= 0),
  source text not null default 'manual' check (source in ('manual', 'sms')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

alter table public.actuals add column if not exists source text not null default 'manual';
do $$
begin
  alter table public.actuals
    add constraint actuals_source_check check (source in ('manual', 'sms'));
exception
  when duplicate_object then null;
end $$;

create index if not exists actuals_user_idx on public.actuals(user_id);
create index if not exists actuals_date_idx on public.actuals(date);

alter table public.actuals enable row level security;
drop policy if exists "actuals_select_own" on public.actuals;
drop policy if exists "actuals_insert_own" on public.actuals;
drop policy if exists "actuals_update_own" on public.actuals;
drop policy if exists "actuals_delete_own" on public.actuals;
create policy "actuals_select_own" on public.actuals
  for select to authenticated using (auth.uid() = user_id);
create policy "actuals_insert_own" on public.actuals
  for insert to authenticated with check (auth.uid() = user_id);
create policy "actuals_update_own" on public.actuals
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "actuals_delete_own" on public.actuals
  for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account text not null default 'bank',
  direction text not null default 'borrowed' check (direction in ('borrowed', 'lent')),
  repayment_type text not null default 'emi' check (repayment_type in ('emi', 'one_time')),
  principal numeric(14, 2) not null default 0 check (principal >= 0),
  outstanding numeric(14, 2) not null default 0 check (outstanding >= 0),
  interest_rate numeric(6, 2) not null default 0 check (interest_rate >= 0),
  emi numeric(14, 2) not null default 0 check (emi >= 0),
  start_date date not null default current_date,
  tenure_months integer not null default 0 check (tenure_months >= 0),
  due_day integer not null default 1 check (due_day between 1 and 31),
  due_date date,
  created_at timestamptz not null default now()
);

-- Safely upgrade databases created with the earlier schema.
alter table public.loans add column if not exists repayment_type text not null default 'emi';
alter table public.loans add column if not exists due_date date;
alter table public.loans add column if not exists direction text not null default 'borrowed';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_repayment_type_check') then
    alter table public.loans add constraint loans_repayment_type_check
      check (repayment_type in ('emi', 'one_time'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_direction_check') then
    alter table public.loans add constraint loans_direction_check
      check (direction in ('borrowed', 'lent'));
  end if;
end $$;

alter table public.profiles add column if not exists cash_in_hand numeric(14, 2) not null default 0;
alter table public.profiles add column if not exists bank_balance numeric(14, 2) not null default 0;
-- Existing profiles keep their old opening balance as the bank-side starting point.
update public.profiles set bank_balance = opening_balance
  where cash_in_hand = 0 and bank_balance = 0 and opening_balance > 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_cash_in_hand_check') then
    alter table public.profiles add constraint profiles_cash_in_hand_check check (cash_in_hand >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bank_balance_check') then
    alter table public.profiles add constraint profiles_bank_balance_check check (bank_balance >= 0);
  end if;
end $$;

create table if not exists public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  payment_date date not null,
  account text not null default 'bank',
  note text not null default '',
  applied_to_balance boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.loan_payments add column if not exists applied_to_balance boolean not null default false;

-- Every money movement names the account it passes through. Account ids are
-- user-defined (see public.accounts), so the old two-value checks are removed.
alter table public.cash_flows add column if not exists account text not null default 'bank';
alter table public.loans add column if not exists account text not null default 'bank';
alter table public.loan_payments add column if not exists account text not null default 'bank';
alter table public.cash_flows drop constraint if exists cash_flows_account_check;
alter table public.loans drop constraint if exists loans_account_check;
alter table public.loan_payments drop constraint if exists loan_payments_account_check;
alter table public.vendor_rules drop constraint if exists vendor_rules_account_check;

create index if not exists cash_flows_user_idx on public.cash_flows(user_id);
create index if not exists loans_user_idx on public.loans(user_id);
create index if not exists loan_payments_user_idx on public.loan_payments(user_id);
create index if not exists loan_payments_loan_idx on public.loan_payments(loan_id);

-- ---------------------------------------------------------------------------
-- Multiple money accounts + net-neutral transfers
-- ---------------------------------------------------------------------------

-- User-defined buckets. 'cash' and 'bank' are seeded for every profile; custom
-- accounts (e.g. a farm-house build fund) get generated ids.
create table if not exists public.accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null default '',
  kind text not null default 'other' check (kind in ('cash', 'bank', 'other')),
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Existing projects created before this default still need it when re-running.
alter table public.accounts alter column id set default gen_random_uuid()::text;

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_account text not null,
  to_account text not null,
  amount numeric(14, 2) not null check (amount > 0),
  date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (from_account <> to_account)
);

-- Recorded amounts remember which account actually paid/received them.
alter table public.actuals add column if not exists account text not null default 'bank';

-- Reusable category names, editable from the Categories page.
create table if not exists public.categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null,
  kind text not null default 'expense' check (kind in ('income', 'expense')),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, kind, name)
);

alter table public.categories alter column id set default gen_random_uuid()::text;

create index if not exists categories_user_idx on public.categories(user_id);
create index if not exists accounts_user_idx on public.accounts(user_id);
create index if not exists transfers_user_idx on public.transfers(user_id);
create index if not exists transfers_date_idx on public.transfers(date);

alter table public.categories enable row level security;
drop policy if exists "categories_select_own" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;
drop policy if exists "categories_update_own" on public.categories;
drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select to authenticated using (auth.uid() = user_id);
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check (auth.uid() = user_id);
create policy "categories_update_own" on public.categories
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_delete_own" on public.categories
  for delete to authenticated using (auth.uid() = user_id);

alter table public.accounts enable row level security;
drop policy if exists "accounts_select_own" on public.accounts;
drop policy if exists "accounts_insert_own" on public.accounts;
drop policy if exists "accounts_update_own" on public.accounts;
drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select to authenticated using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.accounts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.accounts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts_delete_own" on public.accounts
  for delete to authenticated using (auth.uid() = user_id);

alter table public.transfers enable row level security;
drop policy if exists "transfers_select_own" on public.transfers;
drop policy if exists "transfers_insert_own" on public.transfers;
drop policy if exists "transfers_update_own" on public.transfers;
drop policy if exists "transfers_delete_own" on public.transfers;
create policy "transfers_select_own" on public.transfers
  for select to authenticated using (auth.uid() = user_id);
create policy "transfers_insert_own" on public.transfers
  for insert to authenticated with check (auth.uid() = user_id);
create policy "transfers_update_own" on public.transfers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transfers_delete_own" on public.transfers
  for delete to authenticated using (auth.uid() = user_id);

-- Existing profiles keep their current starting amounts as the built-in rows.
insert into public.accounts (user_id, id, name, kind, opening_balance)
select p.user_id, 'cash', 'Cash in hand', 'cash', p.cash_in_hand
from public.profiles p
on conflict (user_id, id) do nothing;
insert into public.accounts (user_id, id, name, kind, opening_balance)
select p.user_id, 'bank', 'Bank balance', 'bank', p.bank_balance
from public.profiles p
on conflict (user_id, id) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security — each user sees only their own data
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.cash_flows enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cash_flows_select_own" on public.cash_flows;
drop policy if exists "cash_flows_insert_own" on public.cash_flows;
drop policy if exists "cash_flows_update_own" on public.cash_flows;
drop policy if exists "cash_flows_delete_own" on public.cash_flows;

create policy "cash_flows_select_own" on public.cash_flows
  for select to authenticated using (auth.uid() = user_id);
create policy "cash_flows_insert_own" on public.cash_flows
  for insert to authenticated with check (auth.uid() = user_id);
create policy "cash_flows_update_own" on public.cash_flows
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cash_flows_delete_own" on public.cash_flows
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "loans_select_own" on public.loans;
drop policy if exists "loans_insert_own" on public.loans;
drop policy if exists "loans_update_own" on public.loans;
drop policy if exists "loans_delete_own" on public.loans;

create policy "loans_select_own" on public.loans
  for select to authenticated using (auth.uid() = user_id);
create policy "loans_insert_own" on public.loans
  for insert to authenticated with check (auth.uid() = user_id);
create policy "loans_update_own" on public.loans
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "loans_delete_own" on public.loans
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "loan_payments_select_own" on public.loan_payments;
drop policy if exists "loan_payments_insert_own" on public.loan_payments;
drop policy if exists "loan_payments_update_own" on public.loan_payments;
drop policy if exists "loan_payments_delete_own" on public.loan_payments;

create policy "loan_payments_select_own" on public.loan_payments
  for select to authenticated using (auth.uid() = user_id);
create policy "loan_payments_insert_own" on public.loan_payments
  for insert to authenticated with check (auth.uid() = user_id);
create policy "loan_payments_update_own" on public.loan_payments
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "loan_payments_delete_own" on public.loan_payments
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.profiles, public.monthly_incomes, public.cash_flows, public.cash_flow_overrides, public.cash_flow_moves, public.cash_flow_skips, public.budgets, public.goals, public.vendor_rules, public.actuals, public.loans, public.loan_payments, public.categories, public.accounts, public.transfers to authenticated;

-- ---------------------------------------------------------------------------
-- Editable default category lists
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_categories(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (user_id, id, name, kind)
  select target_user,
         'default-expense-' || trim(both '-' from regexp_replace(lower(d.name), '[^a-z0-9]+', '-', 'g')),
         d.name,
         'expense'
  from unnest(array[
    'Housing', 'Utilities', 'Groceries', 'Transport', 'Insurance', 'Health', 'Education',
    'Shopping', 'Dining', 'Entertainment', 'Subscriptions', 'Travel', 'Lifestyle',
    'Hobbies', 'Investments', 'Other'
  ]) as d(name)
  on conflict (user_id, kind, name) do nothing;
  insert into public.categories (user_id, id, name, kind)
  select target_user,
         'default-income-' || trim(both '-' from regexp_replace(lower(d.name), '[^a-z0-9]+', '-', 'g')),
         d.name,
         'income'
  from unnest(array[
    'Salary', 'Business', 'Freelance', 'Rent Received', 'Interest', 'Dividends', 'Gifts', 'Other'
  ]) as d(name)
  on conflict (user_id, kind, name) do nothing;
end;
$$;

do $$
declare
  profile_row record;
begin
  for profile_row in select user_id from public.profiles loop
    perform public.seed_default_categories(profile_row.user_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a profile automatically when a new user signs up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  insert into public.accounts (user_id, id, name, kind, opening_balance)
  values
    (new.id, 'cash', 'Cash in hand', 'cash', 0),
    (new.id, 'bank', 'Bank balance', 'bank', 0)
  on conflict (user_id, id) do nothing;
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
