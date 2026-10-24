-- Ticket 216: completion place labels and Where suggestions.
--
-- A place's reference position is a marker the user records on their own device
-- ("I'm here"). Cadence never fetches, stores or compares Google coordinates.
-- A completion stores only a label (home, saved_place:<place key>, elsewhere);
-- the device discards its position. Positions are integer microdegrees and
-- accuracy is whole meters, so hosted and desktop fingerprints match exactly.
begin;

create table public.place_label_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  id text not null default 'place_labels',
  enabled boolean not null default false,
  retention text not null default '90_days',
  enabled_at timestamptz,
  marker_prompt_dismissed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint place_label_settings_id_valid check (id = 'place_labels'),
  constraint place_label_settings_retention_valid check (retention in ('90_days', '1_year', 'until_deleted')),
  constraint place_label_settings_enabled_valid check (not enabled or enabled_at is not null)
);

create table public.place_markers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  id text not null,
  place_key text not null,
  latitude_e6 integer not null,
  longitude_e6 integer not null,
  accuracy_meters integer not null,
  rule_version text not null,
  recorded_at timestamptz not null,
  primary key (user_id, id),
  constraint place_markers_ref_valid check (
    place_key ~ '^[A-Za-z0-9_-]{43}$'
    and (id = 'home' or id = 'saved_place:' || place_key)
  ),
  constraint place_markers_position_valid check (
    latitude_e6 between -90000000 and 90000000
    and longitude_e6 between -180000000 and 180000000
    and accuracy_meters between 0 and 100
  ),
  constraint place_markers_rule_version_valid check (rule_version in ('place-label-rules@1'))
);

-- One label per completed occurrence; the label ID is the occurrence ID.
create table public.completion_place_labels (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  behavior_id uuid not null,
  local_date date not null,
  label text not null,
  rule_version text not null,
  recorded_at timestamptz not null,
  constraint completion_place_labels_occurrence_fkey
    foreign key (user_id, id) references public.occurrences(user_id, id) on delete cascade,
  constraint completion_place_labels_behavior_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint completion_place_labels_label_valid check (
    label in ('home', 'elsewhere') or label ~ '^saved_place:[A-Za-z0-9_-]{43}$'
  ),
  constraint completion_place_labels_rule_version_valid check (rule_version in ('place-label-rules@1'))
);

create index completion_place_labels_user_behavior_date_idx
  on public.completion_place_labels(user_id, behavior_id, local_date);
create index completion_place_labels_user_date_idx
  on public.completion_place_labels(user_id, local_date);

-- One dismissal per Behavior; the dismissal ID is the Behavior ID.
create table public.where_suggestion_dismissals (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  suggestion text not null,
  rule_version text not null,
  dismissed_at timestamptz not null,
  constraint where_suggestion_dismissals_behavior_fkey
    foreign key (user_id, id) references public.behaviors(user_id, id) on delete cascade,
  constraint where_suggestion_dismissals_suggestion_valid check (
    suggestion in ('home', 'anywhere', 'add_place') or suggestion ~ '^saved_place:[A-Za-z0-9_-]{43}$'
  ),
  constraint where_suggestion_dismissals_rule_version_valid check (rule_version in ('where-suggestion-rules@1'))
);

comment on table public.place_label_settings is
  'Ticket 216 opt-in, retention choice and marker-prompt dismissal. Off by default.';
comment on table public.place_markers is
  'Device-recorded "I''m here" positions for Home and saved places. Never Google coordinates.';
comment on table public.completion_place_labels is
  'One place label per completed occurrence: home, saved_place:<place key> or elsewhere. No positions.';
comment on table public.where_suggestion_dismissals is
  'Latest dismissed Where suggestion per Behavior, with the rule version that produced it.';

alter table public.place_label_settings enable row level security;
alter table public.place_markers enable row level security;
alter table public.completion_place_labels enable row level security;
alter table public.where_suggestion_dismissals enable row level security;

create policy place_label_settings_select_own on public.place_label_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy place_label_settings_insert_own on public.place_label_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy place_label_settings_update_own on public.place_label_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy place_markers_select_own on public.place_markers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy place_markers_insert_own on public.place_markers
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy place_markers_update_own on public.place_markers
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy place_markers_delete_own on public.place_markers
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy completion_place_labels_select_own on public.completion_place_labels
  for select to authenticated using ((select auth.uid()) = user_id);
