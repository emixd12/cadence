-- Ticket 215: optional Behavior Where, mirroring the hosted October 19, 2026
-- migration. NULL means Not set; only 'place' keeps location_text.
ALTER TABLE behaviors ADD COLUMN where_kind TEXT
  CHECK (where_kind IS NULL OR where_kind IN ('anywhere', 'home', 'place'));

-- Existing location text becomes Where = A place. No provider call happens here;
-- configuration history is not rewritten (readers derive a missing Where).
UPDATE behaviors SET where_kind = 'place' WHERE location_text IS NOT NULL;

-- SQLite cannot add a table CHECK to an existing table; triggers keep the
-- hosted invariant that only A place carries place text.
CREATE TRIGGER behaviors_where_place_text_insert BEFORE INSERT ON behaviors
WHEN (NEW.where_kind IS 'place') <> (NEW.location_text IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Behavior Where and place text disagree.'); END;

CREATE TRIGGER behaviors_where_place_text_update BEFORE UPDATE OF where_kind, location_text ON behaviors
WHEN (NEW.where_kind IS 'place') <> (NEW.location_text IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Behavior Where and place text disagree.'); END;
