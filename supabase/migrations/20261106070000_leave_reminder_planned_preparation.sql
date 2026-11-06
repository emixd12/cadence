-- Ticket 277 follow-up (decision D15). A pending leave reminder's check is the
-- leave time minus the get-ready time the plan route used. When the get-ready time
-- changes before the reminder sends, the job moves the check by the difference,
-- with no route, so the reminder fires at the new reminder time. It needs to know
-- the get-ready time the check was planned with, in whole minutes as Travel habits
-- store it (0 to 60). The row holds no leave time: the check stays the one stored
-- time. Null on rows planned before this column, whose check stays where it is.
begin;

alter table public.travel_leave_reminders
  add column planned_preparation_minutes smallint
    check (planned_preparation_minutes is null or planned_preparation_minutes between 0 and 60);

comment on column public.travel_leave_reminders.planned_preparation_minutes is
  'Ticket 277: get-ready minutes the pending check was planned with. Not synced.';

commit;
