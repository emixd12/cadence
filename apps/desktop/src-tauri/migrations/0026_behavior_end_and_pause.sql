-- Ended and Paused Behaviors (docs/RECURRENCE_RULES.md, "Behavior end and pause").
-- A Behavior never archives by itself any more. end_date was the first local day it no
-- longer ran; end_on is the last local day it runs, with an optional end_time. A pause
-- runs from pause_from_on (at pause_from_time, or the start of that day) until the start
-- of pause_back_on. All five are local values, never instants: the run state is worked
-- out from them and the Behavior's timezone (packages/core/src/resolvers/behavior-run.resolver.ts).
-- Same columns and checks as the hosted migration 20261120120000_behavior_end_and_pause.
-- Backfill (rule T9): end_on = end_date - 1, no time. auto_archived_at stays for Behaviors
-- the retired job already archived; nothing sets it any more.

ALTER TABLE behaviors ADD COLUMN end_on TEXT
CHECK (
  end_on IS NULL OR (
    length(end_on) = 10
    AND end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND end_on >= '0001-01-01'
    AND end_on <= '9999-12-30'
    AND date(end_on, '+0 days') = end_on
  )
);

ALTER TABLE behaviors ADD COLUMN end_time TEXT
CHECK (
  end_time IS NULL OR (
    end_on IS NOT NULL
    AND length(end_time) = 8
    AND end_time GLOB '[0-2][0-9]:[0-5][0-9]:00'
    AND end_time < '24:00:00'
  )
);

ALTER TABLE behaviors ADD COLUMN pause_from_on TEXT
CHECK (
  pause_from_on IS NULL OR (
    length(pause_from_on) = 10
    AND pause_from_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND pause_from_on >= '0001-01-01'
    AND date(pause_from_on, '+0 days') = pause_from_on
  )
);

ALTER TABLE behaviors ADD COLUMN pause_from_time TEXT
CHECK (
  pause_from_time IS NULL OR (
    pause_from_on IS NOT NULL
    AND length(pause_from_time) = 8
    AND pause_from_time GLOB '[0-2][0-9]:[0-5][0-9]:00'
    AND pause_from_time < '24:00:00'
  )
);

ALTER TABLE behaviors ADD COLUMN pause_back_on TEXT
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
);

UPDATE behaviors
SET end_on = date(end_date, '-1 day')
WHERE end_date IS NOT NULL AND end_date > '0001-01-01';

ALTER TABLE behaviors DROP COLUMN end_date;
