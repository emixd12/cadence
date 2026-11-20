-- Advisor plan Phase 4, workstream 4B: advisor tips ("quips"; "coach" is the internal name).
--
-- The hourly coach job writes one to three short tips a day per account, after storing
-- that morning's signals: one counted fact and one action each, from one advice card
-- (packages/core/src/data/advice-library.json). Opening the app never calls a model; it
-- shows the next stored tip.
--
--   coach_tips              the tips, kept (review decision D7: no 30-day purge). Account
--                           deletion removes them (auth.users cascade).
--   coach_tip_suppressions  cards the person asked never to see again.
--
-- Access:
--   coach_read_signals, coach_tip_history,
--   coach_write_tips                       coach agent token only (as the person).
--   coach_tips_due_accounts                service role only; returns ids and dates.
--   advisor_next_tip, advisor_react_tip    the signed-in person only (web session or the
--                                          Mac's bearer token), never an agent or grant.
-- No table is granted to any API role.
--
-- Owner approval needed before production (new tables).
begin;

create table cadence_advisor_private.coach_tips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  -- Order within the day, 1 to 3.
  position smallint not null check (position between 1 and 3),
  text text not null check (char_length(text) between 1 and 280 and text !~ '[\r\n]'),
  card_id text not null check (card_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  card_revision integer not null check (card_revision between 1 and 100000),
  -- Null for an account-wide tip. Deleting the Behavior keeps the tip (D7).
  behavior_id uuid,
  -- "<kind>:<behavior id or account>:<fact>", as the advice matcher builds them.
  fact_ids text[] not null check (cardinality(fact_ids) between 1 and 12),
  -- The values the tip stated, by fact id, so a later tip can tell a new fact from a repeat.
  fact_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fact_values) = 'object' and octet_length(fact_values::text) <= 4096),
  -- model: written by the model and checked by code. seed: the card's own wording filled by code.
  source text not null check (source in ('model', 'seed')),
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  reaction text check (reaction in ('helpful', 'not_now', 'dont_suggest')),
  reacted_at timestamptz,
  check ((reaction is null) = (reacted_at is null)),
  unique (user_id, local_date, position),
  constraint coach_tips_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete set null (behavior_id)
);
create index coach_tips_user_recent_idx on cadence_advisor_private.coach_tips (user_id, local_date desc);

create table cadence_advisor_private.coach_tip_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null check (card_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table cadence_advisor_private.coach_tips enable row level security;
alter table cadence_advisor_private.coach_tips force row level security;
alter table cadence_advisor_private.coach_tip_suppressions enable row level security;
alter table cadence_advisor_private.coach_tip_suppressions force row level security;
revoke all on table cadence_advisor_private.coach_tips from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.coach_tip_suppressions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Coach token: the day's stored signals, what was said lately, and which cards are off.

-- The caller's signals for one local date: [{id, kind, behavior_id, facts, signal_version}].
create function public.coach_read_signals(p_local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', signal.id, 'kind', signal.kind, 'behavior_id', signal.behavior_id,
      'facts', signal.facts, 'signal_version', signal.signal_version) order by signal.id)
    from cadence_advisor_private.coach_signals as signal
    where signal.user_id = v_user_id and signal.local_date = p_local_date
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.coach_read_signals(date) from public, anon, service_role;
grant execute on function public.coach_read_signals(date) to authenticated;

