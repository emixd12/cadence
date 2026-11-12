begin;

-- Ticket 298: a device can release a failed model attempt without downgrading a
-- completed attempt. finish_daily_brief(false) retains its existing, separate
-- purpose: undo this request's own completion when its final context fence fails.
create function cadence_advisor_private.release_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
begin
  if p_installation_id is null or p_lease_token is null
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'Daily Brief release is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );

  update cadence_advisor_private.daily_brief_runs as run
  set status = 'failed',
    lease_expires_at = null,
    finished_at = pg_catalog.clock_timestamp()
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
    and run.lease_token = p_lease_token
    and run.preference_revision = p_expected_revision
    and run.status = 'pending';

  -- Do not reset admissions or the account rate limit. A deliberate retry still
  -- passes through begin_daily_brief, including when this lease already expired.
  return found;
end;
$$;

create function public.release_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.release_daily_brief(
    p_installation_id, p_lease_token, p_expected_revision
  );
$$;

revoke all on function cadence_advisor_private.release_daily_brief(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.release_daily_brief(uuid, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.release_daily_brief(uuid, uuid, bigint) to authenticated;
grant execute on function public.release_daily_brief(uuid, uuid, bigint) to authenticated;

comment on function public.release_daily_brief(uuid, uuid, bigint) is
  'Release only the authenticated user''s matching pending Daily Brief lease, preserving completed attempts and retry quotas.';

commit;
