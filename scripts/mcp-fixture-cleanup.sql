-- Operator-reviewed synthetic-account cleanup only. No automatic connection or retry.
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
DO $cleanup$
DECLARE
  manifest jsonb := convert_from(decode('MANIFEST_HEX', 'hex'), 'UTF8')::jsonb;
  entry jsonb;
  actual jsonb;
  relation text;
  owner_id uuid;
  behavior_ids uuid[];
  category_ids uuid[];
  expected_ids uuid[];
  actual_ids uuid[];
  behavior public.behaviors;
  graph jsonb;
  previous_config jsonb;
  next_config jsonb;
  event_plan jsonb;
  payload jsonb;
  result jsonb;
  archived_count integer := 0;
  expected_count integer := 0;
  stamp timestamptz := clock_timestamp();
BEGIN
  IF manifest->>'runId'='4db9fe6e-a966-4cca-938b-aee5a1b955b7'
    AND (manifest->>'startedAt' <> '2026-10-28T02:17:18.882Z'
      OR stamp > '2026-11-04T02:17:18.882Z'::timestamptz) THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
  -- Match the product's account mutation lock, then lock every captured row before writes.
  FOR owner_id IN SELECT value::uuid FROM jsonb_array_elements_text(manifest->'users') ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(manifest->'rows') ORDER BY value->>'table', value->>'id' LOOP
    relation := entry->>'table';
    IF relation <> ALL(ARRAY['categories','behaviors','behavior_schedules','behavior_schedule_slots','occurrences',
      'occurrence_status_events','behavior_definition_events','behavior_configuration_events','occurrence_time_sessions']) THEN
      RAISE EXCEPTION 'cleanup-refused';
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE', relation)
      INTO actual USING (entry->>'id')::uuid;
    IF actual IS NULL OR actual->>'user_id' IS DISTINCT FROM entry->>'user_id'
      OR (actual->>'created_at')::timestamptz IS DISTINCT FROM (entry->>'created_at')::timestamptz
      OR (actual->>'created_at')::timestamptz < (manifest->>'startedAt')::timestamptz
      OR (actual->>'created_at')::timestamptz > (manifest->>'capturedAt')::timestamptz
      OR entry->>'run_id' IS DISTINCT FROM manifest->>'runId' THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
  END LOOP;
  SELECT array_agg((value->>'id')::uuid ORDER BY value->>'id') INTO behavior_ids
    FROM jsonb_array_elements(manifest->'rows') WHERE value->>'table'='behaviors';
  SELECT array_agg((value->>'id')::uuid ORDER BY value->>'id') INTO category_ids
    FROM jsonb_array_elements(manifest->'rows') WHERE value->>'table'='categories';
  -- Reject omitted graph rows and unexpected category users. Never widen the manifest here.
  FOR relation IN SELECT jsonb_object_keys(manifest->'counts') LOOP
    SELECT coalesce(array_agg((value->>'id')::uuid ORDER BY value->>'id'), '{}'::uuid[]) INTO expected_ids
      FROM jsonb_array_elements(manifest->'rows') WHERE value->>'table'=relation;
    IF relation='categories' THEN
      SELECT array_agg(id ORDER BY id) INTO actual_ids FROM public.categories WHERE id=ANY(category_ids);
    ELSIF relation='behaviors' THEN
      -- Fixture categories must hold only captured Behaviors. Acceptance clients create
      -- uncategorized Behaviors, so a captured uncategorized row counts only as itself.
      SELECT array_agg(id ORDER BY id) INTO actual_ids FROM public.behaviors
        WHERE category_id=ANY(category_ids) OR (id=ANY(behavior_ids) AND category_id IS NULL);
    ELSE
      EXECUTE format('SELECT array_agg(id ORDER BY id) FROM public.%I WHERE behavior_id=ANY($1)', relation)
        INTO actual_ids USING behavior_ids;
    END IF;
    IF coalesce(actual_ids,'{}'::uuid[]) IS DISTINCT FROM expected_ids
      OR cardinality(expected_ids) <> (manifest->'counts'->>relation)::integer THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.behaviors WHERE id=ANY(behavior_ids) AND
    ((category_id IS NOT NULL AND title NOT IN ('Review walk','Review reading','Review stretch','Review practice'))
      OR (category_id IS NULL AND title !~ '^Review practice [a-z0-9-]{1,40}( edited)?$')
      OR browser_reminder_enabled OR email_reminder_enabled OR timezone <> 'America/New_York'))
    OR EXISTS(SELECT 1 FROM public.categories WHERE id=ANY(category_ids) AND name <> 'Review examples')
    OR EXISTS(SELECT 1 FROM public.occurrence_time_sessions WHERE behavior_id=ANY(behavior_ids) AND stopped_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.reminder_deliveries WHERE occurrence_id IN
      (SELECT id FROM public.occurrences WHERE behavior_id=ANY(behavior_ids))) THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
  SELECT count(*) INTO expected_count FROM public.behaviors WHERE id=ANY(behavior_ids) AND active;
  FOR behavior IN SELECT * FROM public.behaviors WHERE id=ANY(behavior_ids) ORDER BY id LOOP
    IF NOT behavior.active THEN CONTINUE; END IF;
    PERFORM set_config('request.jwt.claim.sub', behavior.user_id::text, true);
    graph := cadence_private.current_behavior_schedule_graph(behavior.user_id, behavior.id);
    previous_config := cadence_private.current_behavior_configuration_snapshot(behavior.user_id, behavior.id);
    next_config := jsonb_set(previous_config, '{active}', 'false');
    event_plan := jsonb_build_object('event_kind','revision','previous_configuration',previous_config,
      'next_configuration',next_config,'changed_fields',jsonb_build_array('active'),'recorded_at',stamp,
      'effective_at',stamp,'effective_local_date',(stamp AT TIME ZONE behavior.timezone)::date,
      'timezone',behavior.timezone,'source','manual','reason_code','behavior_archived');
    payload := to_jsonb(behavior) || jsonb_build_object('active',false,'archived_at',stamp,
      'archive_notes',behavior.archive_notes || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),
        'archived_at',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'note',NULL)));
    result := public.update_behavior_with_schedule_graph(behavior.id,payload,
      jsonb_build_object('stored_title',behavior.title,'stored_description',behavior.description,
        'normalized_title',behavior.title,'normalized_description',behavior.description),
      graph,behavior.updated_at,NULL,event_plan,graph);
    IF result IS NULL OR result->>'id' IS DISTINCT FROM behavior.id::text
      OR (result->>'active')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
    archived_count := archived_count+1;
  END LOOP;
  IF archived_count <> expected_count OR EXISTS(SELECT 1 FROM public.behaviors WHERE id=ANY(behavior_ids)
    AND (active OR archived_at IS NULL)) THEN RAISE EXCEPTION 'cleanup-refused'; END IF;
END
$cleanup$;
COMMIT;
