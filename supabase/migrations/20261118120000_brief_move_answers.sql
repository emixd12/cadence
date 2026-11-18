-- Advisor plan, Phase 3A1: the Daily Brief applies moves.
--
-- The brief offers one move per affected item as a line; the person answers Yes, No,
-- Other time, Already did it, Undo, Accept all, Undo all or "Don't suggest moving
-- this". Phase 2A's move functions apply every move; this migration adds what the
-- answers need around them. Rules: docs/DATETIME_STRATEGY.md, "Brief moves".
--
-- 1. move_proposals: status 'undone' (Undo after Yes counts as a No for the day), and
--    `line`, what the shown line needs to be rebuilt with no model call.
-- 2. occurrence_moves: duration sources 'model_estimate' and 'fallback', so a Yes
--    applies the length the line showed.
-- 3. move_proposal_answers: one append-only row per answer, with its kind and time, so
--    later advice (the coach, Phase 3D) can learn from it. Server only, never synced.
-- 4. behavior_move_preferences: "Don't suggest moving this", per Behavior. Server only,
--    so account sync and the Mac schema do not change.
-- 5. behavior_advisor_estimates: the cached model length estimate and "alongside"
--    answer per Behavior, re-asked only when the inputs that affect them change.
-- 6. Functions: record_brief_move_proposals (Daily Brief agent only),
--    answer_move_proposal (the person or the Daily Brief agent),
--    set_behavior_move_preference and set_behavior_default_length (the person),
--    upsert_behavior_advisor_estimates (Daily Brief agent only).
begin;

-- 1. move_proposals --------------------------------------------------------------------
alter table public.move_proposals drop constraint move_proposals_status_check;
alter table public.move_proposals add constraint move_proposals_status_check check (status in (
  'proposed', 'accepted', 'declined', 'already_done', 'other_time', 'superseded', 'withdrawn', 'undone'
));
-- The shown line: reason sentence and code, anchor, length and its source, other
-- times, travel state. Built by Cadence; the reason sentence is validated model text.
alter table public.move_proposals
  add column line jsonb not null default '{}'::jsonb
    check (jsonb_typeof(line) = 'object' and octet_length(line::text) <= 16384);
create index move_proposals_user_status_date_idx on public.move_proposals (user_id, local_date, status);
create index move_proposals_user_behavior_idx on public.move_proposals (user_id, behavior_id, status, local_date);

-- 2. Duration sources ------------------------------------------------------------------
alter table public.occurrence_moves drop constraint occurrence_moves_duration_source_check;
alter table public.occurrence_moves add constraint occurrence_moves_duration_source_check check (duration_source in (
  'behavior_duration', 'logged_average', 'planned_length', 'kept_length', 'explicit', 'restored', 'model_estimate', 'fallback'
));

do $migration$
declare
  definition text;
  anchor text := $a$p_duration_source not in ('behavior_duration', 'logged_average', 'planned_length', 'kept_length', 'explicit')$a$;
begin
  select pg_get_functiondef('cadence_private.apply_occurrence_move(text, uuid, timestamptz, timestamptz, timestamptz, integer, text, text, uuid, uuid, text, text)'::regprocedure)
    into definition;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'apply_occurrence_move changed unexpectedly (duration sources).';
  end if;
  execute replace(definition, anchor,
    $r$p_duration_source not in ('behavior_duration', 'logged_average', 'planned_length', 'kept_length', 'explicit', 'model_estimate', 'fallback')$r$);
end
$migration$;

