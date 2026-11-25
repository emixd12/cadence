-- Tickets 352 & 353 review fix: separate ledger incremental cursor (`ledger_cursor`)
-- from connector-completion's `read_cursor` so foreground Timeline/Brief/Chat reads
-- never skip events for `reconcileConnectorCompletions`, and track whether the
-- bounded backfill reached full history (`backfill_complete`) so accounts above the
-- 500-workout cap are reported honestly as incomplete rather than complete.
begin;

alter table public.connector_completion_state
  add column if not exists ledger_cursor text check (ledger_cursor is null or char_length(ledger_cursor) <= 256),
  add column if not exists backfill_complete boolean not null default false;

grant insert (ledger_cursor, backfill_complete)
  on table public.connector_completion_state to authenticated;
grant update (ledger_cursor, backfill_complete)
  on table public.connector_completion_state to authenticated;

commit;
