create extension if not exists pgcrypto;

create table if not exists public.flashcard_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcard_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_slug text not null,
  card_key text not null,
  card_title text not null,
  category_index integer not null default 0,
  category_label text not null default '',
  source_label text not null default '',
  attempts integer not null default 0 check (attempts >= 0),
  right_count integer not null default 0 check (right_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  last_result text check (last_result in ('right', 'wrong', 'review')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, deck_slug, card_key)
);

create table if not exists public.flashcard_study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_slug text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  studied_count integer not null default 0 check (studied_count >= 0),
  right_count integer not null default 0 check (right_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  review_count integer not null default 0 check (review_count >= 0)
);

create index if not exists flashcard_progress_user_deck_idx
  on public.flashcard_progress (user_id, deck_slug, category_index);

create index if not exists flashcard_progress_user_seen_idx
  on public.flashcard_progress (user_id, last_seen_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ensure_flashcard_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flashcard_profiles (user_id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.flashcard_profiles.display_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists flashcard_progress_set_updated_at on public.flashcard_progress;
create trigger flashcard_progress_set_updated_at
before update on public.flashcard_progress
for each row execute function public.set_updated_at();

drop trigger if exists flashcard_profiles_set_updated_at on public.flashcard_profiles;
create trigger flashcard_profiles_set_updated_at
before update on public.flashcard_profiles
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created_flashcard_profile on auth.users;
create trigger on_auth_user_created_flashcard_profile
after insert on auth.users
for each row execute function public.ensure_flashcard_profile();

alter table public.flashcard_profiles enable row level security;
alter table public.flashcard_progress enable row level security;
alter table public.flashcard_study_sessions enable row level security;

drop policy if exists "profiles_select_own" on public.flashcard_profiles;
create policy "profiles_select_own"
  on public.flashcard_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.flashcard_profiles;
create policy "profiles_insert_own"
  on public.flashcard_profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.flashcard_profiles;
create policy "profiles_update_own"
  on public.flashcard_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "progress_select_own" on public.flashcard_progress;
create policy "progress_select_own"
  on public.flashcard_progress
  for select
  using (auth.uid() = user_id);

drop policy if exists "progress_insert_own" on public.flashcard_progress;
create policy "progress_insert_own"
  on public.flashcard_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "progress_update_own" on public.flashcard_progress;
create policy "progress_update_own"
  on public.flashcard_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "progress_delete_own" on public.flashcard_progress;
create policy "progress_delete_own"
  on public.flashcard_progress
  for delete
  using (auth.uid() = user_id);

drop policy if exists "sessions_select_own" on public.flashcard_study_sessions;
create policy "sessions_select_own"
  on public.flashcard_study_sessions
  for select
  using (auth.uid() = user_id);

drop policy if exists "sessions_insert_own" on public.flashcard_study_sessions;
create policy "sessions_insert_own"
  on public.flashcard_study_sessions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "sessions_update_own" on public.flashcard_study_sessions;
create policy "sessions_update_own"
  on public.flashcard_study_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sessions_delete_own" on public.flashcard_study_sessions;
create policy "sessions_delete_own"
  on public.flashcard_study_sessions
  for delete
  using (auth.uid() = user_id);

create or replace view public.flashcard_category_summary as
select
  user_id,
  deck_slug,
  category_index,
  category_label,
  count(*) as cards,
  sum(attempts)::integer as attempts,
  sum(right_count)::integer as right_count,
  sum(wrong_count)::integer as wrong_count,
  sum(review_count)::integer as review_count,
  round(
    case when sum(attempts) > 0 then (sum(right_count)::numeric / sum(attempts)::numeric) * 100 else 0 end,
    2
  ) as accuracy_percent,
  round(
    case when sum(attempts) > 0 then ((sum(wrong_count)::numeric + sum(review_count)::numeric) / sum(attempts)::numeric) * 100 else 0 end,
    2
  ) as pressure_percent,
  max(last_seen_at) as last_seen_at
from public.flashcard_progress
group by user_id, deck_slug, category_index, category_label;
