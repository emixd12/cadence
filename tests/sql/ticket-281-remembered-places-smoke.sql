-- Local-only: psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/ticket-281-remembered-places-smoke.sql
-- Ticket 281: a corrected place is remembered as a place ID under the original text's key in
-- travel_place_cache. Owners cannot read or change each other's rows, no text column exists,
-- and turning travel off deletes only that owner's rows.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('28100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'remembered-places-' || i || '@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from generate_series(1, 2) i;

update public.travel_settings set enabled = true, mode = 'walking', routing_consent_at = statement_timestamp(), updated_at = statement_timestamp()
where user_id in ('28100000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000002');

do $$ begin
  -- The cache holds a key, an outcome, a place ID and a time: no place or event text.
  if (select array_agg(column_name::text order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'travel_place_cache')
     <> array['looked_up_at', 'outcome', 'place_id', 'text_key', 'user_id'] then
    raise exception 'travel_place_cache gained a column';
  end if;
end $$;

set local role authenticated;

-- Owner 1: the original text first looked up as ambiguous, then a correction remembers its place.
select set_config('request.jwt.claim.sub', '28100000-0000-4000-8000-000000000001', true);
insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
values ('28100000-0000-4000-8000-000000000001', repeat('k', 43), 'ambiguous', null, statement_timestamp());
insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
values ('28100000-0000-4000-8000-000000000001', repeat('k', 43), 'resolved', 'corrected-place', statement_timestamp())
on conflict (user_id, text_key) do update set outcome = excluded.outcome, place_id = excluded.place_id, looked_up_at = excluded.looked_up_at;
do $$ begin
  if (select place_id from public.travel_place_cache where text_key = repeat('k', 43)) is distinct from 'corrected-place' then
    raise exception 'The corrected place was not remembered';
  end if;
end $$;

-- Owner 2 cannot read, overwrite, change or delete owner 1's remembered place.
select set_config('request.jwt.claim.sub', '28100000-0000-4000-8000-000000000002', true);
do $$
declare
  changed integer;
begin
  if exists (select 1 from public.travel_place_cache) then
    raise exception 'Owner 2 read owner 1''s remembered place';
  end if;
  begin
    insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
    values ('28100000-0000-4000-8000-000000000001', repeat('k', 43), 'resolved', 'hijack', statement_timestamp())
    on conflict (user_id, text_key) do update set place_id = excluded.place_id;
    raise exception 'Owner 2 overwrote owner 1''s remembered place';
  exception when insufficient_privilege then null;
  end;
  update public.travel_place_cache set place_id = 'hijack' where text_key = repeat('k', 43);
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Owner 2 changed owner 1''s remembered place'; end if;
  delete from public.travel_place_cache where text_key = repeat('k', 43);
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Owner 2 deleted owner 1''s remembered place'; end if;
end $$;
-- The same text key is independent per owner.
insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
values ('28100000-0000-4000-8000-000000000002', repeat('k', 43), 'resolved', 'owner-2-place', statement_timestamp());
reset role;

do $$ begin
  if (select place_id from public.travel_place_cache where user_id = '28100000-0000-4000-8000-000000000001' and text_key = repeat('k', 43))
     is distinct from 'corrected-place' then
    raise exception 'Owner 1''s remembered place changed';
  end if;
end $$;

-- Turning travel off forgets owner 1's remembered places and leaves owner 2's.
update public.travel_settings set enabled = false, routing_consent_at = null
where user_id = '28100000-0000-4000-8000-000000000001';
do $$ begin
  if exists (select 1 from public.travel_place_cache where user_id = '28100000-0000-4000-8000-000000000001') then
    raise exception 'Turning travel off left a remembered place';
  end if;
  if (select place_id from public.travel_place_cache where user_id = '28100000-0000-4000-8000-000000000002') is distinct from 'owner-2-place' then
    raise exception 'Turning travel off for owner 1 changed owner 2''s places';
  end if;
end $$;

rollback;
