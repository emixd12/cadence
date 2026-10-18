-- Local-only: docker exec -i supabase_db_habit-tracking-app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < tests/sql/ticket-213-travel-monthly-budget-smoke.sql
-- Tickets 213-214: monthly budget ceiling, refusal, renewal, ledger privileges and place-cache clearing.
begin;

do $$ begin
  if exists (select 1 from public.travel_spend_owner_month) or exists (select 1 from public.travel_spend_global_day) then
    raise exception 'This smoke requires empty travel spend ledgers';
  end if;
end $$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('21300000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'travel-spend-' || i || '@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from generate_series(1, 3) i;

update public.travel_settings set enabled = true, mode = 'walking', routing_consent_at = statement_timestamp(), updated_at = statement_timestamp()
where user_id = '21300000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
declare
  decision record;
  i integer;
  expected_reset timestamptz;
begin
  -- Owner 1 reserves exactly the US$5.00 ceiling; one more microdollar is refused.
  perform set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000001', true);
  for i in 1..25 loop
    select * into decision from public.reserve_travel_provider_spend(200000);
    if not decision.allowed or decision.resets_at is not null then
      raise exception 'Reservation % was refused below the ceiling', i;
    end if;
  end loop;
  select * into decision from public.reserve_travel_provider_spend(1);
  expected_reset := (date_trunc('month', statement_timestamp() at time zone 'America/New_York') + interval '1 month') at time zone 'America/New_York';
  if decision.allowed then raise exception 'The owner ceiling was exceeded'; end if;
  if decision.resets_at <> expected_reset then
    raise exception 'Refusal named % instead of the next local month %', decision.resets_at, expected_reset;
  end if;
  if decision.retry_after_seconds < 1 then raise exception 'Refusal returned no retry delay'; end if;
  if (select reserved_microdollars from public.travel_spend_owner_month
      where user_id = '21300000-0000-4000-8000-000000000001') <> 5000000 then
    raise exception 'A refused request changed the owner ledger';
  end if;

  begin
    perform public.reserve_travel_provider_spend(0);
    raise exception 'A zero reservation was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.reserve_travel_provider_spend(200001);
    raise exception 'An oversized reservation was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Owner 2 is independent of owner 1 and fills the US$10.00 daily circuit breaker.
  perform set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000002', true);
  for i in 1..25 loop
    select * into decision from public.reserve_travel_provider_spend(200000);
    if not decision.allowed then raise exception 'Owner 2 reservation % was refused', i; end if;
  end loop;

  -- Owner 3 has its own allowance but meets the circuit breaker, which renews at UTC midnight.
  perform set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000003', true);
  select * into decision from public.reserve_travel_provider_spend(5000);
  if decision.allowed then raise exception 'The daily circuit breaker was exceeded'; end if;
  if decision.resets_at <> ((statement_timestamp() at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC' then
    raise exception 'Circuit breaker refusal named % instead of the next UTC day', decision.resets_at;
  end if;

  -- Ledgers are written only through the function.
  begin
    update public.travel_spend_owner_month set reserved_microdollars = 0;
    raise exception 'An authenticated caller reset its owner ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.travel_spend_global_day;
    raise exception 'An authenticated caller read the global ledger';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.travel_spend_owner_month where user_id <> '21300000-0000-4000-8000-000000000003') <> 0 then
    raise exception 'Owner 3 read another owner''s spend';
  end if;
end $$;
reset role;

-- A new month and a new UTC day renew both allowances.
update public.travel_spend_owner_month set local_month = (local_month - interval '1 month')::date;
update public.travel_spend_global_day set utc_date = utc_date - 1;
set local role authenticated;
select set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000001', true);
do $$ begin
  if not (select allowed from public.reserve_travel_provider_spend(200000)) then
    raise exception 'The owner allowance did not renew in a new month';
  end if;
end $$;

-- Place cache: owners see only their rows, and turning travel off deletes them.
insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
values ('21300000-0000-4000-8000-000000000001', repeat('a', 43), 'resolved', 'place-1', statement_timestamp()),
       ('21300000-0000-4000-8000-000000000001', repeat('b', 43), 'unresolved', null, statement_timestamp());
do $$ begin
  begin
    insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
    values ('21300000-0000-4000-8000-000000000002', repeat('c', 43), 'resolved', 'place-2', statement_timestamp());
    raise exception 'An owner wrote another owner''s place cache';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
    values ('21300000-0000-4000-8000-000000000001', repeat('d', 43), 'resolved', null, statement_timestamp());
    raise exception 'A resolved row without a place ID was accepted';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from public.travel_place_cache) <> 0 then
    raise exception 'Owner 2 read owner 1''s place cache';
  end if;
end $$;
reset role;

update public.travel_settings set enabled = true, mode = 'walking', routing_consent_at = statement_timestamp(), updated_at = statement_timestamp()
where user_id = '21300000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from public.travel_place_cache where user_id = '21300000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Enabling travel changed the place cache';
  end if;
end $$;
update public.travel_settings set enabled = false, routing_consent_at = null
where user_id = '21300000-0000-4000-8000-000000000001';
do $$ begin
  if exists (select 1 from public.travel_place_cache where user_id = '21300000-0000-4000-8000-000000000001') then
    raise exception 'Turning travel off left place cache rows';
  end if;
  if has_function_privilege('anon', 'public.reserve_travel_provider_spend(integer)', 'EXECUTE') then
    raise exception 'Anonymous callers can reserve travel spend';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '21300000-0000-4000-8000-000000000001', true);
insert into public.travel_place_cache (user_id, text_key, outcome, place_id, looked_up_at)
values ('21300000-0000-4000-8000-000000000001', repeat('e', 43), 'resolved', 'late-lookup', statement_timestamp());
do $$ begin
  if exists (select 1 from public.travel_place_cache) then
    raise exception 'A late lookup recreated the cache after disabling travel';
  end if;
end $$;
reset role;
rollback;
