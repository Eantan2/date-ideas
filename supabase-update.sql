-- Date Ideas: Supabase update for RECIPES and FEEDBACK.
-- Run this ONCE in Supabase > SQL Editor. Run supabase-setup.sql first (you already did).

-- 1. Recipes (shared by both of you)
create table if not exists public.recipes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recipes enable row level security;
grant select, insert, update, delete on public.recipes to authenticated;

create policy "members can read recipes" on public.recipes
  for select to authenticated using (public.is_member());
create policy "members can add recipes" on public.recipes
  for insert to authenticated with check (public.is_member());
create policy "members can edit recipes" on public.recipes
  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "members can delete recipes" on public.recipes
  for delete to authenticated using (public.is_member());

-- 2. Feedback on ideas: one row per person per idea.
--    You can read everyone's feedback, but only change your own.
create table if not exists public.feedback (
  idea_id text not null references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author text not null default '',
  reaction text check (reaction in ('up', 'meh', 'down')),
  comment text not null default '',
  updated_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table public.feedback enable row level security;
grant select, insert, update, delete on public.feedback to authenticated;

create policy "members can read feedback" on public.feedback
  for select to authenticated using (public.is_member());
create policy "members can add their own feedback" on public.feedback
  for insert to authenticated with check (public.is_member() and user_id = auth.uid());
create policy "members can edit their own feedback" on public.feedback
  for update to authenticated
  using (public.is_member() and user_id = auth.uid())
  with check (public.is_member() and user_id = auth.uid());
create policy "members can delete their own feedback" on public.feedback
  for delete to authenticated using (public.is_member() and user_id = auth.uid());
