-- Advisor Phase 3A1 follow-up: re-check when the brief opens.
--
-- POST /api/advisor/brief/recheck re-plans an undecided brief line whose time is now
-- taken. When nothing else fits today the line closes as 'withdrawn', so the next
-- re-check finds nothing to do. Only the Daily Brief's own agent token may close a
-- line, only its own person's, and only one still 'proposed'. Additive: one function.

begin;

create function public.withdraw_brief_move_proposal(p_proposal_id uuid)
returns public.move_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_row public.move_proposals;
begin
  if p_proposal_id is null then
    raise exception 'move_proposal_invalid_input' using errcode = '22023';
  end if;
  update public.move_proposals p
  set status = 'withdrawn', status_changed_at = now()
  where p.user_id = v_user_id and p.id = p_proposal_id and p.source = 'daily_brief' and p.status = 'proposed'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.move_proposals p
    where p.user_id = v_user_id and p.id = p_proposal_id and p.source = 'daily_brief';
    if v_row.id is null then
      raise exception 'move_proposal_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end $$;

revoke all on function public.withdraw_brief_move_proposal(uuid) from public, anon, service_role;
grant execute on function public.withdraw_brief_move_proposal(uuid) to authenticated;

commit;
