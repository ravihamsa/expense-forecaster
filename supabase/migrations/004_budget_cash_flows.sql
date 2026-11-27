-- FinPlannar — link planned spends to their cash-flow occurrence
-- Run this in the Supabase SQL Editor once. It is safe to re-run.

alter table public.budgets
  add column if not exists cash_flow_id uuid references public.cash_flows(id) on delete set null;

create index if not exists budgets_cash_flow_idx on public.budgets(user_id, cash_flow_id);
