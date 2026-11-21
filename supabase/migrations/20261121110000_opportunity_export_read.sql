-- Behaviors of Opportunity: the export page bundle carries `behaviors.is_opportunity`
-- and `occurrences.origin` / `added_by`, so Full JSON, JSONL and BehaviorLog exports
-- keep them (docs/EXPORT_FORMATS.md, "Behaviors of Opportunity"). Additive: the
-- function keeps its signature, security and grants.

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
  select pg_get_functiondef('public.get_export_page_read_bundle(date,date)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$            'scheduled_time', b.scheduled_time,$a$,
    $p$            'scheduled_time', b.scheduled_time,
            'is_opportunity', b.is_opportunity,$p$, 'Export page Behavior opportunity flag');
  definition := pg_temp.patch_definition(definition, $a$            'status_marked_at', o.status_marked_at,$a$,
    $p$            'status_marked_at', o.status_marked_at,
            'origin', o.origin,
            'added_by', o.added_by,$p$, 'Export page Occurrence origin');
  execute definition;
end;
$migration$;
