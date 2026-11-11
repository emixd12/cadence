-- Ticket 305: Note shortcuts are on by default. Turn a stored global off switch on
-- once, matching hosted 20261110170000_turn_on_note_shortcuts_once.sql. Revision and
-- updated_at stay unchanged so a linked Mac and the hosted row converge without a
-- synchronization conflict. A later stored off switch is respected.
UPDATE note_shortcut_states SET enabled = 1 WHERE id = 'global' AND enabled = 0;
