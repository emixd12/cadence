-- Ticket 216: completion place labels, device-recorded place markers and Where
-- suggestion dismissals. Mirrors hosted 20261022160000_completion_place_labels.sql.
-- Deletions on opt-out and on leaving Completed run in the store commands, not in
-- triggers, so account sync can apply each deletion exactly once.
CREATE TABLE place_label_settings (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL DEFAULT 'place_labels' CHECK (id = 'place_labels'),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    retention TEXT NOT NULL DEFAULT '90_days' CHECK (retention IN ('90_days','1_year','until_deleted')),
    enabled_at TEXT,
    marker_prompt_dismissed_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK (enabled = 0 OR enabled_at IS NOT NULL)
) STRICT;

CREATE TABLE place_markers (
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    place_key TEXT NOT NULL CHECK (length(place_key) = 43 AND place_key NOT GLOB '*[^A-Za-z0-9_-]*'),
    latitude_e6 INTEGER NOT NULL CHECK (latitude_e6 BETWEEN -90000000 AND 90000000),
    longitude_e6 INTEGER NOT NULL CHECK (longitude_e6 BETWEEN -180000000 AND 180000000),
    accuracy_meters INTEGER NOT NULL CHECK (accuracy_meters BETWEEN 0 AND 100),
    rule_version TEXT NOT NULL CHECK (rule_version IN ('place-label-rules@1')),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    CHECK (id = 'home' OR id = 'saved_place:' || place_key)
) STRICT;

-- One label per completed occurrence; the label ID is the occurrence ID.
CREATE TABLE completion_place_labels (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    behavior_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    label TEXT NOT NULL CHECK (label IN ('home','elsewhere') OR (
        substr(label, 1, 12) = 'saved_place:' AND length(label) = 55
        AND substr(label, 13) NOT GLOB '*[^A-Za-z0-9_-]*'
    )),
    rule_version TEXT NOT NULL CHECK (rule_version IN ('place-label-rules@1')),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, id) REFERENCES occurrences(user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, behavior_id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX completion_place_labels_user_behavior_date_idx
    ON completion_place_labels(user_id, behavior_id, local_date);

-- One dismissal per Behavior; the dismissal ID is the Behavior ID.
CREATE TABLE where_suggestion_dismissals (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    suggestion TEXT NOT NULL CHECK (suggestion IN ('home','anywhere','add_place') OR (
        substr(suggestion, 1, 12) = 'saved_place:' AND length(suggestion) = 55
        AND substr(suggestion, 13) NOT GLOB '*[^A-Za-z0-9_-]*'
    )),
    rule_version TEXT NOT NULL CHECK (rule_version IN ('where-suggestion-rules@1')),
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE
) STRICT;

-- Markers, labels and dismissals exist only while labels are on.
CREATE TRIGGER place_markers_require_enabled BEFORE INSERT ON place_markers
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;
CREATE TRIGGER place_markers_require_enabled_update BEFORE UPDATE ON place_markers
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;
CREATE TRIGGER where_suggestion_dismissals_require_enabled BEFORE INSERT ON where_suggestion_dismissals
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;
CREATE TRIGGER where_suggestion_dismissals_require_enabled_update BEFORE UPDATE ON where_suggestion_dismissals
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
BEGIN SELECT RAISE(ABORT, 'Completion place labels are off.'); END;

-- A label needs labels on and a Completed occurrence of the same Behavior and local date.
CREATE TRIGGER completion_place_labels_require_completed BEFORE INSERT ON completion_place_labels
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
  OR NOT EXISTS (
    SELECT 1 FROM occurrences WHERE user_id = NEW.user_id AND id = NEW.id
      AND behavior_id = NEW.behavior_id AND local_date = NEW.local_date AND status = 'completed'
  )
BEGIN SELECT RAISE(ABORT, 'A place label needs labels on and a Completed occurrence.'); END;
CREATE TRIGGER completion_place_labels_require_completed_update BEFORE UPDATE ON completion_place_labels
WHEN NOT EXISTS (SELECT 1 FROM place_label_settings WHERE user_id = NEW.user_id AND enabled = 1)
  OR NOT EXISTS (
    SELECT 1 FROM occurrences WHERE user_id = NEW.user_id AND id = NEW.id
      AND behavior_id = NEW.behavior_id AND local_date = NEW.local_date AND status = 'completed'
  )
BEGIN SELECT RAISE(ABORT, 'A place label needs labels on and a Completed occurrence.'); END;

-- First-link and import planning detect local changes through the domain revision.
CREATE TRIGGER place_label_settings_data_revision_insert AFTER INSERT ON place_label_settings BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER place_label_settings_data_revision_update AFTER UPDATE ON place_label_settings BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER place_label_settings_data_revision_delete AFTER DELETE ON place_label_settings BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER place_markers_data_revision_insert AFTER INSERT ON place_markers BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER place_markers_data_revision_update AFTER UPDATE ON place_markers BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER place_markers_data_revision_delete AFTER DELETE ON place_markers BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER completion_place_labels_data_revision_insert AFTER INSERT ON completion_place_labels BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER completion_place_labels_data_revision_delete AFTER DELETE ON completion_place_labels BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER where_suggestion_dismissals_data_revision_insert AFTER INSERT ON where_suggestion_dismissals BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER where_suggestion_dismissals_data_revision_update AFTER UPDATE ON where_suggestion_dismissals BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER where_suggestion_dismissals_data_revision_delete AFTER DELETE ON where_suggestion_dismissals BEGIN
    UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
