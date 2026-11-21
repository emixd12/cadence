-- Sub-behaviors, Cadence Agent cascade: coach signals version 3.
--
-- The coach visit now also stores `sub_behavior_dropoff`: one step of a routine done
-- much less than the routine's other steps over the last 28 days (marks only; an
-- Unresolved step never counts as a miss). Facts hold rates, counts and the routine's
-- id only. This widens the kind list; nothing else changes.
--
-- Apply before the code that writes version 3 signals reaches production: with the old
-- list, coach_record_signals refuses the whole day's insert and the visit fails.
begin;

alter table cadence_advisor_private.coach_signals
  drop constraint coach_signals_kind_check;

alter table cadence_advisor_private.coach_signals
  add constraint coach_signals_kind_check check (kind in (
    -- Version 1 (3D).
    'completion_drop', 'repeated_move', 'late_marking', 'new_behavior_settled', 'brief_answers',
    -- Version 2 (4B).
    'weekly_numbers', 'weekday_gap', 'time_of_day_gap', 'timing_mode_gap', 'steady_behavior',
    'never_done', 'dip_recovery', 'day_shape', 'unmarked_items', 'marking_time',
    'done_together', 'crowded_hour', 'setup_gaps',
    -- Version 2, added after the owner's review (D8).
    'reminder_response', 'session_length', 'moved_vs_unmoved',
    -- Version 3: routines and their steps (sub-behaviors).
    'sub_behavior_dropoff'
  ));

commit;
