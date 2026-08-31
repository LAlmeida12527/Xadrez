-- Kira Chess V5 — execute no SQL Editor do Supabase uma única vez.
create table if not exists public.kira_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Jogador',
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kira_profiles enable row level security;

create policy "kira_select_own_profile"
on public.kira_profiles for select
to authenticated
using (auth.uid() = user_id);

create policy "kira_insert_own_profile"
on public.kira_profiles for insert
to authenticated
with check (auth.uid() = user_id);

create policy "kira_update_own_profile"
on public.kira_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "kira_delete_own_profile"
on public.kira_profiles for delete
to authenticated
using (auth.uid() = user_id);
