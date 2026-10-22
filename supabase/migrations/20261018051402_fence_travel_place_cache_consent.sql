begin;

-- A lookup finishing after travel is disabled must not recreate deleted place IDs.
create function cadence_private.fence_travel_place_cache_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from auth.uid() then
    raise exception 'Travel place ownership is required.' using errcode = '42501';
  end if;
  -- Serialize cache writes with disabling travel, which locks this same row before deletion.
  perform 1 from public.travel_settings
  where user_id = new.user_id and enabled and routing_consent_at is not null
  for share;
  if not found then return null; end if;
  return new;
end;
$$;
revoke all on function cadence_private.fence_travel_place_cache_consent() from public, anon, authenticated, service_role;
create trigger travel_place_cache_consent
before insert or update on public.travel_place_cache
for each row execute function cadence_private.fence_travel_place_cache_consent();

commit;
