-- Ticket 217: learned travel habits, mirroring the hosted October 22, 2026
-- migration. NULL minutes follow the versioned core defaults. The JSON columns
-- hold the same snake_case entries as the hosted jsonb columns; the native
-- writers validate each entry, its order and its bounds before storing it.
ALTER TABLE travel_settings ADD COLUMN preparation_minutes INTEGER
  CHECK (preparation_minutes IS NULL OR preparation_minutes BETWEEN 0 AND 60);
ALTER TABLE travel_settings ADD COLUMN arrival_buffer_minutes INTEGER
  CHECK (arrival_buffer_minutes IS NULL OR arrival_buffer_minutes BETWEEN 0 AND 30);
ALTER TABLE travel_settings ADD COLUMN place_modes TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(place_modes) AND json_type(place_modes) = 'array' AND json_array_length(place_modes) <= 100);
ALTER TABLE travel_settings ADD COLUMN leave_feedback TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(leave_feedback) AND json_type(leave_feedback) = 'array' AND json_array_length(leave_feedback) <= 30);
ALTER TABLE travel_settings ADD COLUMN habits_updated_at TEXT;

-- SQLite cannot add a table CHECK to an existing table; triggers keep the
-- hosted rule that learned values require a habit revision.
CREATE TRIGGER travel_settings_habits_revision_insert BEFORE INSERT ON travel_settings
WHEN NEW.habits_updated_at IS NULL AND (NEW.preparation_minutes IS NOT NULL
  OR NEW.arrival_buffer_minutes IS NOT NULL OR NEW.place_modes <> '[]' OR NEW.leave_feedback <> '[]')
BEGIN SELECT RAISE(ABORT, 'Learned travel habits require a revision.'); END;

CREATE TRIGGER travel_settings_habits_revision_update BEFORE UPDATE OF
  preparation_minutes, arrival_buffer_minutes, place_modes, leave_feedback, habits_updated_at ON travel_settings
WHEN NEW.habits_updated_at IS NULL AND (NEW.preparation_minutes IS NOT NULL
  OR NEW.arrival_buffer_minutes IS NOT NULL OR NEW.place_modes <> '[]' OR NEW.leave_feedback <> '[]')
BEGIN SELECT RAISE(ABORT, 'Learned travel habits require a revision.'); END;
