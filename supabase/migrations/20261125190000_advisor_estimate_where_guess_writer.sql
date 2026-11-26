-- Where guess writer (Ticket 359, docs/DECISIONS.md, 2026-11-25, D33).
--
-- Ticket 357 added behavior_advisor_estimates.where_guess and left it unwritten. With
-- CADENCE_ALONGSIDE on, the Daily Brief's estimate call (estimate recipe 1.3) now also
-- returns a coarse Where guess per Behavior: home, anywhere, elsewhere or unknown. This
-- replaces upsert_behavior_advisor_estimates so it stores that guess.
--
-- Rules:
--   - Each item may carry where_guess. A value outside the four allowed values, or no
--     key at all, stores null. It is never a place name, a coordinate or a place key.
--   - The ON CONFLICT update always sets where_guess from the new item, so a guess made
--     under an earlier input_hash never survives a new estimate. With the flag off the
--     caller sends no where_guess key, and the row stores null, as before this change.
--
-- Additive (docs/DECISIONS.md, 2026-11-10): `create or replace` keeps the function's
-- signature (p_estimates jsonb, returns integer), its security definer, empty
-- search_path, the Daily Brief agent check, the 100-item limit and every existing column
-- it writes. No grant, table or policy changes; its existing grants carry over.
begin;

create or replace function public.upsert_behavior_advisor_estimates(p_estimates jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_count integer;
begin
  if jsonb_typeof(p_estimates) is distinct from 'array' or jsonb_array_length(p_estimates) > 100 then
    raise exception 'advisor_estimate_invalid_input' using errcode = '22023';
  end if;
  insert into public.behavior_advisor_estimates (user_id, behavior_id, input_hash, duration_minutes, alongside, where_guess, model, updated_at)
  select v_user_id, b.id, item ->> 'input_hash', nullif(item ->> 'duration_minutes', '')::integer,
    coalesce((item ->> 'alongside')::boolean, false),
    case when item ->> 'where_guess' in ('home', 'anywhere', 'elsewhere', 'unknown') then item ->> 'where_guess' end,
    nullif(item ->> 'model', ''), now()
  from jsonb_array_elements(p_estimates) item
  join public.behaviors b on b.user_id = v_user_id and b.id = (item ->> 'behavior_id')::uuid
  on conflict (user_id, behavior_id) do update
    set input_hash = excluded.input_hash, duration_minutes = excluded.duration_minutes,
        alongside = excluded.alongside, where_guess = excluded.where_guess,
        model = excluded.model, updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on column public.behavior_advisor_estimates.where_guess is
  'The model''s coarse Where guess: home, anywhere, elsewhere or unknown. Never a place name, coordinate or place key. Planning only. Written by upsert_behavior_advisor_estimates (Ticket 359); null when the estimate did not ask.';

commit;
