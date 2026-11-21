-- Sub-behaviors: portability and connector completion (D28).
--
-- 1. An archived sub-behavior may link to an archived parent, so a BehaviorLog import or
--    restore can bring back an archived routine as one group. An active Behavior still
--    cannot take a new link to an archived parent.
-- 2. A source link on a parent Behavior reaches its sub-behaviors: a connector completion,
--    attachment or removal may target an Occurrence of a sub-behavior of the link's
--    Behavior. Every other D28 precondition is unchanged. A match still records the
--    Occurrence's own Behavior, so one activity completes each sub-behavior at most once.
-- 3. An opportunity Behavior (Behaviors of Opportunity) is never part of a routine: it
--    cannot be a parent or a sub-behavior. The check also runs when the flag changes.
begin;

create or replace function cadence_private.enforce_behavior_sub_behavior_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored public.behaviors;
  parent public.behaviors;
begin
  select * into stored from public.behaviors where id = new.id;
  if not found then
    return null;
  end if;
  if stored.is_opportunity and (stored.parent_behavior_id is not null or exists (
    select 1 from public.behaviors child
    where child.user_id = stored.user_id and child.parent_behavior_id = stored.id)) then
    raise exception 'An opportunity Behavior can''t be part of a routine.' using errcode = '23514';
  end if;
  if stored.parent_behavior_id is null then
    return null;
  end if;

  select * into parent from public.behaviors
  where id = stored.parent_behavior_id and user_id = stored.user_id;
  if not found then
    return null;
  end if;
  if parent.is_opportunity then
    raise exception 'An opportunity Behavior can''t be part of a routine.' using errcode = '23514';
  end if;

  if parent.parent_behavior_id is not null then
    raise exception 'A sub-behavior can''t have sub-behaviors.' using errcode = '23514';
  end if;
  if exists (select 1 from public.behaviors child
    where child.user_id = stored.user_id and child.parent_behavior_id = stored.id) then
    raise exception 'A Behavior with sub-behaviors can''t become a sub-behavior.' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or old.parent_behavior_id is distinct from new.parent_behavior_id)
    and (parent.archived_at is not null or not parent.active)
    and stored.active and stored.archived_at is null then
    raise exception 'An archived Behavior can''t take sub-behaviors.' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function cadence_private.enforce_behavior_sub_behavior_depth() from public, anon, authenticated, service_role;

drop trigger enforce_behavior_sub_behavior_depth on public.behaviors;
create constraint trigger enforce_behavior_sub_behavior_depth
  after insert or update of parent_behavior_id, is_opportunity on public.behaviors
  deferrable initially deferred
  for each row execute function cadence_private.enforce_behavior_sub_behavior_depth();

create or replace function cadence_private.connector_match_precondition(
  owner_id uuid,
  target_link public.behavior_source_links,
  target_occurrence public.occurrences,
  activity_start timestamptz,
  activity_end timestamptz,
  recorded timestamptz
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  behavior_timezone text;
  behavior_active boolean;
  occurrence_behavior_active boolean;
begin
  if target_link.id is null or not target_link.enabled then return 'link_unavailable'; end if;
  if target_occurrence.id is null then return 'link_unavailable'; end if;
  -- The link's own Behavior, or one of its sub-behaviors.
  select occurrence_behavior.active and occurrence_behavior.archived_at is null
  into occurrence_behavior_active
  from public.behaviors occurrence_behavior
  where occurrence_behavior.user_id = owner_id and occurrence_behavior.id = target_occurrence.behavior_id
    and (occurrence_behavior.id = target_link.behavior_id
      or occurrence_behavior.parent_behavior_id = target_link.behavior_id);
  if not coalesce(occurrence_behavior_active, false) then return 'link_unavailable'; end if;
  select behavior.timezone, behavior.active and behavior.archived_at is null
  into behavior_timezone, behavior_active
  from public.behaviors behavior
  where behavior.user_id = owner_id and behavior.id = target_link.behavior_id;
  if not coalesce(behavior_active, false) then return 'link_unavailable'; end if;
  if not exists (
    select 1 from public.connector_connections connection
    where connection.user_id = owner_id and connection.provider = target_link.source
      and connection.status = 'connected'
  ) then
    return 'source_not_connected';
  end if;
  if not exists (
    select 1 from public.connector_connections connection
    where connection.user_id = owner_id and connection.provider = target_link.source
      and connection.status = 'connected' and connection.account_digest = target_link.account_digest
  ) then
    return 'account_changed';
  end if;
  if activity_end > recorded then return 'activity_unfinished'; end if;
  if abs(extract(epoch from (activity_start - target_occurrence.scheduled_for))) > 48 * 3600 then
    return 'outside_schedule';
  end if;
  -- D28.6: today and the 30 prior local dates, in the Behavior's timezone.
  if target_occurrence.local_date < ((recorded at time zone coalesce(behavior_timezone, 'America/New_York'))::date - 30) then
    return 'outside_window';
  end if;
  return null;
end;
$$;
revoke all on function cadence_private.connector_match_precondition(uuid, public.behavior_source_links, public.occurrences, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function pg_temp.patch_definition(definition text, anchor text, replacement text, label text)
returns text
language plpgsql
as $$
begin
  if position(anchor in definition) = 0 then
    raise exception '% changed unexpectedly.', label;
  end if;
  if position(anchor in substr(definition, position(anchor in definition) + length(anchor))) > 0 then
    raise exception '% anchor is not unique.', label;
  end if;
  return replace(definition, anchor, replacement);
end;
$$;

-- One match per activity and Occurrence Behavior (the matches' unique key), not per link Behavior.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.apply_connector_completion(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,timestamptz)'::regprocedure)
    into definition;
  definition := pg_temp.patch_definition(definition,
    $a$and match.activity_ref = p_activity_ref and match.behavior_id = link_row.behavior_id$a$,
    $p$and match.activity_ref = p_activity_ref and match.behavior_id = occurrence_row.behavior_id$p$,
    'Connector completion match lookup');
  execute definition;

  select pg_get_functiondef('public.attach_source_activity(uuid,uuid,text,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure)
    into definition;
  definition := pg_temp.patch_definition(definition,
    $a$and match.activity_ref = p_activity_ref and match.behavior_id = link_row.behavior_id$a$,
    $p$and match.activity_ref = p_activity_ref and match.behavior_id = occurrence_row.behavior_id$p$,
    'Source attachment match lookup');
  execute definition;
end;
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
