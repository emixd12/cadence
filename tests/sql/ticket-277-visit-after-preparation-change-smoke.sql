-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-277-visit-after-preparation-change-smoke.sql
-- Decision D19, Tickets 275 and 277: a get-ready change brings the account's next
-- leave reminder job visit forward to now. Only a real change to
-- preparation_minutes counts, only an account with reminders on and a later visit
-- moves, another account never moves, and users cannot call the trigger function. Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('27700000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'visit-smoke@example.invalid', '{}', '{}'),
  ('27700000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'visit-other@example.invalid', '{}', '{}'),
  ('27700000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'visit-off@example.invalid', '{}', '{}');

do $$
begin
  if has_function_privilege('authenticated', 'cadence_private.bring_leave_reminder_visit_forward()', 'execute')
    or has_function_privilege('anon', 'cadence_private.bring_leave_reminder_visit_forward()', 'execute') then
    raise exception 'A user role can call the visit trigger function.';
  end if;
end;
$$;

-- Account A and account B turn reminders on; account C keeps them off. Each
-- account's job visit is then 30 minutes away, as after an ordinary visit.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"27700000-0000-4000-8000-000000000012","role":"authenticated"}', true);
insert into public.travel_leave_reminder_settings (user_id, enabled) values ('27700000-0000-4000-8000-000000000012', true);
update public.travel_leave_reminder_settings set next_check_at = now() + interval '30 minutes';

select set_config('request.jwt.claims', '{"sub":"27700000-0000-4000-8000-000000000013","role":"authenticated"}', true);
insert into public.travel_leave_reminder_settings (user_id, enabled) values ('27700000-0000-4000-8000-000000000013', false);

select set_config('request.jwt.claims', '{"sub":"27700000-0000-4000-8000-000000000011","role":"authenticated"}', true);
insert into public.travel_leave_reminder_settings (user_id, enabled) values ('27700000-0000-4000-8000-000000000011', true);
update public.travel_leave_reminder_settings set next_check_at = now() + interval '30 minutes';

-- Other habit or settings writes, and a write that keeps the get-ready time, keep the visit.
update public.travel_settings set arrival_buffer_minutes = 5, habits_updated_at = '2026-11-06T17:00:00.000000Z';
update public.travel_settings set preparation_minutes = null;
do $$
begin
  if (select next_check_at from public.travel_leave_reminder_settings) <> now() + interval '30 minutes' then
    raise exception 'A write that kept the get-ready time moved the job visit.';
  end if;
end;
$$;

-- A get-ready change moves the visit to now (the database time of the change).
update public.travel_settings set preparation_minutes = 45;
do $$
declare
  moved timestamptz := (select next_check_at from public.travel_leave_reminder_settings);
begin
  if moved is null or moved < now() or moved > clock_timestamp() then
    raise exception 'A get-ready change did not bring the job visit forward to now: %', moved;
  end if;
end;
$$;
reset role;

-- Account B's visit never moves, and account C, with reminders off, gets no visit.
do $$
begin
  if (select next_check_at from public.travel_leave_reminder_settings
      where user_id = '27700000-0000-4000-8000-000000000012') <> now() + interval '30 minutes' then
    raise exception 'A get-ready change moved another account''s job visit.';
  end if;
end;
$$;
update public.travel_settings set preparation_minutes = 20, habits_updated_at = '2026-11-06T17:00:00.000000Z'
where user_id = '27700000-0000-4000-8000-000000000013';
do $$
begin
  if (select next_check_at from public.travel_leave_reminder_settings
      where user_id = '27700000-0000-4000-8000-000000000013') is not null then
    raise exception 'A get-ready change gave an account with reminders off a job visit.';
  end if;
end;
$$;

-- A visit already due stays where it is.
update public.travel_leave_reminder_settings set next_check_at = now() - interval '1 hour'
where user_id = '27700000-0000-4000-8000-000000000011';
update public.travel_settings set preparation_minutes = 50 where user_id = '27700000-0000-4000-8000-000000000011';
do $$
begin
  if (select next_check_at from public.travel_leave_reminder_settings
      where user_id = '27700000-0000-4000-8000-000000000011') <> now() - interval '1 hour' then
    raise exception 'A get-ready change moved a job visit that was already due.';
  end if;
end;
$$;

select 'ticket-277 visit after get-ready change smoke passed' as result;

rollback;
