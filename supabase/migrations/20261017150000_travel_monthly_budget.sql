begin;

-- Ticket 213: a renewable per-owner monthly travel budget replaces the
-- nonrenewing 40-refresh pilot allowance. Each provider call reserves its list
-- price before it runs. consume_travel_route_quota() and its counters remain
-- as history; the application no longer calls them.

create table public.travel_spend_owner_month (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_month date not null check (extract(day from local_month) = 1),
  reserved_microdollars bigint not null default 0 check (reserved_microdollars >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_month)
);

create table public.travel_spend_global_day (
  utc_date date primary key,
  reserved_microdollars bigint not null default 0 check (reserved_microdollars >= 0),
  updated_at timestamptz not null default now()
);

alter table public.travel_spend_owner_month enable row level security;
alter table public.travel_spend_global_day enable row level security;

create policy "Users can read their own travel spend"
on public.travel_spend_owner_month
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.travel_spend_owner_month from public, anon, authenticated;
grant select on table public.travel_spend_owner_month to authenticated;
revoke all on table public.travel_spend_global_day from public, anon, authenticated;

create or replace function public.reserve_travel_provider_spend(requested_microdollars integer)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  observed_at timestamptz := statement_timestamp();
  actor_timezone text;
  owner_month date;
  owner_resets_at timestamptz;
  utc_day date := (statement_timestamp() at time zone 'UTC')::date;
  global_resets_at timestamptz;
  owner_reserved bigint;
  global_reserved bigint;
  -- Owner decision, October 17, 2026: absolute ceiling of US$5.00 per owner local month.
  owner_month_ceiling constant bigint := 5000000;
  -- Defect circuit breaker across all owners: US$10.00 per UTC day. Record changes in docs/COSTS.md.
  global_day_ceiling constant bigint := 10000000;
  -- Largest single batch: 19 place lookups, or 8 legs at the Pro rate plus retries.
  request_ceiling constant integer := 200000;
begin
  if actor_id is null then
    raise exception 'Authentication is required to reserve travel spend.'
      using errcode = '42501';
  end if;
  if requested_microdollars is null or requested_microdollars < 1 or requested_microdollars > request_ceiling then
    raise exception 'Travel spend request is out of range.'
      using errcode = '22023';
  end if;

  select timezone into actor_timezone from public.profiles where id = actor_id;
  if actor_timezone is null then
    raise exception 'Profile timezone is required to reserve travel spend.'
      using errcode = '22023';
  end if;
  owner_month := date_trunc('month', observed_at at time zone actor_timezone)::date;
  owner_resets_at := (owner_month + interval '1 month') at time zone actor_timezone;
  global_resets_at := (utc_day + 1)::timestamp at time zone 'UTC';

  -- Lock order is always the owner row, then the global row.
  insert into public.travel_spend_owner_month (user_id, local_month, updated_at)
  values (actor_id, owner_month, observed_at)
  on conflict (user_id, local_month) do nothing;
  select spend.reserved_microdollars into owner_reserved
  from public.travel_spend_owner_month as spend
  where spend.user_id = actor_id and spend.local_month = owner_month
  for update;

  insert into public.travel_spend_global_day (utc_date, updated_at)
  values (utc_day, observed_at)
  on conflict (utc_date) do nothing;
  select spend.reserved_microdollars into global_reserved
  from public.travel_spend_global_day as spend
  where spend.utc_date = utc_day
  for update;

  -- Refused requests reserve nothing.
  if owner_reserved + requested_microdollars > owner_month_ceiling then
    return query select false, greatest(1, ceil(extract(epoch from (owner_resets_at - observed_at))))::integer, owner_resets_at;
    return;
  end if;
  if global_reserved + requested_microdollars > global_day_ceiling then
    return query select false, greatest(1, ceil(extract(epoch from (global_resets_at - observed_at))))::integer, global_resets_at;
    return;
  end if;

  update public.travel_spend_owner_month as spend
  set reserved_microdollars = spend.reserved_microdollars + requested_microdollars, updated_at = observed_at
  where spend.user_id = actor_id and spend.local_month = owner_month;
  update public.travel_spend_global_day as spend
  set reserved_microdollars = spend.reserved_microdollars + requested_microdollars, updated_at = observed_at
  where spend.utc_date = utc_day;

  return query select true, 0, null::timestamptz;
end;
$$;

revoke all on function public.reserve_travel_provider_spend(integer) from public;
revoke all on function public.reserve_travel_provider_spend(integer) from anon;
revoke all on function public.reserve_travel_provider_spend(integer) from service_role;
grant execute on function public.reserve_travel_provider_spend(integer) to authenticated;

comment on function public.reserve_travel_provider_spend(integer) is
  'Atomically reserves list-price microdollars before travel provider calls. Owner ceiling US$5.00 per local month; global circuit breaker US$10.00 per UTC day. Refused requests reserve nothing. Reservations are never refunded.';

comment on function public.consume_travel_route_quota() is
  'Superseded by reserve_travel_provider_spend (Ticket 213). Retained with its counters as history of the September 22-25, 2026 pilot.';

commit;
