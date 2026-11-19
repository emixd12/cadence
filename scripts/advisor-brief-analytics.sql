-- Advisor Phase 3 (3A2): Daily Brief move analytics. Read-only, aggregate, owner use.
--
-- Run with a service-role connection (it reads every account):
--   psql "$DATABASE_URL" -v days=28 -f scripts/advisor-brief-analytics.sql
--
-- It prints counts and rates only: no titles, no notes, no times. Behaviors appear by id
-- (the per-Behavior table) so a reviewer can look one up when a single Behavior is
-- declined far more than the rest. Every query reads only the last :days local days.
--
--   1. Acceptance by reason: how each kind of suggestion is answered.
--   2. Acceptance by Behavior: the Behaviors most often declined.
--   3. Undo within 10 minutes of Yes: a Yes the person regretted at once.
--   4. Moved, then completed: brief-moved items against items never moved.
--   5. Moves per account per week, by who made the move.

\if :{?days}
\else
  \set days 28
\endif

begin transaction read only;

-- 1. Acceptance by reason ------------------------------------------------------------
-- Decided = the person answered. Superseded (a refresh replaced it), withdrawn (the day
-- changed under it) and still-open lines are left out. An Undo still counts as a Yes here;
-- query 3 reports Undo on its own.
select
  coalesce(p.reason, 'none') as reason,
  count(*) filter (where p.status not in ('proposed', 'superseded', 'withdrawn')) as decided,
  count(*) filter (where p.status in ('accepted', 'undone')) as yes,
  count(*) filter (where p.status = 'other_time') as other_time,
  count(*) filter (where p.status = 'already_done') as already_done,
  count(*) filter (where p.status = 'declined') as no,
  count(*) filter (where p.status = 'undone') as undone,
  round(100.0 * count(*) filter (where p.status in ('accepted', 'undone', 'other_time'))
    / nullif(count(*) filter (where p.status not in ('proposed', 'superseded', 'withdrawn')), 0), 1) as moved_pct,
  count(*) filter (where p.status = 'proposed') as unanswered,
  count(*) filter (where p.status = 'superseded') as superseded_by_refresh
from public.move_proposals as p
where p.source = 'daily_brief'
  and p.local_date >= current_date - :days
group by 1
order by decided desc;

-- 2. Acceptance by Behavior (most declined first; Behaviors with 3+ decided lines) ---------
select
  p.behavior_id,
  count(*) filter (where p.status not in ('proposed', 'superseded', 'withdrawn')) as decided,
  count(*) filter (where p.status = 'declined') as no,
  round(100.0 * count(*) filter (where p.status = 'declined')
    / nullif(count(*) filter (where p.status not in ('proposed', 'superseded', 'withdrawn')), 0), 1) as declined_pct,
  exists (
    select 1 from public.move_proposal_answers as a
    where a.behavior_id = p.behavior_id and a.kind = 'never_move' and a.outcome = 'applied'
  ) as set_never_move
from public.move_proposals as p
where p.source = 'daily_brief'
  and p.local_date >= current_date - :days
group by p.behavior_id
having count(*) filter (where p.status not in ('proposed', 'superseded', 'withdrawn')) >= 3
order by declined_pct desc, decided desc
limit 25;

-- 3. Undo within 10 minutes of Yes ------------------------------------------------------
with yes as (
  select a.proposal_id, min(a.created_at) as at
  from public.move_proposal_answers as a
  where a.kind in ('yes', 'accept_all') and a.outcome = 'applied' and a.source = 'person'
    and a.local_date >= current_date - :days
  group by a.proposal_id
), undo as (
  select a.proposal_id, min(a.created_at) as at
  from public.move_proposal_answers as a
  where a.kind in ('undo', 'undo_all') and a.outcome = 'applied'
    and a.local_date >= current_date - :days
  group by a.proposal_id
)
select
  count(*) as yes_answers,
  count(undo.proposal_id) filter (where undo.at - yes.at <= interval '10 minutes') as undone_within_10_min,
  count(undo.proposal_id) filter (where undo.at - yes.at > interval '10 minutes') as undone_later,
  round(100.0 * count(undo.proposal_id) filter (where undo.at - yes.at <= interval '10 minutes') / nullif(count(*), 0), 1) as undone_within_10_min_pct
from yes
left join undo on undo.proposal_id = yes.proposal_id;

-- 4. Moved, then completed ------------------------------------------------------------
-- An item counts as moved by the brief when its latest move today came from a brief line
-- (a later Undo puts it back, so it counts as unmoved). Only finished days count.
with latest as (
  select distinct on (m.occurrence_id) m.occurrence_id, m.kind, m.source, m.proposal_id
  from public.occurrence_moves as m
  where m.local_date >= current_date - :days
  order by m.occurrence_id, m.created_at desc, m.chain_position desc
), grouped as (
  select
    case
      when latest.kind = 'move' and latest.proposal_id is not null then 'moved_by_brief'
      when latest.kind = 'move' then 'moved_other'
      else 'not_moved'
    end as bucket,
    o.status
  from public.occurrences as o
  left join latest on latest.occurrence_id = o.id
  where o.local_date >= current_date - :days
    and o.local_date < current_date - 1
)
select
  bucket,
  count(*) as items,
  count(*) filter (where status = 'completed') as completed,
  round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 1) as completed_pct
from grouped
group by bucket
order by bucket;

-- 5. Moves per account per week, by who made them ------------------------------------------
with weekly as (
  select m.user_id, date_trunc('week', m.local_date)::date as week, m.source, count(*) as moves
  from public.occurrence_moves as m
  where m.kind = 'move' and m.local_date >= current_date - :days
  group by 1, 2, 3
)
select
  source,
  count(distinct user_id) as accounts,
  round(avg(moves), 2) as mean_per_account_week,
  percentile_cont(0.5) within group (order by moves) as median_per_account_week,
  percentile_cont(0.9) within group (order by moves) as p90_per_account_week
from weekly
group by source
order by source;

rollback;
