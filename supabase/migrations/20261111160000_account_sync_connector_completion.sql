-- Ticket 320 (D28): account sync contract 5 carries the connector completion records to
-- linked Macs, read-only.
--
-- behavior_source_link and occurrence_source_match join the snapshot with only the fields
-- a Mac shows: no routine digests, account digest, activity reference, revision, scheduled
-- window or status event references. Contracts 1-4 do not see either kind: the existing
-- projection hides a whole kind added at a later contract and rejects writes to it.
-- Neither kind joins apply_account_sync_plan's writable list, so no contract can write
-- them through account sync; the link form and the connector functions stay the only
-- writers. The client plan never sends them (account-sync.resolver.ts, READ_ONLY_KINDS).
begin;

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (5, 'behavior_source_link', null, null),
  (5, 'occurrence_source_match', null, null);

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
    union all select 'behavior_source_link', r.id::text, cadence_private.normalize_account_sync_row(
      to_jsonb(r) - array['user_id', 'selector_keys', 'account_digest']) from public.behavior_source_links r where r.user_id = current_user_id
    union all select 'occurrence_source_match', r.id::text, cadence_private.normalize_account_sync_row(
      to_jsonb(r) - array['user_id', 'link_id', 'activity_ref', 'activity_revision', 'scheduled_start_at', 'scheduled_end_at',
        'applied_event_id', 'reverted_event_id']) from public.occurrence_source_matches r where r.user_id = current_user_id$patch$);
end
$migration$;

commit;
