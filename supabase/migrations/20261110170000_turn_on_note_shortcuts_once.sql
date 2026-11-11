-- Ticket 305: accounts that turned Note shortcuts off are turned on once
-- (docs/DECISIONS.md, 2026-11-10; docs/MESSAGING_CHANGES.md P-034).
-- Data change, not additive: it rewrites the stored global switch from off to on.
-- Revision and updated_at stay unchanged, matching desktop SQLite migration 0022, so a
-- linked Mac and the hosted row converge without a synchronization conflict. The switch
-- itself stays, and a later stored off value is respected.
-- Rollback: there is no record of which accounts were off before this migration; take a
-- backup of note_shortcut_states where id = 'global' and enabled = false before pushing
-- if a rollback must be possible.
begin;

update public.note_shortcut_states
set enabled = true
where id = 'global' and enabled = false;

commit;
