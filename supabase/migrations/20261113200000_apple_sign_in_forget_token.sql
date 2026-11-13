-- Ticket 334 (D31.3, L-025): removing Apple as a sign-in method forgets the Apple
-- refresh token kept for that Apple identity (Ticket 333). The server revokes the
-- token at Apple first; the row goes whether or not Apple answers, because the
-- identity is no longer on the account. Owner approval for service_role grants on
-- the Apple token functions: November 13, 2026, 18:18Z.
begin;

create function public.apple_sign_in_forget_token(owner_id uuid, apple_subject_digest text)
returns void language sql security definer set search_path = '' as $$
  delete from cadence_calendar_private.apple_sign_in_tokens t
  where t.user_id = owner_id and t.subject_digest = apple_subject_digest
$$;

revoke all on function public.apple_sign_in_forget_token(uuid, text) from public, anon, authenticated;
grant execute on function public.apple_sign_in_forget_token(uuid, text) to service_role;

commit;
