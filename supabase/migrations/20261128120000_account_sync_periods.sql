-- Ticket 374 (D35): account sync contract 12 adds the period kind.
--
-- Cadence for Mac builds on contract 12 read and write Periods through account sync.
-- Builds on contracts 8 to 11 do not see them: the existing projection hides a whole
-- kind added at a later contract and rejects their attempts to write it, so their
-- writes keep hosted Periods. Periods use the generic UUID row path. A removed Period
-- is a deleted row; the planner reads the deletion from the saved baseline, so no
-- tombstone column is needed. It is additive: the minimum writer contract stays 8.
--
-- The cap trigger changes for one case only. Account sync writes a row with
-- "insert ... on conflict (id) do update", and Postgres fires a before-insert trigger
-- before it finds the conflict. Without the change, an account holding 500 Periods
-- could not synchronize an edit of one of them. A row whose id the account already
-- holds is an update, not a new Period, so the trigger lets it through. Every other
-- writer inserts a new id and meets the same count as before. For the same reason the
-- apply step runs a plan's Period removals before its upserts, so a plan that removes one
-- Period and adds another fits at 500.
--
-- No drop, no constraint or trigger replacement, no write to a user table. The
-- registry row is configuration in cadence_private.
begin;

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (12, 'period', null, null);

create or replace function cadence_private.periods_enforce_account_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':periods', 0)
  );
  if exists (
    select 1 from public.periods period
    where period.user_id = new.user_id and period.id = new.id
  ) then
    return new;
  end if;
  select count(*) into owned
  from public.periods period
  where period.user_id = new.user_id;
  if owned >= 500 then
    raise exception 'An account can hold at most 500 periods.' using errcode = '54000';
  end if;
  return new;
end;
$$;

do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$    union all select 'day_note', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.day_notes r where r.user_id = current_user_id$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account snapshot changed unexpectedly.';
  end if;
  execute replace(definition, anchor, anchor || $patch$
    union all select 'period', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.periods r where r.user_id = current_user_id$patch$);

  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  anchor := $a$'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal',
      'day_note'
    )$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync kind list changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, $patch$'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal',
      'day_note', 'period'
    )$patch$);

  -- The validation, upsert and delete table maps.
  anchor := $a$when 'day_note' then 'public.day_notes'$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 3 then
    raise exception 'Account sync table maps changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, anchor || $patch$
        when 'period' then 'public.periods'$patch$);

  anchor := $a$when 'day_note' then 20 end,$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync upsert order changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, $patch$when 'day_note' then 20
      when 'period' then 21 end,$patch$);

  -- The apply step writes upserts before deletes. A plan that removes one Period and adds
  -- another for an account at 500 would meet the cap before its removal ran, so planned
  -- Period removals run first. Every write was validated and locked above; the later
  -- delete loop finds these rows gone.
  anchor := $a$  -- Apply inserts and updates in parent-before-child order.$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync apply order changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, $patch$  -- Ticket 374: planned Period removals first, so a removal and an addition fit under the cap.
  delete from public.periods period
  where period.user_id = current_user_id
    and period.id::text in (
      select planned ->> 'id'
      from jsonb_array_elements(sync_payload #> '{plan,writes}') planned
      where planned ->> 'kind' = 'period' and planned ->> 'operation' = 'delete'
    );

$patch$ || anchor);

  execute definition;
end
$migration$;

commit;
