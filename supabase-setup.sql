-- Kira Chess — execute o script completo no SQL Editor. Pode ser executado novamente.
create table if not exists public.kira_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Jogador',
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kira_profiles enable row level security;

drop policy if exists "kira_select_own_profile" on public.kira_profiles;
create policy "kira_select_own_profile"
on public.kira_profiles for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "kira_insert_own_profile" on public.kira_profiles;
create policy "kira_insert_own_profile"
on public.kira_profiles for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "kira_update_own_profile" on public.kira_profiles;
create policy "kira_update_own_profile"
on public.kira_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "kira_delete_own_profile" on public.kira_profiles;
create policy "kira_delete_own_profile"
on public.kira_profiles for delete
to authenticated
using (auth.uid() = user_id);

-- V6: optimistic compare-and-swap, safe to run again on an existing project.
alter table public.kira_profiles add column if not exists revision bigint not null default 0;

create or replace function public.kira_save_profile(
  p_user_id uuid, p_expected_revision bigint, p_profile jsonb, p_display_name text
) returns bigint language plpgsql security invoker set search_path = public as $$
declare next_revision bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Perfil pertence a outro usuário' using errcode = '42501';
  end if;
  update public.kira_profiles
    set profile = p_profile, display_name = left(p_display_name, 32),
        revision = revision + 1, updated_at = now()
    where user_id = p_user_id and revision = p_expected_revision
    returning revision into next_revision;
  if next_revision is not null then return next_revision; end if;
  if p_expected_revision = 0 then
    insert into public.kira_profiles(user_id, display_name, profile, revision)
      values(p_user_id, left(p_display_name, 32), p_profile, 1)
      on conflict (user_id) do nothing returning revision into next_revision;
  end if;
  return next_revision; -- null means conflict: reread, merge and retry.
end;
$$;
revoke all on function public.kira_save_profile(uuid,bigint,jsonb,text) from public, anon;
grant execute on function public.kira_save_profile(uuid,bigint,jsonb,text) to authenticated;