-- 3. move_proposal_answers -------------------------------------------------------------
create table public.move_proposal_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  local_date date not null,
  kind text not null check (kind in ('yes', 'no', 'other_time', 'already_done', 'undo', 'accept_all', 'undo_all', 'never_move')),
  -- applied: the answer took effect. refused: a tap-time check refused it (the reason says why).
  outcome text not null check (outcome in ('applied', 'refused')),
  refusal_reason text check (refusal_reason is null or refusal_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- The move written (Yes, Other time, Accept all) or reverted (Undo, Undo all).
  move_id uuid,
  -- Groups the lines of one Accept all, and the Undo all that reverses it.
  batch_id uuid,
  -- Who wrote it: the person's own session or the Daily Brief agent on their behalf.
  source text not null check (source in ('person', 'daily_brief')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  constraint move_proposal_answers_refusal_check check ((outcome = 'refused') = (refusal_reason is not null)),
  constraint move_proposal_answers_proposal_owner_fkey
    foreign key (user_id, proposal_id) references public.move_proposals(user_id, id) on delete cascade,
  constraint move_proposal_answers_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);

create unique index move_proposal_answers_idempotency_key
  on public.move_proposal_answers (user_id, idempotency_key, proposal_id);
create index move_proposal_answers_user_date_idx on public.move_proposal_answers (user_id, local_date);
create index move_proposal_answers_user_behavior_idx on public.move_proposal_answers (user_id, behavior_id, created_at);
create index move_proposal_answers_batch_idx on public.move_proposal_answers (user_id, batch_id) where batch_id is not null;

alter table public.move_proposal_answers enable row level security;
create policy move_proposal_answers_select_own on public.move_proposal_answers
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.move_proposal_answers from anon, authenticated;
grant select on table public.move_proposal_answers to authenticated;

-- 4. behavior_move_preferences ---------------------------------------------------------
create table public.behavior_move_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  never_suggest_move boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, behavior_id),
  constraint behavior_move_preferences_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);

alter table public.behavior_move_preferences enable row level security;
create policy behavior_move_preferences_select_own on public.behavior_move_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.behavior_move_preferences from anon, authenticated;
grant select on table public.behavior_move_preferences to authenticated;

-- 5. behavior_advisor_estimates --------------------------------------------------------
-- One row per Behavior. input_hash covers the title, description and every other input
-- the estimate call reads; a different hash means the model is asked again.
create table public.behavior_advisor_estimates (
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  -- Null when the model could not estimate; the 30-minute fallback then applies.
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  alongside boolean not null default false,
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, behavior_id),
  constraint behavior_advisor_estimates_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);

alter table public.behavior_advisor_estimates enable row level security;
create policy behavior_advisor_estimates_select_own on public.behavior_advisor_estimates
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.behavior_advisor_estimates from anon, authenticated;
grant select on table public.behavior_advisor_estimates to authenticated;

-- 6. Functions -------------------------------------------------------------------------

-- The Daily Brief agent, or refuse. MCP grants and other agents never write proposals.
create function cadence_private.require_daily_brief_agent()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'agent_auth_required' using errcode = '42501';
  end if;
  if cadence_oauth_private.current_agent_channel() is distinct from 'daily_brief'
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

revoke all on function cadence_private.require_daily_brief_agent() from public, anon, authenticated, service_role;

-- Writes the brief's lines as proposals, linked to the run. p_proposals:
-- [{"occurrence_id", "proposed_start_at", "proposed_end_at", "reason", "expected_revision",
--   "option_refs", "line", "replaces_proposal_id"}]. With p_supersede (a Refresh), the
-- earlier undecided brief lines of that day are closed as superseded first. Items
-- declined, undone or never-move are skipped: No means no more suggestions today.
-- Returns the stored rows.
create function public.record_brief_move_proposals(
  p_agent_run_id uuid,
  p_local_date date,
  p_proposals jsonb,
  p_supersede boolean default false
) returns setof public.move_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_item jsonb;
  v_occurrence public.occurrences;
  v_behavior public.behaviors;
  v_ids uuid[] := array[]::uuid[];
  v_row public.move_proposals;
