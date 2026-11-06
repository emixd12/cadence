-- Ticket 276 (decision D3): the leave reminder job acts as one user with a
-- minted token and no session. Its Supabase client has no Auth user, but the
-- Calendar service compares the connection's Google subject with the user's
-- Google identity. This function is the smallest read that answers that: it
-- returns the caller's own Google provider id, or null unless exactly one
-- Google identity exists. Only the leave reminder token channel may call it.
-- It reads no other identity field and no other account.
begin;

create function public.leave_reminder_google_subject()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  subjects text[];
begin
  if actor_id is null
    or coalesce(auth.jwt() ->> 'cadence_channel', '') <> 'leave_reminder'
  then
    raise exception 'leave_reminder_token_required' using errcode = '42501';
  end if;

  select array_agg(identity.provider_id) into subjects
  from auth.identities as identity
  where identity.user_id = actor_id and identity.provider = 'google';

  if coalesce(array_length(subjects, 1), 0) <> 1 then
    return null;
  end if;
  return subjects[1];
end;
$$;

revoke all on function public.leave_reminder_google_subject() from public, anon, authenticated, service_role;
grant execute on function public.leave_reminder_google_subject() to authenticated;

comment on function public.leave_reminder_google_subject() is
  'Ticket 276: returns the calling user''s single Google provider id for the leave reminder job''s minted token. Other tokens are refused.';

commit;
