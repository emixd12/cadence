-- Advisor plan, Phase 2B: read-only copies of the hosted per-day move records, received
-- through account sync contract 6. A move changes when one Occurrence happens today; it
-- never changes the Occurrence row. The Mac derives effective time from these rows with
-- the shared core helper (effectiveTimeFromMoves) and never stores it.
-- Account sync is the only writer. occurrence_id has no foreign key, as on the server:
-- a move outlives its Occurrence as history. Rows leave with their Behavior.
CREATE TABLE occurrence_moves (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL,
    behavior_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    kind TEXT NOT NULL CHECK (kind IN ('move','revert')),
    from_start_at TEXT NOT NULL,
    from_end_at TEXT NOT NULL,
    from_planned INTEGER NOT NULL CHECK (from_planned IN (0,1)),
    to_start_at TEXT NOT NULL,
    to_end_at TEXT NOT NULL,
    to_planned INTEGER NOT NULL CHECK (to_planned IN (0,1)),
    duration_source TEXT NOT NULL,
    revises_move_id TEXT,
    chain_root_id TEXT NOT NULL,
    chain_position INTEGER NOT NULL CHECK (chain_position BETWEEN 1 AND 1000),
    reason TEXT,
    source TEXT NOT NULL CHECK (source IN ('daily_brief','coach','chat','mcp','person')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    CHECK ((chain_position = 1) = (revises_move_id IS NULL)),
    FOREIGN KEY (user_id, behavior_id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX occurrence_moves_occurrence ON occurrence_moves (user_id, occurrence_id, chain_position);
