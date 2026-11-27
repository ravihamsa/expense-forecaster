-- FinPlannar — optional user-selected icons for categories
-- Run this in the Supabase SQL Editor once. It is safe to re-run.
-- NULL or an empty string means the icon is chosen automatically from the name.

alter table public.categories add column if not exists icon text;

create index if not exists categories_user_icon_idx on public.categories(user_id, icon);
