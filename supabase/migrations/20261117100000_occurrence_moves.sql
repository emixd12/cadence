-- Advisor plan, Phase 2A: per-day moves (schema).
--
-- A move changes when one Occurrence happens today. It never changes scheduled_for,
-- the schedule fields or the Occurrence's identity: the occurrence sync rewrites an
-- unresolved Occurrence whose time differs from its schedule, and account sync merges
-- whole rows, so a move written there would be undone or land in conflict review.
-- Moves are their own append-only records instead, like occurrence_status_events.
-- Time and race rules: docs/DATETIME_STRATEGY.md, "Moves".
--
-- 1. occurrence_moves: what happened (synced read-only to the Mac, append-only).
-- 2. move_proposals: what an agent offered (server only, mutable status, never synced).
-- 3. move_conflicts: a schedule edit that collides with today's move (server only).
-- 4. occurrences.effective_start_at / effective_end_at: derived from the latest move,
--    written only by the move functions, left out of the account sync projection.
-- 5. Account sync contract 6 carries occurrence_move to linked Macs, read-only.
-- 6. Scope cadence.occurrences.move for the Daily Brief and chat agents.
--
-- The move and revert functions arrive in a later migration of Phase 2A.
begin;

-- 4. Derived effective time on the Occurrence ---------------------------------------
-- Null means the Occurrence sits at its planned time. authenticated gets no column
-- privilege on these, so only security-definer move functions write them; the trigger
-- below also keeps any other writer (account sync, restore, generation) from changing
-- them by accident.
alter table public.occurrences
  add column effective_start_at timestamptz,
  add column effective_end_at timestamptz,
  add constraint occurrences_effective_time_pair_check
    check ((effective_start_at is null) = (effective_end_at is null)),
  add constraint occurrences_effective_time_order_check
    check (effective_end_at is null or effective_end_at >= effective_start_at);

create function cadence_private.keep_occurrence_effective_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cadence.occurrence_move_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.effective_start_at := null;
    new.effective_end_at := null;
  else
    new.effective_start_at := old.effective_start_at;
    new.effective_end_at := old.effective_end_at;
  end if;
  return new;
end $$;

revoke all on function cadence_private.keep_occurrence_effective_time() from public, anon, authenticated, service_role;

create trigger keep_occurrence_effective_time
  before insert or update on public.occurrences
  for each row execute function cadence_private.keep_occurrence_effective_time();

create index occurrences_user_moved_local_date_idx
  on public.occurrences (user_id, local_date)
  where effective_start_at is not null;

-- 1. occurrence_moves ---------------------------------------------------------------
-- One row per applied move or undo, never edited. occurrence_id has no foreign key on
-- purpose: an Occurrence that a later sync or archive removes keeps its move history.
create table public.occurrence_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  local_date date not null,
  -- ISO weekday of local_date, 1 = Monday ... 7 = Sunday.
  weekday smallint not null check (weekday between 1 and 7),
  -- The Behavior's IANA timezone when the move was made. A later timezone change
  -- supersedes the move (it stops counting toward effective time).
  timezone text not null check (length(timezone) between 1 and 64),
  kind text not null check (kind in ('move', 'revert')),
  -- Effective time before this record. from_planned: it was the planned time.
  from_start_at timestamptz not null,
  from_end_at timestamptz not null,
  from_planned boolean not null,
  -- Effective time after this record. to_planned: a revert back to the planned time,
  -- so readers follow the plan (including a later schedule edit) instead of the copy.
  to_start_at timestamptz not null,
  to_end_at timestamptz not null,
  to_planned boolean not null default false,
  -- Where to_end_at's length came from: behavior_duration, logged_average,
  -- planned_length, kept_length (a re-move keeps the length), or the explicit input.
  duration_source text not null check (duration_source in (
    'behavior_duration', 'logged_average', 'planned_length', 'kept_length', 'explicit', 'restored'
  )),
  -- The previous record of this Occurrence's chain (null for the first).
  revises_move_id uuid,
  -- First record of this Occurrence's chain, and 1, 2, 3... in order.
  chain_root_id uuid not null,
  chain_position integer not null check (chain_position between 1 and 1000),
  -- Planner reason code (optional), and the chip a person tapped (see occurrence_move_reasons).
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  source text not null check (source in ('daily_brief', 'coach', 'chat', 'mcp', 'person')),
  proposal_id uuid,
  -- The OAuth client that wrote it (null for the person's own web session) and the
  -- caller's idempotency key. None of the three is synced.
  client_ref uuid,
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 1 and 255),
  -- Hash of the request that used the key, so reusing a key for different input is refused.
  request_hash text check (request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),

  unique (user_id, id),
  constraint occurrence_moves_kind_shape_check check (
    (kind = 'move' and not to_planned and to_end_at >= to_start_at)
    or (kind = 'revert' and revises_move_id is not null and chain_position > 1)
  ),
  constraint occurrence_moves_chain_root_check check (
    (chain_position = 1 and chain_root_id = id and revises_move_id is null)
    or (chain_position > 1 and revises_move_id is not null)
  ),
  constraint occurrence_moves_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint occurrence_moves_revises_owner_fkey
    foreign key (user_id, revises_move_id) references public.occurrence_moves(user_id, id),
  constraint occurrence_moves_chain_root_owner_fkey
    foreign key (user_id, chain_root_id) references public.occurrence_moves(user_id, id)
    deferrable initially deferred
);