create policy completion_place_labels_insert_own on public.completion_place_labels
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy completion_place_labels_delete_own on public.completion_place_labels
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy where_suggestion_dismissals_select_own on public.where_suggestion_dismissals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy where_suggestion_dismissals_insert_own on public.where_suggestion_dismissals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy where_suggestion_dismissals_update_own on public.where_suggestion_dismissals
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy where_suggestion_dismissals_delete_own on public.where_suggestion_dismissals
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.place_label_settings, public.place_markers,
  public.completion_place_labels, public.where_suggestion_dismissals
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.place_label_settings to authenticated;
grant select, insert, update, delete on table public.place_markers to authenticated;
grant select, insert, delete on table public.completion_place_labels to authenticated;
grant select, insert, update, delete on table public.where_suggestion_dismissals to authenticated;

-- Markers, labels and dismissals exist only while labels are on.
create function cadence_private.require_place_labels_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hold consent through the write. An opt-out must either delete this write
  -- afterwards or complete first and make this check reject it.
  perform 1 from public.place_label_settings settings
  where settings.user_id = new.user_id and settings.enabled
  for share;
  if not found then
    raise exception 'Completion place labels are off.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A label belongs to a Completed occurrence of the same Behavior and local date.
-- The share lock orders it after any concurrent status change.
create function cadence_private.require_completed_label_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.occurrences occurrence
  where occurrence.user_id = new.user_id
    and occurrence.id = new.id
    and occurrence.behavior_id = new.behavior_id
    and occurrence.local_date = new.local_date
    and occurrence.status = 'completed'
  for share;
  if not found then
    raise exception 'A place label needs a Completed occurrence.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Every writer (web, MCP, account sync) loses the label when status leaves Completed.
create function cadence_private.delete_label_when_not_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' and new.status is distinct from 'completed' then
    delete from public.completion_place_labels label
    where label.user_id = new.user_id and label.id = new.id;
  end if;
  return new;
end;
$$;

-- Turning labels off deletes labels, markers and dismissals for every writer.
create function cadence_private.clear_place_labels_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.enabled and not new.enabled then
    delete from public.completion_place_labels where user_id = new.user_id;
    delete from public.place_markers where user_id = new.user_id;
    delete from public.where_suggestion_dismissals where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.require_place_labels_enabled(),
  cadence_private.require_completed_label_occurrence(),
  cadence_private.delete_label_when_not_completed(),
  cadence_private.clear_place_labels_on_disable()
  from public, anon, authenticated, service_role;

create trigger place_markers_require_enabled
before insert or update on public.place_markers
for each row execute function cadence_private.require_place_labels_enabled();
create trigger completion_place_labels_require_enabled
before insert or update on public.completion_place_labels
for each row execute function cadence_private.require_place_labels_enabled();
create trigger where_suggestion_dismissals_require_enabled
before insert or update on public.where_suggestion_dismissals
for each row execute function cadence_private.require_place_labels_enabled();
create trigger completion_place_labels_require_completed
before insert or update on public.completion_place_labels
for each row execute function cadence_private.require_completed_label_occurrence();
create trigger occurrences_delete_label_when_not_completed
after update of status on public.occurrences
for each row execute function cadence_private.delete_label_when_not_completed();
create trigger place_label_settings_clear_on_disable
after update of enabled on public.place_label_settings
for each row execute function cadence_private.clear_place_labels_on_disable();

