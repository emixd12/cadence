-- Advisor plan Phase 4, workstream 4B (decision D3): what each advisor agent cost per account
-- per month, from the run log. Read-only, aggregate, owner use. Counts and money only.
--
-- Run with a service-role connection:
--   psql "$DATABASE_URL" -v months=3 -f scripts/advisor-cost-report.sql
--
-- Cost is agent_runs.cost_microdollars (settled from the provider's reported tokens, or the
-- reservation when none was reported). Months are calendar months of each run's local date.
--   1. Per agent and month: accounts, runs, model calls, total, mean and 95th percentile per account.
--   2. Per agent, model and month: the same, for comparing models.
--   3. Accounts that reached 80% or more of an agent's share in a month.
-- Use 1 and 3 to decide whether to rebalance (scripts/advisor-budget-rebalance.sql).

\if :{?months}
\else
  \set months 3
\endif

begin transaction read only;

\echo '1. Cost per account, by agent and month (US$)'
with per_account as (
  select date_trunc('month', r.local_date)::date as month, r.agent, r.user_id,
         count(*) as runs, sum(r.model_calls) as model_calls, sum(r.cost_microdollars) as cost
  from cadence_advisor_private.agent_runs r
  where r.local_date >= (date_trunc('month', current_date) - make_interval(months => :months - 1))::date
  group by 1, 2, 3
)
select month, agent,
       count(*) as accounts,
       sum(runs) as runs,
       sum(model_calls) as model_calls,
       round(sum(cost) / 1000000.0, 4) as total_usd,
       round(avg(cost) / 1000000.0, 4) as mean_per_account_usd,
       round((percentile_cont(0.95) within group (order by cost))::numeric / 1000000.0, 4) as p95_per_account_usd,
       round(max(cost) / 1000000.0, 4) as max_per_account_usd
from per_account
group by month, agent
order by month desc, agent;

\echo '2. Cost per account, by agent, model and month (US$)'
with per_account as (
  select date_trunc('month', r.local_date)::date as month, r.agent, coalesce(r.model, 'none') as model, r.user_id,
         sum(r.model_calls) as model_calls, sum(r.cost_microdollars) as cost
  from cadence_advisor_private.agent_runs r
  where r.local_date >= (date_trunc('month', current_date) - make_interval(months => :months - 1))::date
  group by 1, 2, 3, 4
)
select month, agent, model,
       count(*) as accounts,
       sum(model_calls) as model_calls,
       round(sum(cost) / 1000000.0, 4) as total_usd,
       round(avg(cost) / 1000000.0, 4) as mean_per_account_usd,
       round((percentile_cont(0.95) within group (order by cost))::numeric / 1000000.0, 4) as p95_per_account_usd
from per_account
group by month, agent, model
order by month desc, agent, model;

\echo '3. Accounts at 80% or more of a share (counts only)'
with per_account as (
  select date_trunc('month', r.local_date)::date as month, r.agent, r.user_id, sum(r.cost_microdollars) as cost
  from cadence_advisor_private.agent_runs r
  where r.local_date >= (date_trunc('month', current_date) - make_interval(months => :months - 1))::date
  group by 1, 2, 3
)
select p.month, p.agent,
       count(*) filter (where p.cost >= 0.8 * coalesce(o.monthly_microdollars, s.monthly_microdollars)) as at_80_percent,
       count(*) filter (where p.cost >= coalesce(o.monthly_microdollars, s.monthly_microdollars)) as at_100_percent,
       round(s.monthly_microdollars / 1000000.0, 2) as share_usd
from per_account p
join cadence_advisor_private.agent_budget_shares s on s.agent = p.agent
left join cadence_advisor_private.agent_budget_account_overrides o on o.user_id = p.user_id and o.agent = p.agent
group by p.month, p.agent, s.monthly_microdollars
order by p.month desc, p.agent;

commit;
