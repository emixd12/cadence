-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-277-preparation-changed-smoke.sql
-- Ticket 277 follow-up: travel_settings.preparation_changed_at is the database's own
-- time of the last hosted get-ready change. A new row has none; a client value is never
-- kept; only a change to preparation_minutes stamps it, whatever habits_updated_at says;
-- users cannot call the trigger function. Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('27700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'prep-smoke@example.invalid', '{}', '{}');

do $$
begin
  if (select preparation_changed_at from public.travel_settings where user_id = '27700000-0000-4000-8000-000000000001') is not null then
    raise exception 'A new travel settings row had a get-ready change time.';
  end if;
  if has_function_privilege('authenticated', 'cadence_private.stamp_travel_preparation_change()', 'execute')
    or has_function_privilege('anon', 'cadence_private.stamp_travel_preparation_change()', 'execute') then
    raise exception 'A user role can call the get-ready stamp function.';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"27700000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- A client value is never kept.
update public.travel_settings set preparation_changed_at = '2030-01-01T00:00:00Z';
do $$
begin
  if (select preparation_changed_at from public.travel_settings) is not null then
    raise exception 'A client set the get-ready change time.';
  end if;
end;
$$;

-- A get-ready change is stamped with the database time, even when the device's
-- habits revision says 2020 (a slow clock or a late offline sync).
update public.travel_settings
set preparation_minutes = 30, habits_updated_at = '2020-01-01T00:00:00.000000Z', preparation_changed_at = '2020-01-01T00:00:00Z';
do $$
declare
  stamped timestamptz := (select preparation_changed_at from public.travel_settings);
begin
  if stamped is null or stamped < now() or stamped > clock_timestamp() then
    raise exception 'A get-ready change was not stamped with the database time: %', stamped;
  end if;
end;
$$;
select set_config('smoke.first_stamp', preparation_changed_at::text, true) from public.travel_settings;

-- Other habit or settings writes, and an unchanged get-ready time, keep the stamp.
select pg_sleep(0.01);
update public.travel_settings set arrival_buffer_minutes = 5, habits_updated_at = '2026-11-06T17:00:00.000000Z',
  preparation_changed_at = '2030-01-01T00:00:00Z';
update public.travel_settings set preparation_minutes = 30;
do $$
begin
  if (select preparation_changed_at from public.travel_settings) <> current_setting('smoke.first_stamp')::timestamptz then
    raise exception 'A write that kept the get-ready time moved its change time.';
  end if;
end;
$$;

-- Back to the default is a change too.
select pg_sleep(0.01);
update public.travel_settings set preparation_minutes = null;
do $$
begin
  if (select preparation_changed_at from public.travel_settings) <= current_setting('smoke.first_stamp')::timestamptz then
    raise exception 'Clearing the get-ready time did not stamp a later change time.';
  end if;
end;
$$;
reset role;

select 'ticket-277 preparation change time smoke passed' as result;

rollback;
