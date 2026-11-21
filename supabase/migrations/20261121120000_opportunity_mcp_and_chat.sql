-- Behaviors of Opportunity, MCP contract 1.6.0 and Cadence chat (Task 6). Additive.
-- 1. MCP Behavior write receipts keep `is_opportunity`, so create_behavior and
--    update_behavior report the stored flag (the receipt source is an allowlist).
-- 2. Chat actions accept the `opportunity` kind for add_opportunity_occurrence and
--    remove_opportunity_occurrence.

create function pg_temp.patch_definition(definition text, anchor text, replacement text, label text)
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

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('cadence_private.integration_write_source(jsonb,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$'auto_archived_at','end_on',$a$,
    $p$'auto_archived_at','is_opportunity','end_on',$p$, 'Integration write source opportunity flag');
  execute definition;
end;
$migration$;

alter table public.chat_actions drop constraint chat_actions_kind_check;
alter table public.chat_actions add constraint chat_actions_kind_check check (kind in (
  'status', 'occurrence_note', 'day_note', 'move', 'create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior',
  'opportunity'
));
