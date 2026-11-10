-- Ticket 292: day notes. Mirrors hosted 20261110120000_day_notes.sql.
-- One note per calendar date. Clearing keeps the row with a NULL note, so account
-- sync never needs a day-note tombstone.
CREATE TABLE day_notes (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL CHECK (length(local_date) = 10 AND local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    note TEXT CHECK (note IS NULL OR (trim(note) <> '' AND length(note) <= 2000)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483647),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, local_date)
) STRICT;
