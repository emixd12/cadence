-- Ticket 292: account sync contract 3 adds the day_note kind.
--
-- Older desktop builds (contract 2) do not see day notes; the existing projection
-- hides the kind and rejects their attempts to write it. Day notes use the generic
-- UUID row path. Clearing keeps the row, so no tombstone is needed.
begin;

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (3, 'day_note', null, null);

do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$    union all select 'where_suggestion_dismissal', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.where_suggestion_dismissals r where r.user_id = current_user_id$a$;
  if position(anchor in definition) = 0 then raise exception 'Account snapshot changed unexpectedly.'; end if;
  execute replace(definition, anchor, anchor || $patch$
    union all select 'day_note', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.day_notes r where r.user_id = current_user_id$patch$);

  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  anchor := $a$'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal'
    )$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync kind list changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal',
      'day_note'
    )$patch$);

  anchor := $a$when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals'$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 3 then
    raise exception 'Account sync table maps changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, anchor || $patch$
        when 'day_note' then 'public.day_notes'$patch$);

  anchor := $a$when 'where_suggestion_dismissal' then 19 end,$a$;
  if position(anchor in definition) = 0 then raise exception 'Account sync upsert order changed unexpectedly.'; end if;
  definition := replace(definition, anchor, $patch$when 'where_suggestion_dismissal' then 19
      when 'day_note' then 20 end,$patch$);

  execute definition;
end
$migration$;

commit;
