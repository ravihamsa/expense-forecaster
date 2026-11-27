-- FinPlannar — calendar moves for planned spends
-- Run this in the Supabase SQL Editor once. It is safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.budget_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, budget_id, from_date)
);

create index if not exists budget_moves_user_idx on public.budget_moves(user_id);
create index if not exists budget_moves_budget_idx on public.budget_moves(budget_id);

alter table public.budget_moves enable row level security;
drop policy if exists "budget_moves_select_own" on public.budget_moves;
drop policy if exists "budget_moves_insert_own" on public.budget_moves;
drop policy if exists "budget_moves_update_own" on public.budget_moves;
drop policy if exists "budget_moves_delete_own" on public.budget_moves;
create policy "budget_moves_select_own" on public.budget_moves
  for select to authenticated using (auth.uid() = user_id);
create policy "budget_moves_insert_own" on public.budget_moves
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.budgets
      where id = budget_id and user_id = auth.uid()
    )
  );
create policy "budget_moves_update_own" on public.budget_moves
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.budgets
      where id = budget_id and user_id = auth.uid()
    )
  );
create policy "budget_moves_delete_own" on public.budget_moves
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.budget_moves to authenticated;