-- Settings save for the web: compare-and-set on updated_at, and a shorter
-- retention deletes older labels in the same transaction. The caller computes
-- the cutoff from the user's local date with the core resolver.
create function public.save_place_label_settings(
  next_enabled boolean,
  next_retention text,
  next_marker_prompt_dismissed boolean,
  expected_updated_at timestamptz,
  retention_cutoff date
)
returns setof public.place_label_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored public.place_label_settings%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into stored from public.place_label_settings
  where user_id = current_user_id for update;
  if found then
    if expected_updated_at is distinct from stored.updated_at then
      raise exception 'Place label settings changed after they were loaded.' using errcode = 'P0001';
    end if;
    update public.place_label_settings set
      enabled = next_enabled,
      retention = next_retention,
      enabled_at = case when next_enabled then coalesce(stored.enabled_at, statement_timestamp()) else null end,
      marker_prompt_dismissed_at = case
        when not next_marker_prompt_dismissed then null
        else coalesce(stored.marker_prompt_dismissed_at, statement_timestamp()) end,
      updated_at = statement_timestamp()
    where user_id = current_user_id;
  else
    if expected_updated_at is not null then
      raise exception 'Place label settings changed after they were loaded.' using errcode = 'P0001';
    end if;
    insert into public.place_label_settings (
      user_id, enabled, retention, enabled_at, marker_prompt_dismissed_at, updated_at
    ) values (
      current_user_id, next_enabled, next_retention,
      case when next_enabled then statement_timestamp() end,
      case when next_marker_prompt_dismissed then statement_timestamp() end,
      statement_timestamp()
    );
  end if;
  if next_enabled and retention_cutoff is not null then
    delete from public.completion_place_labels
    where user_id = current_user_id and local_date < retention_cutoff;
  end if;
  return query select * from public.place_label_settings where user_id = current_user_id;
end;
$$;

revoke all on function public.save_place_label_settings(boolean, text, boolean, timestamptz, date)
  from public, anon, service_role;
grant execute on function public.save_place_label_settings(boolean, text, boolean, timestamptz, date)
  to authenticated;

-- Daily rolling retention for every account, called by the occurrence-sync cron
-- with the service role. The local date follows each profile's timezone.
create function public.purge_expired_completion_place_labels()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.completion_place_labels label
  using public.place_label_settings settings, public.profiles profile
  where settings.user_id = label.user_id
    and profile.id = label.user_id
    and settings.retention <> 'until_deleted'
    and label.local_date < (
      (statement_timestamp() at time zone profile.timezone)::date
      - case settings.retention when '90_days' then interval '90 days' else interval '1 year' end
    )::date;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.purge_expired_completion_place_labels()
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_completion_place_labels() to service_role;

