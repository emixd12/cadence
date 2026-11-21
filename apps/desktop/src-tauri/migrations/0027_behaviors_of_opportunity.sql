-- Behaviors of Opportunity (docs/RECURRENCE_RULES.md, "Behaviors of Opportunity").
-- Same columns and checks as the hosted migration 20261121100000_behaviors_of_opportunity.
-- behaviors.is_opportunity puts a Behavior in the opportunity pool; such a Behavior may
-- have no schedules, so recurrence_rule and scheduled_time may be null. occurrences.origin
-- tells a generated row from an added one, and added_by names who added it. The schedule
-- identity covers scheduled rows only, so an added row never blocks a planned one.
-- SQLite cannot drop NOT NULL or turn a table UNIQUE into a partial index, so both tables
-- are rebuilt. The migration runner turns foreign keys off for this version and checks
-- them before commit; legacy renames keep other tables' triggers unparsed while the old
-- table is gone. Every existing row keeps its values: Behaviors are not opportunities and
-- Occurrences are scheduled.

PRAGMA legacy_alter_table = ON;

CREATE TABLE behaviors_v27 (
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    archived_at TEXT,
    browser_reminder_enabled INTEGER NOT NULL CHECK (browser_reminder_enabled IN (0,1)),
    category_id TEXT,
    created_at TEXT NOT NULL,
    current_configuration_event_id TEXT,
    description TEXT,
    email_reminder_enabled INTEGER NOT NULL CHECK (email_reminder_enabled IN (0,1)),
    id TEXT PRIMARY KEY NOT NULL,
    recurrence_rule TEXT CHECK (recurrence_rule IS NULL OR json_valid(recurrence_rule)),
    reminder_offset_minutes INTEGER NOT NULL,
    scheduled_time TEXT,
    timezone TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    archive_notes TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(archive_notes) AND json_type(archive_notes) = 'array'),
    default_duration_minutes INTEGER
        CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 1 AND 1440),
    auto_archived_at TEXT
        CHECK (auto_archived_at IS NULL OR (active = 0 AND archived_at IS NOT NULL)),
    location_text TEXT
        CHECK (location_text IS NULL OR (
            length(trim(location_text)) BETWEEN 1 AND 500
            AND location_text = trim(location_text)
        )),
    where_kind TEXT
        CHECK (where_kind IS NULL OR where_kind IN ('anywhere', 'home', 'place')),
    end_on TEXT
        CHECK (end_on IS NULL OR (
            length(end_on) = 10
            AND end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND end_on >= '0001-01-01'
            AND end_on <= '9999-12-30'
            AND date(end_on, '+0 days') = end_on
        )),
    end_time TEXT
        CHECK (end_time IS NULL OR (
            end_on IS NOT NULL
            AND length(end_time) = 8
            AND end_time GLOB '[0-2][0-9]:[0-5][0-9]:00'
            AND end_time < '24:00:00'
        )),
    pause_from_on TEXT
        CHECK (pause_from_on IS NULL OR (
            length(pause_from_on) = 10
            AND pause_from_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND pause_from_on >= '0001-01-01'
            AND date(pause_from_on, '+0 days') = pause_from_on
        )),
    pause_from_time TEXT
        CHECK (pause_from_time IS NULL OR (
            pause_from_on IS NOT NULL
            AND length(pause_from_time) = 8
            AND pause_from_time GLOB '[0-2][0-9]:[0-5][0-9]:00'
            AND pause_from_time < '24:00:00'
        )),
    pause_back_on TEXT
        CHECK (
            (pause_back_on IS NULL) = (pause_from_on IS NULL)
            AND (
                pause_back_on IS NULL OR (
                    length(pause_back_on) = 10
                    AND pause_back_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND date(pause_back_on, '+0 days') = pause_back_on
                    AND pause_back_on > pause_from_on
                )
            )
        ),
    is_opportunity INTEGER NOT NULL DEFAULT 0 CHECK (is_opportunity IN (0,1)),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id),
    FOREIGN KEY (user_id, id, current_configuration_event_id) REFERENCES behavior_configuration_events(user_id, behavior_id, id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (length(trim(title)) > 0),
    CHECK (length(trim(timezone)) > 0),
    CHECK (json_type(recurrence_rule) = 'object'),
    CHECK (is_opportunity = 1 OR (recurrence_rule IS NOT NULL AND scheduled_time IS NOT NULL))
) STRICT;

