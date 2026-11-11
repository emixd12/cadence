-- Ticket 320 (D28): read-only copies of the hosted connector completion records,
-- received through account sync contract 5. Only the fields a Mac shows are kept:
-- no routine digests, account digest, activity reference or status event references.
-- Account sync is the only writer. Rows leave with their Behavior or Occurrence, as
-- the hosted rows do.
CREATE TABLE behavior_source_links (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    behavior_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('hevy')),
    selector_kind TEXT NOT NULL CHECK (selector_kind IN ('any','provider_keys')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, behavior_id, source),
    FOREIGN KEY (user_id, behavior_id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE occurrence_source_matches (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL,
    behavior_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('hevy')),
    activity_start_at TEXT NOT NULL,
    activity_end_at TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('completion','attached')),
    state TEXT NOT NULL CHECK (state IN ('active','removed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, occurrence_id, behavior_id) REFERENCES occurrences(user_id, id, behavior_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX occurrence_source_matches_occurrence ON occurrence_source_matches (user_id, occurrence_id);
