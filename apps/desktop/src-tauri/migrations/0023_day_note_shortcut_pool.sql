-- Ticket 292: the day-note Note shortcuts pool. Mirrors hosted
-- 20261111120000_day_note_shortcut_pool.sql: one more note_shortcut_states row per
-- profile, id 'day_notes' with a NULL behavior_id. Its evidence and exclusion IDs
-- are day-note IDs. SQLite cannot change a CHECK in place, so the table is rebuilt.
-- No table references note_shortcut_states, so foreign keys stay enabled.
CREATE TABLE note_shortcut_states_v22 (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    behavior_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    entries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entries) AND json_type(entries) = 'array'),
    excluded_occurrence_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(excluded_occurrence_ids) AND json_type(excluded_occurrence_ids) = 'array'),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 2147483647),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, behavior_id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE,
    CHECK (
        (id = 'global' AND behavior_id IS NULL AND json_array_length(entries) = 0 AND json_array_length(excluded_occurrence_ids) = 0)
        OR (id = 'day_notes' AND behavior_id IS NULL)
        OR (behavior_id IS NOT NULL AND id = behavior_id)
    )
) STRICT;

INSERT INTO note_shortcut_states_v22 (id,user_id,behavior_id,enabled,entries,excluded_occurrence_ids,revision,updated_at)
SELECT id,user_id,behavior_id,enabled,entries,excluded_occurrence_ids,revision,updated_at FROM note_shortcut_states;
DROP TRIGGER note_shortcut_states_data_revision_insert;
DROP TRIGGER note_shortcut_states_data_revision_update;
DROP TRIGGER note_shortcut_states_data_revision_delete;
DROP TABLE note_shortcut_states;
ALTER TABLE note_shortcut_states_v22 RENAME TO note_shortcut_states;

CREATE TRIGGER note_shortcut_states_data_revision_insert AFTER INSERT ON note_shortcut_states BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER note_shortcut_states_data_revision_update AFTER UPDATE ON note_shortcut_states WHEN
    OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id OR OLD.behavior_id IS NOT NEW.behavior_id OR
    OLD.enabled IS NOT NEW.enabled OR OLD.entries IS NOT NEW.entries OR
    OLD.excluded_occurrence_ids IS NOT NEW.excluded_occurrence_ids OR
    OLD.revision IS NOT NEW.revision OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER note_shortcut_states_data_revision_delete AFTER DELETE ON note_shortcut_states BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