INSERT INTO behaviors_v27 (
    active, archived_at, browser_reminder_enabled, category_id, created_at,
    current_configuration_event_id, description, email_reminder_enabled, id, recurrence_rule,
    reminder_offset_minutes, scheduled_time, timezone, title, updated_at, user_id,
    archive_notes, default_duration_minutes, auto_archived_at, location_text, where_kind,
    end_on, end_time, pause_from_on, pause_from_time, pause_back_on, is_opportunity
)
SELECT
    active, archived_at, browser_reminder_enabled, category_id, created_at,
    current_configuration_event_id, description, email_reminder_enabled, id, recurrence_rule,
    reminder_offset_minutes, scheduled_time, timezone, title, updated_at, user_id,
    archive_notes, default_duration_minutes, auto_archived_at, location_text, where_kind,
    end_on, end_time, pause_from_on, pause_from_time, pause_back_on, 0
FROM behaviors;

DROP TABLE behaviors;
ALTER TABLE behaviors_v27 RENAME TO behaviors;

CREATE TRIGGER behaviors_data_revision_insert AFTER INSERT ON behaviors BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER behaviors_data_revision_update AFTER UPDATE ON behaviors WHEN OLD.active IS NOT NEW.active OR OLD.archived_at IS NOT NEW.archived_at OR OLD.browser_reminder_enabled IS NOT NEW.browser_reminder_enabled OR OLD.category_id IS NOT NEW.category_id OR OLD.created_at IS NOT NEW.created_at OR OLD.current_configuration_event_id IS NOT NEW.current_configuration_event_id OR OLD.description IS NOT NEW.description OR OLD.email_reminder_enabled IS NOT NEW.email_reminder_enabled OR OLD.id IS NOT NEW.id OR OLD.recurrence_rule IS NOT NEW.recurrence_rule OR OLD.reminder_offset_minutes IS NOT NEW.reminder_offset_minutes OR OLD.scheduled_time IS NOT NEW.scheduled_time OR OLD.timezone IS NOT NEW.timezone OR OLD.title IS NOT NEW.title OR OLD.updated_at IS NOT NEW.updated_at OR OLD.user_id IS NOT NEW.user_id OR OLD.is_opportunity IS NOT NEW.is_opportunity BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER behaviors_data_revision_delete AFTER DELETE ON behaviors BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id; END;
CREATE TRIGGER behaviors_where_place_text_insert BEFORE INSERT ON behaviors
WHEN (NEW.where_kind IS 'place') <> (NEW.location_text IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Behavior Where and place text disagree.'); END;
CREATE TRIGGER behaviors_where_place_text_update BEFORE UPDATE OF where_kind, location_text ON behaviors
WHEN (NEW.where_kind IS 'place') <> (NEW.location_text IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Behavior Where and place text disagree.'); END;

CREATE TABLE occurrences_v27 (
    behavior_configuration_event_id TEXT,
    behavior_id TEXT NOT NULL,
    behavior_schedule_slot_id TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    id TEXT PRIMARY KEY NOT NULL,
    local_date TEXT NOT NULL,
    note TEXT,
    schedule_end_time TEXT,
    schedule_kind TEXT NOT NULL,
    schedule_preset TEXT,
    schedule_range_identity INTEGER GENERATED ALWAYS AS (CASE WHEN schedule_kind = 'exact' THEN -1 ELSE (CAST(substr(schedule_end_time,1,2) AS INTEGER)*3600 + CAST(substr(schedule_end_time,4,2) AS INTEGER)*60 + CAST(substr(schedule_end_time,7,2) AS INTEGER))*1000000 + CAST(substr(substr(coalesce(schedule_end_time,''),10) || '000000',1,6) AS INTEGER) END) STORED,
    schedule_start_time TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL,
    status_marked_at TEXT,
    updated_at TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    origin TEXT NOT NULL DEFAULT 'scheduled' CHECK (origin IN ('scheduled', 'opportunity')),
    added_by TEXT CHECK (added_by IS NULL OR added_by IN ('user', 'daily_brief', 'chat', 'mcp')),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, behavior_id) REFERENCES behaviors(user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (behavior_schedule_slot_id) REFERENCES behavior_schedule_slots(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id, behavior_id, behavior_schedule_slot_id) REFERENCES behavior_schedule_slots(user_id, behavior_id, id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (user_id, behavior_id, behavior_configuration_event_id) REFERENCES behavior_configuration_events(user_id, behavior_id, id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (user_id, id, behavior_id),
    CHECK (status IN ('unresolved','completed','not_completed')),
    CHECK (schedule_kind IN ('exact','range')),
    CHECK (schedule_preset IS NULL OR schedule_preset IN ('morning','afternoon','evening','night')),
    CHECK ((schedule_kind = 'exact' AND schedule_preset IS NULL AND schedule_end_time IS NULL) OR (schedule_kind = 'range' AND schedule_end_time IS NOT NULL AND schedule_start_time <> schedule_end_time)),
    CHECK ((origin = 'opportunity') = (added_by IS NOT NULL))
) STRICT;

INSERT INTO occurrences_v27 (
    behavior_configuration_event_id, behavior_id, behavior_schedule_slot_id, completed_at,
    created_at, id, local_date, note, schedule_end_time, schedule_kind, schedule_preset,
    schedule_start_time, scheduled_for, status, status_marked_at, updated_at, user_id,
    origin, added_by
)
SELECT
    behavior_configuration_event_id, behavior_id, behavior_schedule_slot_id, completed_at,
    created_at, id, local_date, note, schedule_end_time, schedule_kind, schedule_preset,
    schedule_start_time, scheduled_for, status, status_marked_at, updated_at, user_id,
    'scheduled', NULL
FROM occurrences;

DROP TABLE occurrences;
ALTER TABLE occurrences_v27 RENAME TO occurrences;

CREATE INDEX occurrences_owner_date ON occurrences (user_id, local_date, scheduled_for, id);
CREATE UNIQUE INDEX occurrences_schedule_identity_key
    ON occurrences (behavior_id, local_date, schedule_start_time, schedule_range_identity)
    WHERE origin = 'scheduled';

CREATE TRIGGER occurrences_data_revision_insert AFTER INSERT ON occurrences BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER occurrences_data_revision_update AFTER UPDATE ON occurrences WHEN OLD.behavior_configuration_event_id IS NOT NEW.behavior_configuration_event_id OR OLD.behavior_id IS NOT NEW.behavior_id OR OLD.behavior_schedule_slot_id IS NOT NEW.behavior_schedule_slot_id OR OLD.completed_at IS NOT NEW.completed_at OR OLD.created_at IS NOT NEW.created_at OR OLD.id IS NOT NEW.id OR OLD.local_date IS NOT NEW.local_date OR OLD.note IS NOT NEW.note OR OLD.schedule_end_time IS NOT NEW.schedule_end_time OR OLD.schedule_kind IS NOT NEW.schedule_kind OR OLD.schedule_preset IS NOT NEW.schedule_preset OR OLD.schedule_start_time IS NOT NEW.schedule_start_time OR OLD.scheduled_for IS NOT NEW.scheduled_for OR OLD.status IS NOT NEW.status OR OLD.status_marked_at IS NOT NEW.status_marked_at OR OLD.updated_at IS NOT NEW.updated_at OR OLD.user_id IS NOT NEW.user_id OR OLD.origin IS NOT NEW.origin OR OLD.added_by IS NOT NEW.added_by BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER occurrences_data_revision_delete AFTER DELETE ON occurrences BEGIN UPDATE local_data_revision SET revision=revision+1 WHERE user_id=OLD.user_id; END;

-- An opportunity row keeps the origin and source it was added with.
CREATE TRIGGER occurrences_origin_immutable BEFORE UPDATE OF origin, added_by ON occurrences
WHEN OLD.origin IS NOT NEW.origin OR OLD.added_by IS NOT NEW.added_by
BEGIN SELECT RAISE(ABORT, 'An Occurrence keeps its origin.'); END;

PRAGMA legacy_alter_table = OFF;
