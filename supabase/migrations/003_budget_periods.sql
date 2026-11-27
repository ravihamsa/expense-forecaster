-- FinPlannar — monthly, yearly and one-time budget allocations
-- Run this in the Supabase SQL Editor once. It is safe to re-run.

create extension if not exists pgcrypto;

alter table public.budgets add column if not exists period text not null default 'monthly';
alter table public.budgets add column if not exists start_date date not null default '1970-01-01';
alter table public.budgets add column if not exists name text not null default '';

do $$
begin
  alter table public.budgets add constraint budgets_period_check
    check (period in ('monthly', 'yearly', 'one_time'));
exception when duplicate_object then null;
end;
$$;

-- One budget per category per period per start date. Existing monthly budgets
-- keep their old (user_id, category) uniqueness because they share the sentinel start date.
alter table public.budgets drop constraint if exists budgets_user_id_category_key;
create unique index if not exists budgets_user_category_period_start_uidx
  on public.budgets(user_id, category, period, start_date);
create index if not exists budgets_period_start_idx on public.budgets(user_id, start_date);
