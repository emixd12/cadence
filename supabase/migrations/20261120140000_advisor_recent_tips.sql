-- Advisor plan Phase 4, workstream 4E: the panel's "Earlier" list.
--
-- The advisor panel shows the tips of the last few days that were shown before today,
-- newest first, with the reaction each got. The signed-in person only (web session or
-- the Mac's bearer token), never an agent or grant. Read only; no table changes.
--
-- Owner approval needed before production (new function).
begin;

-- Shown tips from the person's local today minus p_days up to yesterday, newest first,
-- at most p_limit. Same shape per tip as advisor_next_tip: [{id, local_date, text, ...}].
create function public.advisor_recent_tips(p_days integer default 7, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_advisor_private.require_person();
  v_today date;
begin
  if p_days is null or p_days < 1 or p_days > 60 or p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception 'tip_invalid_input' using errcode = '22023';
  end if;
  select (statement_timestamp() at time zone profile.timezone)::date into v_today
  from public.profiles as profile where profile.id = v_user_id;
  if v_today is null then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(cadence_advisor_private.tip_json(recent) order by recent.local_date desc, recent.position desc)
    from (
      select tip.* from cadence_advisor_private.coach_tips as tip
      where tip.user_id = v_user_id and tip.shown_at is not null
        and tip.local_date < v_today and tip.local_date >= v_today - p_days
      order by tip.local_date desc, tip.position desc
      limit p_limit
    ) as recent
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.advisor_recent_tips(integer, integer) from public, anon, service_role;
grant execute on function public.advisor_recent_tips(integer, integer) to authenticated;

commit;
