-- Ticket 321 (D28.5): the background connector completion job's account selection.
-- Like the leave reminder job (Ticket 276), the service role reads only which
-- accounts are due and when: user_id, source and next_check_at. It reads no other
-- column and no other table, and writes nothing. Every other read and write runs as
-- the user through a minted five-minute token on the `connector_completion` channel.
--
-- This grant to service_role is outside the standing approval for additive
-- migrations (docs/DECISIONS.md, 2026-11-10). It needs the owner's yes before a
-- hosted push.
begin;

create index connector_completion_state_due_idx
  on public.connector_completion_state (next_check_at)
  where next_check_at is not null;

grant select (user_id, source, next_check_at) on table public.connector_completion_state to service_role;

commit;
