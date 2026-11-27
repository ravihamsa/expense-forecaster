-- FinPlannar — accounts, transfers and reusable categories
-- Run this in the Supabase SQL Editor if your project was created before these
-- features. It is safe to re-run.

create extension if not exists pgcrypto;

-- Account ids are user-defined now, so the old cash/bank-only checks must go.
alter table public.cash_flows drop constraint if exists cash_flows_account_check;
alter table public.loans drop constraint if exists loans_account_check;
alter table public.loan_payments drop constraint if exists loan_payments_account_check;
alter table public.vendor_rules drop constraint if exists vendor_rules_account_check;

-- Recorded amounts remember which account actually paid/received them.
alter table public.actuals add column if not exists account text not null default 'bank';

-- Reusable category names. Every row keeps the name, so editing a category here
-- updates all future forms; existing rows are remapped by the app when renamed.
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

-- Seed the built-in lists once per profile. Other is kept as the fallback.
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

-- User-defined balance buckets. 'cash' and 'bank' are seeded for every profile;
-- custom accounts (for example a farm-house build fund) get generated ids.
create table if not exists public.accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null default '',
  kind text not null default 'other' check (kind in ('cash', 'bank', 'other')),
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

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

create index if not exists accounts_user_idx on public.accounts(user_id);
create index if not exists transfers_user_idx on public.transfers(user_id);
create index if not exists transfers_date_idx on public.transfers(date);

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

grant select, insert, update, delete on public.categories, public.accounts, public.transfers to authenticated;

-- Existing profiles keep their current starting amounts as the built-in rows.
insert into public.accounts (user_id, id, name, kind, opening_balance)
select p.user_id, 'cash', 'Cash in hand', 'cash', p.cash_in_hand
from public.profiles p
on conflict (user_id, id) do nothing;
insert into public.accounts (user_id, id, name, kind, opening_balance)
select p.user_id, 'bank', 'Bank balance', 'bank', p.bank_balance
from public.profiles p
on conflict (user_id, id) do nothing;

-- Existing profiles get the editable default category lists.
do $$
declare
  profile_row record;
begin
  for profile_row in select user_id from public.profiles loop
    perform public.seed_default_categories(profile_row.user_id);
  end loop;
end;
$$;

-- New signups start with both built-in accounts and both category lists.
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
