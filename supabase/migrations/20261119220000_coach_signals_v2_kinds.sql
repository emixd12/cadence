-- Advisor plan Phase 4, workstream 4B step 1: coach signals version 2.
--
-- The hourly coach visit (/api/advisor/coach/signals/process) now also stores the
-- thirteen version 2 kinds computed in
-- packages/core/src/resolvers/coach-signals-v2.ts, still with no model call. Facts
-- still hold counts, rates, times of day and ids only. This widens the kind list;
-- nothing else changes.
--
-- Apply before the code that writes version 2 signals reaches production: with the old
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
    'done_together', 'crowded_hour', 'setup_gaps'
  ));

commit;
