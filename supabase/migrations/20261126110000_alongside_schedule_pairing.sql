-- Ticket 362 (docs/DECISIONS.md, 2026-11-25, D33, "Pairing the schedule"): the coach may
-- propose a lasting schedule change that puts an alongside Behavior at its host's set
-- time. It is an ordinary base schedule proposal (change_kind 'time') whose evidence has
-- source 'alongside_pairing':
--   {source, basis: 'done_together' | 'brief_yes', host_behavior_id, signal_ids,
--    yes_days, window_days}. Ids and counts only, never titles.
--
-- 1. The evidence check accepts the new source. This follows the precedent of
--    20261120160000_tips_one_tap_changes.sql (drop and re-add the named check with one
--    more value). It is the one statement here that is not plainly additive: the new
--    check accepts every row the old one did, and nothing is deleted.
-- 2. A pairing proposal is a time change and names its host (additive check).
--
-- No function changes: coach_propose_behavior_change stores the evidence object as it
-- comes, and the server validates it (validateProposeBehaviorChangeInput). Nothing reads
-- the new source while CADENCE_ALONGSIDE is off.
begin;

alter table cadence_advisor_private.behavior_change_proposals
  drop constraint behavior_change_proposals_evidence_check,
  add constraint behavior_change_proposals_evidence_check check (
    jsonb_typeof(evidence) = 'object' and evidence ? 'source'
    and evidence ->> 'source' in ('repeated_move', 'card', 'tip', 'alongside_pairing') and octet_length(evidence::text) <= 4096
  ),
  add constraint behavior_change_proposals_pairing_fields check (
    evidence ->> 'source' is distinct from 'alongside_pairing'
    or (change_kind = 'time'
      and evidence ->> 'basis' in ('done_together', 'brief_yes')
      and coalesce(evidence ->> 'host_behavior_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and evidence ->> 'host_behavior_id' <> behavior_id::text)
  );

commit;
