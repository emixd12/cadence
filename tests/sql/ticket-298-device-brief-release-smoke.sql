\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('29800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-298-one@example.invalid', '{}', '{}'),
  ('29800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-298-two@example.invalid', '{}', '{}');
insert into auth.sessions (id, user_id)
values
  ('29800000-0000-4000-8000-000000000011', '29800000-0000-4000-8000-000000000001'),
  ('29800000-0000-4000-8000-000000000012', '29800000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29800000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29800000-0000-4000-8000-000000000011"}', true);

do $$
declare
  installation uuid := '29800000-0000-4000-8000-000000000101';
  decision jsonb;
  old_lease uuid;
  lease uuid;
begin
  perform public.save_daily_brief_preferences(true, false, 0);
  decision := public.begin_daily_brief(installation, false, 1);
  if (decision ->> 'state') is distinct from 'acquired' then raise exception 'Release fixture admission failed.'; end if;
  lease := (decision ->> 'lease_token')::uuid;
  old_lease := lease;

  -- Ownership is derived from the current session, never a caller-provided user ID.
  perform set_config('request.jwt.claims',
    '{"sub":"29800000-0000-4000-8000-000000000002","role":"authenticated","session_id":"29800000-0000-4000-8000-000000000012"}', true);
  if public.release_daily_brief(installation, lease, 1) then raise exception 'Cross-account release succeeded.'; end if;
  perform set_config('request.jwt.claims',
    '{"sub":"29800000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29800000-0000-4000-8000-000000000011"}', true);

  if public.release_daily_brief('29800000-0000-4000-8000-000000000102', lease, 1)
    or public.release_daily_brief(installation, '29800000-0000-4000-8000-000000000999', 1)
    or public.release_daily_brief(installation, lease, 2)
  then raise exception 'Release ignored the installation, lease or preference revision.'; end if;

  begin
    perform public.release_daily_brief(installation, lease, null);
    raise exception 'Release accepted an invalid revision.';
  exception when invalid_parameter_value then null;
  end;

  decision := public.begin_daily_brief(installation, true, 1);
  if (decision ->> 'state') is distinct from 'pending' then raise exception 'Rejected releases changed the pending lease.'; end if;
  if not public.release_daily_brief(installation, lease, 1) then raise exception 'Pending release failed.'; end if;
  if public.release_daily_brief(installation, lease, 1) then raise exception 'Release changed an already failed attempt.'; end if;
  decision := public.begin_daily_brief(installation, false, 1);
  if (decision ->> 'state') is distinct from 'already_attempted' then raise exception 'Release allowed an automatic retry.'; end if;

  -- Deliberate retry works immediately, but the old envelope cannot release it.
  decision := public.begin_daily_brief(installation, true, 1);
  if (decision ->> 'state') is distinct from 'acquired' then raise exception 'Release did not free the lease immediately.'; end if;
  lease := (decision ->> 'lease_token')::uuid;
  if public.release_daily_brief(installation, old_lease, 1) then raise exception 'Superseded release changed a new attempt.'; end if;
  if not public.finish_daily_brief(installation, lease, true, 1) then raise exception 'Completion after rejected stale release failed.'; end if;
  if public.release_daily_brief(installation, lease, 1) then raise exception 'Release downgraded a completed attempt.'; end if;
  if not public.record_daily_brief_tip(installation, lease, 1, repeat('a', 64)) then
    raise exception 'Completed attempt did not survive a replayed release.';
  end if;

  -- Release preserves the normal daily admission count: the fifth start is refused.
  for attempt in 3..4 loop
    decision := public.begin_daily_brief(installation, true, 1);
    if (decision ->> 'state') is distinct from 'acquired' then raise exception 'A permitted deliberate retry failed.'; end if;
    if not public.release_daily_brief(installation, (decision ->> 'lease_token')::uuid, 1) then
      raise exception 'Retry release failed.';
    end if;
  end loop;
  decision := public.begin_daily_brief(installation, true, 1);
  if (decision ->> 'state') is distinct from 'retry_exhausted' then raise exception 'Release reset the daily admission count.'; end if;
end;
$$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.release_daily_brief(uuid,uuid,bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.release_daily_brief(uuid,uuid,bigint)', 'EXECUTE')
    or has_function_privilege('anon', 'cadence_advisor_private.release_daily_brief(uuid,uuid,bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.release_daily_brief(uuid,uuid,bigint)', 'EXECUTE')
  then raise exception 'Release grants escaped the authenticated role.'; end if;
  if (select cardinality(generation_starts) from cadence_advisor_private.daily_brief_rate_limits
      where user_id = '29800000-0000-4000-8000-000000000001') is distinct from 4 then
    raise exception 'Release changed the account rate limit.';
  end if;
end;
$$;

delete from auth.sessions where id = '29800000-0000-4000-8000-000000000011';
set local role authenticated;
do $$
begin
  begin
    perform public.release_daily_brief('29800000-0000-4000-8000-000000000101', '29800000-0000-4000-8000-000000000999', 1);
    raise exception 'Release accepted a revoked session.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
