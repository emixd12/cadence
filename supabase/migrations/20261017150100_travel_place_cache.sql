begin;

-- Ticket 214: look up each typed travel location once. Rows hold a hash of the
-- normalized text and Google's place ID, which Google permits storing
-- indefinitely. They hold no location text, coordinates or route content.
-- The refresh service treats resolved rows older than 365 days and other
-- outcomes older than 30 days as missing. Turning travel off deletes the rows.

create table public.travel_place_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  text_key text not null check (text_key ~ '^[A-Za-z0-9_-]{43}$'),
  outcome text not null check (outcome in ('resolved', 'unresolved', 'ambiguous')),
  place_id text,
  looked_up_at timestamptz not null,
  primary key (user_id, text_key),
  constraint travel_place_cache_place_id_matches_outcome check (
    (outcome = 'resolved' and place_id is not null
      and char_length(place_id) between 1 and 512
      and place_id !~ '[[:space:][:cntrl:]]')
    or (outcome <> 'resolved' and place_id is null)
  )
);

alter table public.travel_place_cache enable row level security;

create policy "Users can read their own travel place cache"
on public.travel_place_cache
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add to their own travel place cache"
on public.travel_place_cache
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own travel place cache"
on public.travel_place_cache
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own travel place cache"
on public.travel_place_cache
for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.travel_place_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.travel_place_cache to authenticated;

-- Web Settings and desktop account sync both write travel_settings, so the
-- deletion lives in the database rather than in one save path.
create or replace function cadence_private.clear_travel_place_cache_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.enabled and not new.enabled then
    delete from public.travel_place_cache where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.clear_travel_place_cache_on_disable() from public, anon, authenticated, service_role;

create trigger travel_settings_clear_place_cache
after update of enabled on public.travel_settings
for each row
execute function cadence_private.clear_travel_place_cache_on_disable();

commit;