create unique index occurrence_moves_chain_position_key
  on public.occurrence_moves (user_id, occurrence_id, chain_position);
create unique index occurrence_moves_revises_key
  on public.occurrence_moves (user_id, revises_move_id) where revises_move_id is not null;
create unique index occurrence_moves_idempotency_key
  on public.occurrence_moves (user_id, coalesce(client_ref, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key)
  where idempotency_key is not null;
create index occurrence_moves_user_local_date_idx
  on public.occurrence_moves (user_id, local_date, occurrence_id, chain_position);
create index occurrence_moves_behavior_created_idx
  on public.occurrence_moves (user_id, behavior_id, created_at);
create index occurrence_moves_chain_root_idx on public.occurrence_moves (user_id, chain_root_id);

alter table public.occurrence_moves enable row level security;
create policy occurrence_moves_select_own on public.occurrence_moves
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.occurrence_moves from anon, authenticated;
grant select on table public.occurrence_moves to authenticated;

-- The optional reason chip a person taps after a move. occurrence_moves stays
-- append-only, so the tap is its own small record, one per move: the first tap is kept
-- and later taps are ignored (taps arrive after the move, often from another device).
create table public.occurrence_move_reasons (
  move_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_reason text not null check (person_reason in ('running_late', 'conflict', 'low_energy', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, move_id),
  constraint occurrence_move_reasons_move_owner_fkey
    foreign key (user_id, move_id) references public.occurrence_moves(user_id, id) on delete cascade
);

alter table public.occurrence_move_reasons enable row level security;
create policy occurrence_move_reasons_select_own on public.occurrence_move_reasons
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.occurrence_move_reasons from anon, authenticated;
grant select on table public.occurrence_move_reasons to authenticated;

-- 2. move_proposals -------------------------------------------------------------------
-- What an agent offered. Server only: never synced, never reaches the Mac. A proposal
-- for a past date reads as expired; nothing writes "expired".
create table public.move_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  local_date date not null,
  source text not null check (source in ('daily_brief', 'coach', 'chat')),
  agent_run_id uuid,
  status text not null default 'proposed' check (status in (
    'proposed', 'accepted', 'declined', 'already_done', 'other_time', 'superseded', 'withdrawn'
  )),
  proposed_start_at timestamptz not null,
  proposed_end_at timestamptz not null check (proposed_end_at >= proposed_start_at),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- The Occurrence revision the card was built from (its updated_at).
  expected_revision timestamptz not null,
  -- The planner's one-way option references mapped to real ids, so a Yes can be applied.
  option_refs jsonb not null default '{}'::jsonb check (jsonb_typeof(option_refs) = 'object'),
  replaces_proposal_id uuid,
  move_id uuid,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint move_proposals_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint move_proposals_replaces_owner_fkey
    foreign key (user_id, replaces_proposal_id) references public.move_proposals(user_id, id) on delete set null (replaces_proposal_id),
  constraint move_proposals_move_owner_fkey
    foreign key (user_id, move_id) references public.occurrence_moves(user_id, id) on delete set null (move_id)
);

create index move_proposals_user_occurrence_idx on public.move_proposals (user_id, occurrence_id, status);
create index move_proposals_user_local_date_idx on public.move_proposals (user_id, local_date);
create trigger set_move_proposals_updated_at
  before update on public.move_proposals
  for each row execute function public.set_updated_at();

alter table public.move_proposals enable row level security;
create policy move_proposals_select_own on public.move_proposals
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.move_proposals from anon, authenticated;
grant select on table public.move_proposals to authenticated;

-- 3. move_conflicts ---------------------------------------------------------------------
-- A schedule edit after today's move kept the move, and the moved time now collides
-- with another Occurrence's time. The Timeline and the brief show it with Yes / No /
-- Other time. Server only, mutable status.
create table public.move_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  move_id uuid not null,
  local_date date not null,
  conflicting_occurrence_id uuid,
  status text not null default 'open' check (status in ('open', 'kept', 'reverted', 'moved', 'cleared')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint move_conflicts_resolution_check check ((status = 'open') = (resolved_at is null)),
  constraint move_conflicts_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint move_conflicts_move_owner_fkey
    foreign key (user_id, move_id) references public.occurrence_moves(user_id, id) on delete cascade
);

create unique index move_conflicts_open_key
  on public.move_conflicts (user_id, occurrence_id) where status = 'open';
create index move_conflicts_user_local_date_idx on public.move_conflicts (user_id, local_date);
create trigger set_move_conflicts_updated_at
  before update on public.move_conflicts
  for each row execute function public.set_updated_at();

alter table public.move_conflicts enable row level security;
create policy move_conflicts_select_own on public.move_conflicts
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.move_conflicts from anon, authenticated;
grant select on table public.move_conflicts to authenticated;

-- Timezone change supersedes today's moves --------------------------------------------
-- A move counts only while its timezone is the Behavior's timezone. When the zone
-- changes, effective time falls back to the plan; the move records stay as history.
create function cadence_private.supersede_moves_on_timezone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is distinct from old.timezone then
    perform set_config('cadence.occurrence_move_write', 'on', true);
    update public.occurrences as occurrence
    set effective_start_at = null, effective_end_at = null
    where occurrence.user_id = new.user_id
      and occurrence.behavior_id = new.id
      and occurrence.effective_start_at is not null;
    perform set_config('cadence.occurrence_move_write', '', true);
  end if;
  return new;
end $$;

revoke all on function cadence_private.supersede_moves_on_timezone_change() from public, anon, authenticated, service_role;

create trigger supersede_moves_on_timezone_change
  after update of timezone on public.behaviors
  for each row execute function cadence_private.supersede_moves_on_timezone_change();

-- 5. Account sync contract 6 ----------------------------------------------------------
-- Occurrence rows keep their projection: effective time is derived on each device from
-- the synced moves, so a move never makes the occurrence row differ between devices
-- and a status mark on the Mac never meets the move in conflict review.
-- occurrence_move joins at contract 6, read-only (not in apply_account_sync_plan's
-- writable kinds), without the writer's client_ref, idempotency key, request hash or proposal link.
insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (6, 'occurrence_move', null, null);

do $migration$
declare
  definition text;
  anchor text;
  replacement text;
begin
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;

  anchor := $a$union all select 'occurrence', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.occurrences r where r.user_id = current_user_id$a$;
  replacement := $r$union all select 'occurrence', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - array['user_id', 'effective_start_at', 'effective_end_at']) from public.occurrences r where r.user_id = current_user_id
    union all select 'occurrence_move', r.id::text, cadence_private.normalize_account_sync_row(
      to_jsonb(r) - array['user_id', 'client_ref', 'idempotency_key', 'request_hash', 'proposal_id']) from public.occurrence_moves r where r.user_id = current_user_id$r$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account snapshot changed unexpectedly.';
  end if;
  execute replace(definition, anchor, replacement);

  -- Account sync never writes effective time: an occurrence upsert from a device
  -- leaves both columns out of its insert and update lists.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  anchor := $a$and not attribute.attisdropped and attribute.attgenerated = '' and attribute.attname <> 'id'$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync apply changed unexpectedly (update list).';
  end if;
  definition := replace(definition, anchor,
    anchor || $p$ and attribute.attname not in ('effective_start_at', 'effective_end_at')$p$);
  anchor := $a$and not attribute.attisdropped and attribute.attgenerated = '';$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync apply changed unexpectedly (insert list).';
  end if;
  definition := replace(definition, anchor,
    $p$and not attribute.attisdropped and attribute.attgenerated = '' and attribute.attname not in ('effective_start_at', 'effective_end_at');$p$);
  -- The stored row a device's expected value is compared with has the snapshot's shape.
  anchor := $a$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - ''user_id'') from %s owned_row where user_id = $1 and id = $2 for update'$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync apply changed unexpectedly (stored row).';
  end if;
  definition := replace(definition, anchor,
    $p$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - array[''user_id'', ''effective_start_at'', ''effective_end_at'']) from %s owned_row where user_id = $1 and id = $2 for update'$p$);
  execute definition;
end
$migration$;

-- 6. Move scope -------------------------------------------------------------------------
-- cadence.occurrences.move lets a caller move and undo today's Occurrences, nothing
-- else. The Daily Brief and chat get it; the coach stays read-only. Outside MCP clients
-- move with cadence.occurrences.write, which includes moving.
create or replace function cadence_oauth_private.scopes_valid(p_scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scopes is not null
    and cardinality(p_scopes) between 1 and 4
    and 'cadence.read' = any(p_scopes)
    and p_scopes <@ array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write', 'cadence.occurrences.move']::text[]
    and cardinality(p_scopes) = (select count(distinct scope) from unnest(p_scopes) as scope)
$$;

update cadence_oauth_private.agent_channels
set default_scopes = array['cadence.read', 'cadence.occurrences.move']
where channel = 'daily_brief';

update cadence_oauth_private.agent_channels
set default_scopes = array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write', 'cadence.occurrences.move']
where channel = 'chat';

commit;