-- Account sync schema version 1 gains four closed entity kinds. Older desktop
-- builds reject unknown kinds and must update before synchronizing.
do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('public.read_account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$    union all select 'note_shortcut_state', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.note_shortcut_states r where r.user_id = current_user_id$a$;
  if position(anchor in definition) = 0 then raise exception 'Account snapshot changed unexpectedly.'; end if;
  execute replace(definition, anchor, anchor || $patch$
    union all select 'place_label_settings', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.place_label_settings r where r.user_id = current_user_id
    union all select 'place_marker', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.place_markers r where r.user_id = current_user_id
    union all select 'completion_place_label', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.completion_place_labels r where r.user_id = current_user_id
    union all select 'where_suggestion_dismissal', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.where_suggestion_dismissals r where r.user_id = current_user_id$patch$);

  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  anchor := $a$      'imported_intervention', 'reminder_delivery', 'note_shortcut_state'
    )$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync kind list changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$      'imported_intervention', 'reminder_delivery', 'note_shortcut_state',
      'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal'
    )$patch$);

  anchor := $a$    else
      begin row_id := (write ->> 'id')::uuid;$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync validation branch changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$    elsif write_kind = 'place_label_settings' then
      if write ->> 'id' <> 'place_labels' or (write ->> 'operation' = 'upsert' and (
        write #>> '{value,id}' is distinct from write ->> 'id'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 6
        or not ((write -> 'value') ?& array['id', 'enabled', 'retention', 'enabled_at', 'marker_prompt_dismissed_at', 'updated_at'])
      )) then
        raise exception 'The place label settings write is invalid.' using errcode = '22023';
      end if;
      select cadence_private.normalize_account_sync_row(to_jsonb(settings) - 'user_id') into stored_value
      from public.place_label_settings settings
      where settings.user_id = current_user_id
      for update;
    elsif write_kind = 'place_marker' then
      if coalesce(write ->> 'id', '') !~ '^(home|saved_place:[A-Za-z0-9_-]{43})$' or (write ->> 'operation' = 'upsert' and (
        write #>> '{value,id}' is distinct from write ->> 'id'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 7
        or not ((write -> 'value') ?& array['id', 'place_key', 'latitude_e6', 'longitude_e6', 'accuracy_meters', 'rule_version', 'recorded_at'])
      )) then
        raise exception 'The place marker write is invalid.' using errcode = '22023';
      end if;
      select cadence_private.normalize_account_sync_row(to_jsonb(marker) - 'user_id') into stored_value
      from public.place_markers marker
      where marker.user_id = current_user_id and marker.id = write ->> 'id'
      for update;
    else
      begin row_id := (write ->> 'id')::uuid;$patch$);

  anchor := $a$        when 'reminder_delivery' then 'public.reminder_deliveries'
      end;
      perform pg_advisory_xact_lock$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync validation tables changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$        when 'reminder_delivery' then 'public.reminder_deliveries'
        when 'completion_place_label' then 'public.completion_place_labels'
        when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals'
      end;
      perform pg_advisory_xact_lock$patch$);

  anchor := $a$      when 'note_shortcut_state' then 15 end,$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync upsert order changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$      when 'note_shortcut_state' then 15 when 'place_label_settings' then 16
      when 'place_marker' then 17 when 'completion_place_label' then 18
      when 'where_suggestion_dismissal' then 19 end,$patch$);

  anchor := $a$    elsif write_kind = 'note_shortcut_state' then
      if write_kind = 'behavior'$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync upsert branch changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$    elsif write_kind = 'place_label_settings' then
      write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
      insert into public.place_label_settings as settings
      select (jsonb_populate_record(null::public.place_label_settings, write_value)).*
      on conflict (user_id) do update set
        enabled = excluded.enabled, retention = excluded.retention, enabled_at = excluded.enabled_at,
        marker_prompt_dismissed_at = excluded.marker_prompt_dismissed_at, updated_at = excluded.updated_at;
      continue;
    elsif write_kind = 'place_marker' then
      write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
      insert into public.place_markers as marker
      select (jsonb_populate_record(null::public.place_markers, write_value)).*
      on conflict (user_id, id) do update set
        place_key = excluded.place_key, latitude_e6 = excluded.latitude_e6, longitude_e6 = excluded.longitude_e6,
        accuracy_meters = excluded.accuracy_meters, rule_version = excluded.rule_version, recorded_at = excluded.recorded_at;
      continue;
    elsif write_kind = 'note_shortcut_state' then
      if write_kind = 'behavior'$patch$);

  anchor := $a$      when 'imported_intervention' then 'public.imported_interventions' when 'reminder_delivery' then 'public.reminder_deliveries' end;

    if write_kind = 'category'$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync upsert tables changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$      when 'imported_intervention' then 'public.imported_interventions' when 'reminder_delivery' then 'public.reminder_deliveries'
      when 'completion_place_label' then 'public.completion_place_labels'
      when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals' end;

    if write_kind = 'category'$patch$);

  anchor := $a$      when 'note_shortcut_state' then -1
      when 'reminder_delivery' then 0$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync delete order changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$      when 'completion_place_label' then -2 when 'where_suggestion_dismissal' then -2
      when 'place_marker' then -2 when 'place_label_settings' then -2
      when 'note_shortcut_state' then -1
      when 'reminder_delivery' then 0$patch$);

  anchor := $a$    if write_kind = 'note_shortcut_state' then
      delete from public.note_shortcut_states
      where user_id = current_user_id and id = write ->> 'id';
      continue;
    end if;$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync delete branch changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$    if write_kind = 'note_shortcut_state' then
      delete from public.note_shortcut_states
      where user_id = current_user_id and id = write ->> 'id';
      continue;
    elsif write_kind = 'place_label_settings' then
      delete from public.place_label_settings where user_id = current_user_id;
      continue;
    elsif write_kind = 'place_marker' then
      delete from public.place_markers where user_id = current_user_id and id = write ->> 'id';
      continue;
    end if;$patch$);

  anchor := $a$      when 'import_run' then 'public.behaviorlog_import_runs' when 'reminder_delivery' then 'public.reminder_deliveries' end;
    if table_name is null then$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync delete tables changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$      when 'import_run' then 'public.behaviorlog_import_runs' when 'reminder_delivery' then 'public.reminder_deliveries'
      when 'completion_place_label' then 'public.completion_place_labels'
      when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals' end;
    if table_name is null then$patch$);

  execute definition;
end
$migration$;

commit;