begin
  if p_local_date is null or jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) > 32 then
    raise exception 'move_proposal_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_local_date::text, 303));

  if p_supersede then
    update public.move_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.local_date = p_local_date and p.source = 'daily_brief' and p.status = 'proposed';
  end if;

  for v_item in select value from jsonb_array_elements(p_proposals) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'line') is distinct from 'object'
      or (v_item ->> 'proposed_end_at')::timestamptz < (v_item ->> 'proposed_start_at')::timestamptz then
      raise exception 'move_proposal_invalid_input' using errcode = '22023';
    end if;
    select * into v_occurrence from public.occurrences o
      where o.user_id = v_user_id and o.id = (v_item ->> 'occurrence_id')::uuid;
    if v_occurrence.id is null or v_occurrence.local_date <> p_local_date
      or v_occurrence.status <> 'unresolved' or v_occurrence.schedule_kind <> 'exact' then
      continue;
    end if;
    select * into v_behavior from public.behaviors b where b.user_id = v_user_id and b.id = v_occurrence.behavior_id;
    if (now() at time zone v_behavior.timezone)::date <> p_local_date then
      continue;
    end if;
    -- No, Undo and "Don't suggest moving this" hold for the rest of the day.
    if exists (select 1 from public.move_proposals p
        where p.user_id = v_user_id and p.occurrence_id = v_occurrence.id and p.local_date = p_local_date
          and p.status in ('declined', 'undone'))
      or exists (select 1 from public.behavior_move_preferences pref
        where pref.user_id = v_user_id and pref.behavior_id = v_occurrence.behavior_id and pref.never_suggest_move) then
      continue;
    end if;
    -- One undecided line per item: a new line for the same item replaces the old one.
    update public.move_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.occurrence_id = v_occurrence.id and p.status = 'proposed';

    insert into public.move_proposals (
      user_id, occurrence_id, behavior_id, local_date, source, agent_run_id, status,
      proposed_start_at, proposed_end_at, reason, expected_revision, option_refs, line, replaces_proposal_id
    ) values (
      v_user_id, v_occurrence.id, v_occurrence.behavior_id, p_local_date, 'daily_brief', p_agent_run_id, 'proposed',
      (v_item ->> 'proposed_start_at')::timestamptz, (v_item ->> 'proposed_end_at')::timestamptz,
      nullif(v_item ->> 'reason', ''), coalesce((v_item ->> 'expected_revision')::timestamptz, v_occurrence.updated_at),
      coalesce(v_item -> 'option_refs', '{}'::jsonb), v_item -> 'line',
      (select p.id from public.move_proposals p
        where p.user_id = v_user_id and p.id = nullif(v_item ->> 'replaces_proposal_id', '')::uuid)
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
  end loop;

  return query select * from public.move_proposals p where p.user_id = v_user_id and p.id = any(v_ids) order by p.proposed_start_at, p.id;
end $$;

revoke all on function public.record_brief_move_proposals(uuid, date, jsonb, boolean) from public, anon, service_role;
grant execute on function public.record_brief_move_proposals(uuid, date, jsonb, boolean) to authenticated;

-- Records one answer to one line, and moves the proposal's status when the answer took
-- effect. The move itself is applied before (Yes, Other time, Accept all: through
-- move_occurrence_for_day; Undo, Undo all: through revert_occurrence_move); "Already did
-- it" is recorded here first and the person marks the item Completed after, so the
-- status-change trigger finds no open proposal to withdraw.
--
-- The same key and proposal returns the stored answer and changes nothing.
-- Status moves:  no, never_move: proposed -> declined
--                other_time: proposed -> other_time (move_id set)
--                yes, accept_all: accepted by the move function; move_id ensured here
--                already_done: proposed -> already_done
--                undo, undo_all: accepted or other_time -> undone
-- A refused answer is recorded and changes no status.
create function public.answer_move_proposal(
  p_proposal_id uuid,
  p_kind text,
  p_outcome text,
  p_idempotency_key text,
  p_move_id uuid default null,
  p_refusal_reason text default null,
  p_batch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_agent text := cadence_oauth_private.current_agent_channel();
  v_source text;
  v_proposal public.move_proposals;
  v_existing public.move_proposal_answers;
  v_answer public.move_proposal_answers;
  v_next text;
begin
  if v_user_id is null then
    raise exception 'Move answers require an authenticated user.' using errcode = '42501';
  end if;
  if auth.jwt() ->> 'cadence_grant_id' is not null or (v_agent is not null and v_agent <> 'daily_brief') then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  v_source := case when v_agent = 'daily_brief' then 'daily_brief' else 'person' end;
  if p_proposal_id is null or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 255
    or p_kind not in ('yes', 'no', 'other_time', 'already_done', 'undo', 'accept_all', 'undo_all', 'never_move')
    or p_outcome not in ('applied', 'refused')
    or (p_outcome = 'refused') <> (p_refusal_reason is not null)
    or (p_refusal_reason is not null and p_refusal_reason !~ '^[a-z][a-z0-9_]{0,63}$') then
    raise exception 'move_answer_invalid_input' using errcode = '22023';
  end if;

  select * into v_proposal from public.move_proposals p
    where p.user_id = v_user_id and p.id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'move_proposal_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.move_proposal_answers a
    where a.user_id = v_user_id and a.idempotency_key = p_idempotency_key and a.proposal_id = p_proposal_id;
  if v_existing.id is not null then
    if v_existing.kind <> p_kind then
      raise exception 'move_answer_idempotency_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true, 'answer', to_jsonb(v_existing) - 'user_id',
      'proposal', to_jsonb(v_proposal) - 'user_id');
  end if;

  if p_outcome = 'applied' then
    v_next := case
      when p_kind in ('no', 'never_move') and v_proposal.status = 'proposed' then 'declined'
      when p_kind = 'other_time' and v_proposal.status in ('proposed', 'superseded') then 'other_time'
      when p_kind in ('yes', 'accept_all') and v_proposal.status in ('proposed', 'superseded', 'accepted') then 'accepted'
      when p_kind = 'already_done' and v_proposal.status = 'proposed' then 'already_done'
      when p_kind in ('undo', 'undo_all') and v_proposal.status in ('accepted', 'other_time') then 'undone'
    end;
    -- "Don't suggest moving this" on a line already answered keeps that answer.
    if v_next is null and p_kind = 'never_move' then
      v_next := v_proposal.status;
    end if;
    if v_next is null then
      raise exception 'move_proposal_closed' using errcode = '22023';
    end if;
    update public.move_proposals p
    set status = v_next,
        move_id = case when p_kind in ('yes', 'accept_all', 'other_time') then coalesce(p_move_id, p.move_id) else p.move_id end,
        status_changed_at = case when v_next <> p.status then now() else p.status_changed_at end
    where p.user_id = v_user_id and p.id = v_proposal.id
    returning * into v_proposal;
  end if;

  insert into public.move_proposal_answers (
    user_id, proposal_id, occurrence_id, behavior_id, local_date, kind, outcome, refusal_reason,
    move_id, batch_id, source, idempotency_key
  ) values (
    v_user_id, v_proposal.id, v_proposal.occurrence_id, v_proposal.behavior_id, v_proposal.local_date, p_kind, p_outcome,
    p_refusal_reason, p_move_id, p_batch_id, v_source, p_idempotency_key
  ) returning * into v_answer;

  return jsonb_build_object('replayed', false, 'answer', to_jsonb(v_answer) - 'user_id',
    'proposal', to_jsonb(v_proposal) - 'user_id');
end $$;

revoke all on function public.answer_move_proposal(uuid, text, text, text, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.answer_move_proposal(uuid, text, text, text, uuid, text, uuid) to authenticated;

-- "Don't suggest moving this" and its Behavior settings switch. The person only.
create function public.set_behavior_move_preference(p_behavior_id uuid, p_never_suggest_move boolean)
returns public.behavior_move_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.behavior_move_preferences;
begin
  if v_user_id is null or cadence_oauth_private.current_agent_channel() is not null
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'Move preferences are the person''s own setting.' using errcode = '42501';
  end if;
  if p_behavior_id is null or p_never_suggest_move is null then
    raise exception 'move_preference_invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.behaviors b where b.user_id = v_user_id and b.id = p_behavior_id) then
    raise exception 'Behavior not found.' using errcode = 'P0002';
  end if;
  insert into public.behavior_move_preferences (user_id, behavior_id, never_suggest_move, updated_at)
  values (v_user_id, p_behavior_id, p_never_suggest_move, now())
  on conflict (user_id, behavior_id) do update
    set never_suggest_move = excluded.never_suggest_move, updated_at = now()
  returning * into v_row;
  -- Switching it on closes today's undecided lines for that Behavior.
  if p_never_suggest_move then
    update public.move_proposals p
    set status = 'declined', status_changed_at = now()
    where p.user_id = v_user_id and p.behavior_id = p_behavior_id and p.status = 'proposed';
  end if;
  return v_row;
end $$;

revoke all on function public.set_behavior_move_preference(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_behavior_move_preference(uuid, boolean) to authenticated;

-- "assumes 30 min · change": the person's correction becomes the Behavior's default
-- length and replaces the cached estimate. The person only, with the Behavior's
-- revision (updated_at) as read.
create function public.set_behavior_default_length(p_behavior_id uuid, p_minutes integer, p_expected_revision timestamptz)
returns public.behaviors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.behaviors;
begin
  if v_user_id is null or cadence_oauth_private.current_agent_channel() is not null
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'A Behavior''s length is the person''s own setting.' using errcode = '42501';
  end if;
  if p_behavior_id is null or p_minutes is null or p_minutes not between 1 and 1440 or p_expected_revision is null then
    raise exception 'behavior_length_invalid_input' using errcode = '22023';
  end if;
  update public.behaviors b
  set default_duration_minutes = p_minutes
  where b.user_id = v_user_id and b.id = p_behavior_id and b.updated_at = p_expected_revision
  returning * into v_row;
  if v_row.id is null then
    if exists (select 1 from public.behaviors b where b.user_id = v_user_id and b.id = p_behavior_id) then
      -- Not 40001: PostgREST retries serialization failures until it times out.
      raise exception 'behavior_revision_changed' using errcode = 'P0001';
    end if;
    raise exception 'Behavior not found.' using errcode = 'P0002';
  end if;
  delete from public.behavior_advisor_estimates e where e.user_id = v_user_id and e.behavior_id = p_behavior_id;
  return v_row;
end $$;

revoke all on function public.set_behavior_default_length(uuid, integer, timestamptz) from public, anon, service_role;
grant execute on function public.set_behavior_default_length(uuid, integer, timestamptz) to authenticated;

-- Caches the model's estimates. p_estimates: [{"behavior_id", "input_hash",
-- "duration_minutes", "alongside", "model"}]. Daily Brief agent only.
create function public.upsert_behavior_advisor_estimates(p_estimates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_count integer;
begin
  if jsonb_typeof(p_estimates) is distinct from 'array' or jsonb_array_length(p_estimates) > 100 then
    raise exception 'advisor_estimate_invalid_input' using errcode = '22023';
  end if;
  insert into public.behavior_advisor_estimates (user_id, behavior_id, input_hash, duration_minutes, alongside, model, updated_at)
  select v_user_id, b.id, item ->> 'input_hash', nullif(item ->> 'duration_minutes', '')::integer,
    coalesce((item ->> 'alongside')::boolean, false), nullif(item ->> 'model', ''), now()
  from jsonb_array_elements(p_estimates) item
  join public.behaviors b on b.user_id = v_user_id and b.id = (item ->> 'behavior_id')::uuid
  on conflict (user_id, behavior_id) do update
    set input_hash = excluded.input_hash, duration_minutes = excluded.duration_minutes,
        alongside = excluded.alongside, model = excluded.model, updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.upsert_behavior_advisor_estimates(jsonb) from public, anon, service_role;
grant execute on function public.upsert_behavior_advisor_estimates(jsonb) to authenticated;

commit;
