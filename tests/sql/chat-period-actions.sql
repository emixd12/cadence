\set ON_ERROR_STOP on

-- Ticket 370 follow-up: chat_actions accepts the `period` kind for Chat's Period
-- writes, keeps every kind it accepted before, and still refuses an unknown kind.
-- Read-only: it inspects the constraint and changes nothing.
do $$ declare definition text; kind text; begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conname = 'chat_actions_kind_check' and conrelid = 'public.chat_actions'::regclass;
  if definition is null then raise exception 'chat_actions has no kind check'; end if;
  foreach kind in array array['status', 'occurrence_note', 'day_note', 'move', 'create_behavior', 'update_behavior',
    'archive_behavior', 'restore_behavior', 'opportunity', 'period'] loop
    if definition !~ ('''' || kind || '''::text') then raise exception 'chat_actions does not accept the % kind', kind; end if;
  end loop;
  if (select count(*) from regexp_matches(definition, '''[a-z_]+''::text', 'g')) <> 10 then
    raise exception 'chat_actions accepts an unexpected kind: %', definition;
  end if;
end $$;

select 'chat period actions fixture passed' as result;
