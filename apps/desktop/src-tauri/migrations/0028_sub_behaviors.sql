-- Sub-behaviors, one level deep (hosted migration 20261122010000_sub_behaviors).
-- A sub-behavior names its parent Behavior. It follows the parent's schedule when
-- inherit_parent_schedule is 1 and keeps a stored copy of it. A parent is never itself a
-- sub-behavior, and a Behavior is never its own parent. An opportunity Behavior is never a
-- parent or a sub-behavior (hosted 20261122020000). Existing rows become standalone.

ALTER TABLE behaviors ADD COLUMN parent_behavior_id TEXT
REFERENCES behaviors(id) ON DELETE SET NULL
CHECK (parent_behavior_id IS NULL OR parent_behavior_id <> id);

ALTER TABLE behaviors ADD COLUMN sub_behavior_sort_order INTEGER NOT NULL DEFAULT 0
CHECK (sub_behavior_sort_order >= 0);

ALTER TABLE behaviors ADD COLUMN inherit_parent_schedule INTEGER NOT NULL DEFAULT 0
CHECK (inherit_parent_schedule IN (0, 1) AND (parent_behavior_id IS NOT NULL OR inherit_parent_schedule = 0));

CREATE INDEX behaviors_parent_behavior_idx ON behaviors(user_id, parent_behavior_id)
WHERE parent_behavior_id IS NOT NULL;

-- The foreign key sets the link to NULL; clear the inherit flag first so the row check holds.
CREATE TRIGGER behaviors_sub_behavior_parent_delete BEFORE DELETE ON behaviors
BEGIN
  UPDATE behaviors SET parent_behavior_id = NULL, inherit_parent_schedule = 0, sub_behavior_sort_order = 0
  WHERE parent_behavior_id = OLD.id;
END;

CREATE TRIGGER behaviors_sub_behavior_depth_insert BEFORE INSERT ON behaviors
WHEN NEW.parent_behavior_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A Behavior cannot be its own parent.')
  WHERE NEW.parent_behavior_id = NEW.id;
  SELECT RAISE(ABORT, 'An opportunity Behavior can''t be part of a routine.')
  WHERE NEW.is_opportunity = 1 OR EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.is_opportunity = 1
  );
  SELECT RAISE(ABORT, 'A sub-behavior cannot have sub-behaviors.')
  WHERE EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.parent_behavior_id IS NOT NULL
  );
  SELECT RAISE(ABORT, 'A sub-behavior parent belongs to another profile.')
  WHERE EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.user_id <> NEW.user_id
  );
END;

CREATE TRIGGER behaviors_sub_behavior_depth_update BEFORE UPDATE OF parent_behavior_id, user_id ON behaviors
WHEN NEW.parent_behavior_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A Behavior cannot be its own parent.')
  WHERE NEW.parent_behavior_id = NEW.id;
  SELECT RAISE(ABORT, 'An opportunity Behavior can''t be part of a routine.')
  WHERE NEW.is_opportunity = 1 OR EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.is_opportunity = 1
  );
  SELECT RAISE(ABORT, 'A sub-behavior cannot have sub-behaviors.')
  WHERE EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.parent_behavior_id IS NOT NULL
  );
  SELECT RAISE(ABORT, 'A Behavior with sub-behaviors cannot become a sub-behavior.')
  WHERE EXISTS (SELECT 1 FROM behaviors child WHERE child.parent_behavior_id = NEW.id);
  SELECT RAISE(ABORT, 'A sub-behavior parent belongs to another profile.')
  WHERE EXISTS (
    SELECT 1 FROM behaviors parent
    WHERE parent.id = NEW.parent_behavior_id AND parent.user_id <> NEW.user_id
  );
END;

-- A parent with sub-behaviors cannot gain a parent through an insert either: an insert is a
-- new id, so no row can name it yet. The update trigger covers every other path.

-- Turning a Behavior into an opportunity: it must not be in a routine, as a step or a parent.
CREATE TRIGGER behaviors_sub_behavior_opportunity_update BEFORE UPDATE OF is_opportunity ON behaviors
WHEN NEW.is_opportunity = 1
BEGIN
  SELECT RAISE(ABORT, 'An opportunity Behavior can''t be part of a routine.')
  WHERE NEW.parent_behavior_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM behaviors child WHERE child.parent_behavior_id = NEW.id);
END;
