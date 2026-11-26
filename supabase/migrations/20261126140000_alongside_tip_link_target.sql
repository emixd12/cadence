-- Ticket 385 (D37): a tip's link may open a Behavior's alongside control.
--
-- The advice card `do-it-during-something-else` offers a link that opens the Behavior
-- form on "Can be done alongside other things". Its link target is `alongside`, which the
-- `coach_tips.link_target` check from 20261120160000_tips_one_tap_changes.sql does not
-- allow. This replaces that one check with the same list plus 'alongside', the technique
-- 20261120160000 used for the behavior_change_proposals checks (drop, then add under the
-- same name). Nothing else changes: no function, grant, row or other column.
--
-- Approval: this is a check-constraint replacement, not an additive migration, so the
-- standing approval for additive migrations (docs/DECISIONS.md, 2026-11-10) does not
-- cover it. The hosted push waits for the owner's yes.
--
-- Order: this must be on the database before the card is activated (status 'active').
-- While the card is a draft no code path writes link_target = 'alongside'.
-- Existing rows stay valid: the new list contains every old value.

begin;

alter table cadence_advisor_private.coach_tips
  drop constraint coach_tips_link_target_check,
  add constraint coach_tips_link_target_check check (link_target in (
    'time', 'length', 'where', 'description', 'behavior', 'unmarked', 'behaviors', 'alongside'
  ));

commit;
