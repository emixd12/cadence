-- Ticket 308: "Use my current location" for Home makes one paid Google reverse-geocoding
-- request. It reuses the account-scoped launch rate limit with its own action and window.
-- Additive: the action list widens and the existing actions keep six per 60 seconds.
-- The counter stores no position, address or request body.

begin;

alter table public.launch_rate_limits
  drop constraint launch_rate_limits_action_check;

alter table public.launch_rate_limits
  add constraint launch_rate_limits_action_check
  check (action in ('export_download', 'push_subscription_registration', 'travel_home_lookup'));

create or replace function public.consume_launch_rate_limit(p_action text)
returns table (
  allowed boolean,
  limit_count integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  observed_at timestamptz := statement_timestamp();
  window_seconds integer := 60;
  rate_limit_record public.launch_rate_limits%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required to consume a launch rate limit.'
      using errcode = '42501';
  end if;

  if p_action not in ('export_download', 'push_subscription_registration', 'travel_home_lookup') then
    raise exception 'Unsupported launch rate limit action.'
      using errcode = '22023';
  end if;

  limit_count := 6;
  -- Ticket 308: five Home lookups per account in one hour.
  if p_action = 'travel_home_lookup' then
    limit_count := 5;
    window_seconds := 3600;
  end if;

  insert into public.launch_rate_limits as launch_rate_limit (
    user_id,
    action,
    window_started_at,
    attempt_count,
    updated_at
  )
  values (
    actor_id,
    p_action,
    observed_at,
    1,
    observed_at
  )
  on conflict (user_id, action) do update
  set
    window_started_at = case
      when launch_rate_limit.window_started_at
        + make_interval(secs => window_seconds) <= observed_at
        then observed_at
      else launch_rate_limit.window_started_at
    end,
    attempt_count = case
      when launch_rate_limit.window_started_at
        + make_interval(secs => window_seconds) <= observed_at
        then 1
      else launch_rate_limit.attempt_count + 1
    end,
    updated_at = observed_at
  returning launch_rate_limit.* into rate_limit_record;

  return query
  select
    rate_limit_record.attempt_count <= limit_count,
    limit_count,
    greatest(0, limit_count - rate_limit_record.attempt_count),
    rate_limit_record.window_started_at
      + make_interval(secs => window_seconds),
    greatest(
      1,
      ceil(
        extract(
          epoch from (
            rate_limit_record.window_started_at
              + make_interval(secs => window_seconds)
              - observed_at
          )
        )
      )::integer
    );
end;
$$;

revoke all on function public.consume_launch_rate_limit(text) from public;
revoke all on function public.consume_launch_rate_limit(text) from anon;
revoke all on function public.consume_launch_rate_limit(text) from service_role;
grant execute on function public.consume_launch_rate_limit(text) to authenticated;

commit;
