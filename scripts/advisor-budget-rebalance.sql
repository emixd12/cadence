-- Advisor plan Phase 4, workstream 4B (decision D3): move money between the advisor agents'
-- monthly shares without changing the account total (US$5.00 today).
--
-- Run with a service-role connection, amounts in US dollars per account per month:
--   psql "$DATABASE_URL" -v brief=0.50 -v coach=1.00 -v chat=3.50 -f scripts/advisor-budget-rebalance.sql
--
-- The three shares must add up to the current monthly total, or nothing changes. Add
-- -v total=6.00 to change the total in the same step (an owner decision). A change on the
-- hosted database needs the owner's go-ahead; record it in docs/COSTS.md's change log.
-- Read the monthly cost report first: psql "$DATABASE_URL" -f scripts/advisor-cost-report.sql

\set ON_ERROR_STOP on
\if :{?brief}
\else
  \echo 'Missing -v brief=<dollars>'
  \quit
\endif
\if :{?coach}
\else
  \echo 'Missing -v coach=<dollars>'
  \quit
\endif
\if :{?chat}
\else
  \echo 'Missing -v chat=<dollars>'
  \quit
\endif
\if :{?total}
\else
  \set total ''
\endif

begin;

select set_config('advisor_budget.brief', :'brief', true),
       set_config('advisor_budget.coach', :'coach', true),
       set_config('advisor_budget.chat', :'chat', true),
       set_config('advisor_budget.total', :'total', true) \gset

do $$
declare
  v_brief bigint := round(current_setting('advisor_budget.brief')::numeric * 1000000);
  v_coach bigint := round(current_setting('advisor_budget.coach')::numeric * 1000000);
  v_chat bigint := round(current_setting('advisor_budget.chat')::numeric * 1000000);
  v_total bigint;
begin
  if nullif(current_setting('advisor_budget.total'), '') is not null then
    v_total := round(current_setting('advisor_budget.total')::numeric * 1000000);
    update cadence_advisor_private.agent_budget_settings set monthly_total_microdollars = v_total, updated_at = now();
  else
    select monthly_total_microdollars into strict v_total from cadence_advisor_private.agent_budget_settings;
  end if;
  if least(v_brief, v_coach, v_chat) < 0 then
    raise exception 'Shares cannot be negative.';
  end if;
  if v_brief + v_coach + v_chat <> v_total then
    raise exception 'Shares add up to US$% but the monthly total is US$%. Nothing changed.',
      round((v_brief + v_coach + v_chat) / 1000000.0, 2), round(v_total / 1000000.0, 2);
  end if;
  update cadence_advisor_private.agent_budget_shares set monthly_microdollars = v_brief, updated_at = now() where agent = 'daily_brief';
  update cadence_advisor_private.agent_budget_shares set monthly_microdollars = v_coach, updated_at = now() where agent = 'coach';
  update cadence_advisor_private.agent_budget_shares set monthly_microdollars = v_chat, updated_at = now() where agent = 'chat';
end;
$$;

select agent, round(monthly_microdollars / 1000000.0, 2) as monthly_usd, protected
from cadence_advisor_private.agent_budget_shares order by agent;
select round(monthly_total_microdollars / 1000000.0, 2) as monthly_total_usd from cadence_advisor_private.agent_budget_settings;

commit;
