\set ON_ERROR_STOP on

-- Local synthetic fixture only. All users, sessions and writes roll back.
begin;
set local statement_timeout = '5s';

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('92700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'daily-brief-conflicts@example.invalid', '{}', '{}');
insert into auth.sessions (id, user_id)
values ('92700000-0000-4000-8000-000000000011', '92700000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"92700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92700000-0000-4000-8000-000000000011"}', true);

do $$
begin
  begin
    perform public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 0);
    raise exception 'Missing preferences were admitted.';
  exception when sqlstate '55000' then null;
  end;

  perform public.save_daily_brief_preferences(true, false, 0);
  begin
    perform public.save_daily_brief_preferences(true, false, 0);
    raise exception 'Stale preference save was admitted.';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 0);
    raise exception 'Stale acquisition revision was admitted.';
  exception when sqlstate '55000' then null;
  end;

  perform public.save_daily_brief_preferences(false, false, 1);
  begin
    perform public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 2);
    raise exception 'Disabled preferences were admitted.';
  exception when sqlstate '55000' then null;
  end;
end;
$$;

reset role;
insert into public.google_calendar_connections (user_id, google_subject, generation, status)
values ('92700000-0000-4000-8000-000000000001', 'daily-brief-conflicts', 1, 'connected');
insert into public.google_calendar_preferences (user_id)
values ('92700000-0000-4000-8000-000000000001');

set local role authenticated;
select public.save_daily_brief_preferences(true, true, 2);
reset role;
update public.google_calendar_preferences
set selection_revision = selection_revision + 1
where user_id = '92700000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  begin
    perform public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 3);
    raise exception 'Changed Calendar selection was admitted.';
  exception when sqlstate '55000' then null;
  end;
  perform public.save_daily_brief_preferences(true, true, 3);
end;
$$;
reset role;
update public.google_calendar_connections
set generation = generation + 1
where user_id = '92700000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  begin
    perform public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 4);
    raise exception 'Changed Calendar connection was admitted.';
  exception when sqlstate '55000' then null;
  end;
end;
$$;
reset role;

do $$
begin
  if exists (select 1 from cadence_advisor_private.daily_brief_runs
    where user_id = '92700000-0000-4000-8000-000000000001')
    or exists (select 1 from cadence_advisor_private.daily_brief_rate_limits
    where user_id = '92700000-0000-4000-8000-000000000001') then
    raise exception 'Rejected requests consumed admission metadata.';
  end if;
  if (select revision from cadence_advisor_private.daily_brief_preferences
    where user_id = '92700000-0000-4000-8000-000000000001') <> 4 then
    raise exception 'Rejected preference save changed the revision.';
  end if;
end;
$$;

set local role authenticated;
do $$
declare decision jsonb;
begin
  -- Deliberately renew consent; the error-code change never does this itself.
  perform public.save_daily_brief_preferences(true, true, 4);
  decision := public.begin_daily_brief('92700000-0000-4000-8000-000000000101', false, 5);
  if decision ->> 'state' <> 'acquired' then
    raise exception 'Fresh disclosure did not acquire: %', decision;
  end if;
  decision := public.begin_daily_brief('92700000-0000-4000-8000-000000000102', false, 5);
  if decision ->> 'state' <> 'pending' then
    raise exception 'Account-wide admission lock changed: %', decision;
  end if;
end;
$$;

rollback;
