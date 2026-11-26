-- Ticket 370 follow-up: Cadence Chat records its Period writes.
--
-- chat_actions holds one row per write Chat made, with a kind. Chat's create_period,
-- update_period and end_period get their own kind, `period`. This file holds only that
-- constraint change. It drops the check and adds it again with one more value, so it
-- is outside the standing approval for additive hosted pushes (docs/DECISIONS.md,
-- 2026-11-10) and waits for the owner's yes. Both statements run in one transaction,
-- so the table is never without the check.
begin;

alter table public.chat_actions drop constraint chat_actions_kind_check;
alter table public.chat_actions add constraint chat_actions_kind_check check (kind in (
  'status', 'occurrence_note', 'day_note', 'move', 'create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior',
  'opportunity', 'period'
));

commit;