-- Tips from p_since on (shown or not) and every suppressed card id, as
-- {"tips": [...], "suppressed": [...]}. Facts and ids only, no text.
create function public.coach_tip_history(p_since date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_since is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'tips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'local_date', tip.local_date, 'position', tip.position, 'card_id', tip.card_id,
        'behavior_id', tip.behavior_id, 'fact_ids', to_jsonb(tip.fact_ids), 'fact_values', tip.fact_values,
        'source', tip.source, 'shown_at', tip.shown_at, 'reaction', tip.reaction
      ) order by tip.local_date, tip.position)
      from cadence_advisor_private.coach_tips as tip
      where tip.user_id = v_user_id and tip.local_date >= p_since
    ), '[]'::jsonb),
    'suppressed', coalesce((
      select jsonb_agg(s.card_id order by s.card_id)
      from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.coach_tip_history(date) from public, anon, service_role;
grant execute on function public.coach_tip_history(date) to authenticated;

-- Writes the day's tips for the run's local date. Tips not yet shown or answered are
-- replaced; shown ones stay, and new tips take the positions after them, up to 3 a day.
-- Suppressed cards and cards already used that day are skipped. Returns how many were
-- written. p_tips: [{text, card_id, card_revision, behavior_id, fact_ids, fact_values, source}].
create function public.coach_write_tips(p_run_id uuid, p_tips jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_item jsonb;
  v_position smallint;
  v_count integer := 0;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_tips is null or jsonb_typeof(p_tips) <> 'array' or jsonb_array_length(p_tips) > 3 then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;

  -- One writer per account and day at a time.
  perform pg_advisory_xact_lock(hashtextextended('coach_tips:' || v_user_id::text || ':' || v_run.local_date::text, 0));

  delete from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_run.local_date
    and tip.shown_at is null and tip.reaction is null;

  select coalesce(max(tip.position), 0) into v_position
  from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_run.local_date;

  for v_item in select value from jsonb_array_elements(p_tips) loop
    exit when v_position >= 3;
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'fact_ids') <> 'array'
        or jsonb_typeof(coalesce(v_item -> 'fact_values', '{}'::jsonb)) <> 'object' then
      raise exception 'agent_invalid_input' using errcode = '22023';
    end if;
    continue when exists (select 1 from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id and s.card_id = v_item ->> 'card_id');
    continue when exists (select 1 from cadence_advisor_private.coach_tips as tip
      where tip.user_id = v_user_id and tip.local_date = v_run.local_date and tip.card_id = v_item ->> 'card_id');
    v_position := v_position + 1;
    insert into cadence_advisor_private.coach_tips (
      user_id, local_date, position, text, card_id, card_revision, behavior_id, fact_ids, fact_values, source, run_id
    ) values (
      v_user_id, v_run.local_date, v_position, v_item ->> 'text', v_item ->> 'card_id',
      (v_item ->> 'card_revision')::integer, nullif(v_item ->> 'behavior_id', '')::uuid,
      array(select jsonb_array_elements_text(v_item -> 'fact_ids')),
      coalesce(v_item -> 'fact_values', '{}'::jsonb), v_item ->> 'source', v_run.id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.coach_write_tips(uuid, jsonb) from public, anon, service_role;
grant execute on function public.coach_write_tips(uuid, jsonb) to authenticated;

-- Service role only. Accounts whose morning signals are stored today (a successful
-- coach-signals visit) and that have no successful tip run today and fewer than three
-- tip tries, between 03:00 and 08:59 local time. In user id order after p_after.
create function public.coach_tips_due_accounts(p_after uuid, p_limit integer)
returns table (user_id uuid, local_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := statement_timestamp();
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'coach_invalid_limit' using errcode = '22023';
  end if;
  return query
  select profile.id, (v_now at time zone profile.timezone)::date
  from public.profiles as profile
  join pg_catalog.pg_timezone_names as zone on zone.name = profile.timezone
  where profile.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
    and extract(hour from (v_now at time zone profile.timezone)) between 3 and 8
    and exists (
      select 1 from cadence_advisor_private.agent_runs as run
      where run.user_id = profile.id and run.agent = 'coach' and run.trigger = 'scheduled'
        and run.local_date = (v_now at time zone profile.timezone)::date
        and run.outcome = 'success' and run.prompt_version like 'coach-signals-%'
    )
    and not exists (
      select 1 from cadence_advisor_private.agent_runs as run
      where run.user_id = profile.id and run.agent = 'coach' and run.trigger = 'scheduled'
        and run.local_date = (v_now at time zone profile.timezone)::date
        and run.outcome = 'success' and run.prompt_version like 'coach-tips-%'
    )
    and (
      select count(*) from cadence_advisor_private.agent_runs as run
      where run.user_id = profile.id and run.agent = 'coach' and run.trigger = 'scheduled'
        and run.local_date = (v_now at time zone profile.timezone)::date
        and run.prompt_version like 'coach-tips-%'
    ) < 3
  order by profile.id
  limit p_limit;
end;
$$;
revoke all on function public.coach_tips_due_accounts(uuid, integer) from public, anon, authenticated;
grant execute on function public.coach_tips_due_accounts(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The person: show the next tip, react to one.

create function cadence_advisor_private.require_person()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or cadence_oauth_private.current_agent_channel() is not null
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'Advisor tips are for the signed-in person.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;
revoke all on function cadence_advisor_private.require_person() from public, anon, authenticated, service_role;

create function cadence_advisor_private.tip_json(p_tip cadence_advisor_private.coach_tips)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_tip.id, 'local_date', p_tip.local_date, 'text', p_tip.text, 'card_id', p_tip.card_id,
    'card_revision', p_tip.card_revision, 'behavior_id', p_tip.behavior_id, 'shown_at', p_tip.shown_at,
    'reaction', p_tip.reaction
  );
$$;
revoke all on function cadence_advisor_private.tip_json(cadence_advisor_private.coach_tips) from public, anon, authenticated, service_role;

-- The next tip for the person's local today. Returns one of
--   {"state":"tip","tip":{...},"fresh":bool,"next_at":timestamptz|null}
--   {"state":"none","reason":"no_tips_today"|"all_shown"|"later","next_at":timestamptz|null}
-- Nothing holds tips back: they show while brief move lines or Needs decision items wait
-- (review decision D5). A new tip appears at most once per p_spacing_minutes; inside that time the tip already shown
-- comes back with fresh false, unless the person answered it (then "later").
create function public.advisor_next_tip(p_spacing_minutes integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_advisor_private.require_person();
  v_now timestamptz := statement_timestamp();
  v_today date;
  v_last cadence_advisor_private.coach_tips;
  v_next cadence_advisor_private.coach_tips;
  v_remaining integer;
  v_spacing interval;
begin
  if p_spacing_minutes is null or p_spacing_minutes < 0 or p_spacing_minutes > 1440 then
    raise exception 'tip_invalid_input' using errcode = '22023';
  end if;
  v_spacing := make_interval(mins => p_spacing_minutes);
  select (v_now at time zone profile.timezone)::date into v_today
  from public.profiles as profile where profile.id = v_user_id;
  if v_today is null then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  -- Serialize per account, so two opens at once show one new tip.
  perform pg_advisory_xact_lock(hashtextextended('coach_tips:' || v_user_id::text || ':' || v_today::text, 0));

  select * into v_last from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_today and tip.shown_at is not null
  order by tip.shown_at desc, tip.position desc limit 1;

  select count(*) into v_remaining from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_today and tip.shown_at is null and tip.reaction is null
    and not exists (select 1 from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id and s.card_id = tip.card_id);

  if v_last.id is not null and v_now - v_last.shown_at < v_spacing then
    if v_last.reaction in ('not_now', 'dont_suggest') then
      return jsonb_build_object('state', 'none', 'reason', case when v_remaining > 0 then 'later' else 'all_shown' end,
        'next_at', case when v_remaining > 0 then v_last.shown_at + v_spacing end);
    end if;
    return jsonb_build_object('state', 'tip', 'tip', cadence_advisor_private.tip_json(v_last), 'fresh', false,
      'next_at', case when v_remaining > 0 then v_last.shown_at + v_spacing end);
  end if;

  select * into v_next from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_today and tip.shown_at is null and tip.reaction is null
    and not exists (select 1 from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id and s.card_id = tip.card_id)
  order by tip.position limit 1;

  if v_next.id is not null then
    update cadence_advisor_private.coach_tips as tip set shown_at = v_now where tip.id = v_next.id
    returning * into v_next;
    return jsonb_build_object('state', 'tip', 'tip', cadence_advisor_private.tip_json(v_next), 'fresh', true,
      'next_at', case when v_remaining > 1 then v_now + v_spacing end);
  end if;

  if v_last.id is not null and v_last.reaction is null then
    return jsonb_build_object('state', 'tip', 'tip', cadence_advisor_private.tip_json(v_last), 'fresh', false, 'next_at', null);
  end if;
  return jsonb_build_object('state', 'none',
    'reason', case when exists (select 1 from cadence_advisor_private.coach_tips as tip
      where tip.user_id = v_user_id and tip.local_date = v_today) then 'all_shown' else 'no_tips_today' end,
    'next_at', null);
end;
$$;
revoke all on function public.advisor_next_tip(integer) from public, anon, service_role;
grant execute on function public.advisor_next_tip(integer) to authenticated;

-- The person's reaction to one of their tips. "dont_suggest" also turns the card off for
-- the account, on every device. A later reaction replaces an earlier one.
create function public.advisor_react_tip(p_tip_id uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_advisor_private.require_person();
  v_tip cadence_advisor_private.coach_tips;
begin
  if p_tip_id is null or p_reaction is null or p_reaction not in ('helpful', 'not_now', 'dont_suggest') then
    raise exception 'tip_invalid_input' using errcode = '22023';
  end if;
  update cadence_advisor_private.coach_tips as tip
  set reaction = p_reaction, reacted_at = statement_timestamp(), shown_at = coalesce(tip.shown_at, statement_timestamp())
  where tip.id = p_tip_id and tip.user_id = v_user_id
  returning * into v_tip;
  if v_tip.id is null then
    raise exception 'tip_not_found' using errcode = 'P0002';
  end if;
  if p_reaction = 'dont_suggest' then
    insert into cadence_advisor_private.coach_tip_suppressions (user_id, card_id)
    values (v_user_id, v_tip.card_id) on conflict do nothing;
  end if;
  return cadence_advisor_private.tip_json(v_tip);
end;
$$;
revoke all on function public.advisor_react_tip(uuid, text) from public, anon, service_role;
grant execute on function public.advisor_react_tip(uuid, text) to authenticated;

commit;
