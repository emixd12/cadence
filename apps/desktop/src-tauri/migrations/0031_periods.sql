-- Ticket 374 (D35): Periods. Mirrors hosted 20261126130000_periods.sql.
-- A Period is a labeled range of local dates for the whole account. It is annotation
-- only: nothing here changes a status, a reminder or a schedule. Removing a Period
-- deletes the row; account sync reads the deletion from the saved baseline.
-- The cap of 500 Periods is enforced by the local store commands, as the hosted
-- trigger enforces it for hosted writers.
CREATE TABLE periods (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (
        label = trim(label) AND length(label) BETWEEN 1 AND 60
        AND instr(label, char(10)) = 0 AND instr(label, char(13)) = 0
    ),
    start_on TEXT NOT NULL CHECK (length(start_on) = 10 AND start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_on TEXT CHECK (end_on IS NULL OR (length(end_on) = 10 AND end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    note TEXT CHECK (note IS NULL OR (trim(note) <> '' AND length(note) <= 2000)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483647),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    CHECK (end_on IS NULL OR end_on >= start_on)
) STRICT;
CREATE INDEX periods_user_start_idx ON periods (user_id, start_on);
