-- Effective Where: storage for the model's coarse Where guess (Ticket 357,
-- docs/DECISIONS.md, 2026-11-25, D33).
--
-- behavior_advisor_estimates.where_guess holds the estimate call's guess of where a
-- Behavior happens: home, anywhere, elsewhere or unknown. Never a place name, a
-- coordinate or a place key. Null: no guess. Readers use it only while the row's
-- input_hash is current, and only when the person has not set Where and completion
-- place labels show no clear majority (effective-where.resolver.ts). A guessed Where is
-- for planning only: it never requests a route, a departure line or a leave reminder.
--
-- Ticket 357 adds the column and its read path only. Nothing writes it yet: the
-- upsert function is unchanged, so every row stays null until Ticket 359 makes the
-- estimate call return the guess and stores it.
--
-- Additive (docs/DECISIONS.md, 2026-11-10): one nullable column with a check, no data
-- writes, no grants. The table keeps its select-only grant to authenticated and its
-- owner-only RLS policy.
begin;

alter table public.behavior_advisor_estimates
  add column where_guess text
    constraint behavior_advisor_estimates_where_guess_valid
    check (where_guess is null or where_guess in ('home', 'anywhere', 'elsewhere', 'unknown'));

comment on column public.behavior_advisor_estimates.where_guess is
  'The model''s coarse Where guess: home, anywhere, elsewhere or unknown. Never a place name, coordinate or place key. Planning only (Ticket 357).';

commit;
