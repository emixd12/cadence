-- Account sync: sibling order stays out of configuration history (Ticket 349).
--
-- 20261122010000 made sub_behavior_sort_order display order, outside configuration history,
-- but apply_account_sync_plan still required a configuration event for any Behavior field
-- other than title, description and updated_at. A Mac reorder changes only the order, so
-- its contract-9 sync failed with "A Behavior configuration change requires append-only
-- configuration history." The check now ignores the order as well. Contract-8 writers are
-- unchanged: their projection restores the stored order before this comparison.
begin;

do $migration$
declare
  definition text;
  anchor text := $a$        if (stored_value - array['title','description','updated_at'])
            is distinct from ((write -> 'value') - array['title','description','updated_at'])$a$;
  replacement text := $p$        if (stored_value - array['title','description','updated_at','sub_behavior_sort_order'])
            is distinct from ((write -> 'value') - array['title','description','updated_at','sub_behavior_sort_order'])$p$;
begin
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then
    raise exception 'Account sync configuration check changed unexpectedly.';
  end if;
  if position(anchor in substr(definition, position(anchor in definition) + length(anchor))) > 0 then
    raise exception 'Account sync configuration check anchor is not unique.';
  end if;
  execute replace(definition, anchor, replacement);
end
$migration$;

commit;
