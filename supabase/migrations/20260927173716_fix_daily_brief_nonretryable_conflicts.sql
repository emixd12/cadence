begin;

-- These guards reject stale application input, not a serialization failure.
-- Retrying the same transaction cannot renew Calendar disclosure or change
-- p_expected_revision. Older PostgREST versions retry 40001 indefinitely.
-- 55000 already maps to context_changed in the Daily Brief repository.
do $migration$
declare
  target record;
  function_definition text;
  retryable_marker constant text := 'using errcode = ''40001'';';
  marker_count integer;
  save_signature regprocedure := coalesce(
    to_regprocedure('cadence_advisor_private.save_daily_brief_preferences_v2(boolean,boolean,boolean,boolean,bigint)'),
    'cadence_advisor_private.save_daily_brief_preferences(boolean,boolean,bigint)'::regprocedure
  );
begin
  for target in
    select * from (values
      ('cadence_advisor_private.begin_daily_brief(uuid,boolean,bigint)'::regprocedure, 2),
      (save_signature, 1)
    ) as targets(signature, expected_count)
  loop
    -- Preserve the installed body, grants and security settings, including
    -- bounded recovery and optional-source controls when already installed.
    function_definition := pg_get_functiondef(target.signature);
    marker_count := (
      length(function_definition) - length(replace(function_definition, retryable_marker, ''))
    ) / length(retryable_marker);
    if marker_count <> target.expected_count then
      raise exception 'Expected % retryable guards in %, found %.',
        target.expected_count, target.signature, marker_count;
    end if;
    execute replace(function_definition, retryable_marker, 'using errcode = ''55000'';');
  end loop;
end;
$migration$;

commit;
