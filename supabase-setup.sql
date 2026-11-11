-- Date Ideas: Supabase setup. Run this ONCE in Supabase > SQL Editor.
--
-- BEFORE running: create both user accounts (Authentication > Users > Add user),
-- then change the two email addresses in the LAST step (step 5) below.

-- 1. The list of people allowed in. The app itself cannot read or change this list.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.members enable row level security;

-- 2. A yes/no check: "is the signed-in person on the list?"
create or replace function public.is_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- 3. Date ideas. All details live in the "data" column.
create table if not exists public.ideas (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ideas enable row level security;
grant select, insert, update, delete on public.ideas to authenticated;

create policy "members can read ideas" on public.ideas
  for select to authenticated using (public.is_member());
create policy "members can add ideas" on public.ideas
  for insert to authenticated with check (public.is_member());
create policy "members can edit ideas" on public.ideas
  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "members can delete ideas" on public.ideas
  for delete to authenticated using (public.is_member());

-- 4. Private photo storage (JPEG only, 5 MB max each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "members can read photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "members can add photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "members can delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_member());

-- 5. EDIT THESE TWO EMAILS to the ones you used when you created the users.
insert into public.members (user_id)
select id from auth.users
where email in ('you@example.com', 'partner@example.com')
on conflict do nothing;
