-- Ticket 335 (D31.5): Google Calendar and the Google sign-in it reads through.
--
-- 1. Removing a Google sign-in while a Calendar connect finished at the same moment could
--    leave Calendar connected with no Google sign-in (8 of 40 local trials): Cadence checked
--    Calendar before the unlink, and calendar_install_credential checked the identity
--    without a lock. Both now take the lock keep_one_auth_identity takes, the account's
--    auth.users row, so they run one after the other:
--    - calendar_install_credential locks the row, then checks the identity;
--    - keep_one_auth_identity also refuses deleting a Google identity that a connected
--      Calendar row uses (`cadence_calendar_connected`).
--    Lock order is the same on both paths: an identity row (only on delete), then the user
--    row, then the Calendar row. Install never locks an identity row.
-- 2. A Calendar row without a credential keeps the Google subject of its first connect.
--    calendar_begin_attempt now moves such a row to the identity it was given, which it
--    has already checked is the account's own Google identity. A connected row never moves.
--
-- keep_one_auth_identity becomes security definer, because the trigger runs as the Auth
-- service's role, which cannot read public.google_calendar_connections. Its owner is the
-- migration role, as before. No grant changes: the calendar_* functions keep theirs
-- (create or replace keeps grants), and the trigger function stays revoked from public,
-- anon and authenticated.

begin;

create or replace function cadence_private.keep_one_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from auth.users where id = old.user_id for update;
  -- Deleting the user: its identities cascade after the user row is gone.
  if not found then
    return old;
  end if;

  if not exists (
    select 1 from auth.identities
    where user_id = old.user_id and id <> old.id
  ) then
    raise exception 'cadence_last_identity'
      using errcode = 'P0001',
            detail = 'An account keeps at least one sign-in identity (D31.3).';
  end if;

  if old.provider = 'google' and exists (
    select 1 from public.google_calendar_connections
    where user_id = old.user_id and google_subject = old.provider_id and status = 'connected'
  ) then
    raise exception 'cadence_calendar_connected'
      using errcode = 'P0001',
            detail = 'Google Calendar reads through this Google sign-in; disconnect it first (D31.5).';
  end if;

  return old;
end;
$$;

revoke all on function cadence_private.keep_one_auth_identity() from public;
revoke all on function cadence_private.keep_one_auth_identity() from anon;
revoke all on function cadence_private.keep_one_auth_identity() from authenticated;

comment on function cadence_private.keep_one_auth_identity() is
  'Tickets 334 and 335: refuses deleting an account''s last auth identity, and a Google identity a connected Calendar uses; locks the user row so unlinks and Calendar installs serialize.';

create or replace function public.calendar_install_credential(owner_id uuid, expected_subject text, expected_generation bigint, expected_state_hash text, token_ciphertext text) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from auth.users where id=owner_id for update;
 if not exists (select 1 from auth.identities where user_id=owner_id and provider='google' and provider_id=expected_subject) then return false; end if;
 update public.google_calendar_connections set generation=generation+1,status='connected',attempt_hash=null
 where user_id=owner_id and google_subject=expected_subject and generation=expected_generation and attempt_hash=expected_state_hash;
 if not found then return false; end if;
 insert into cadence_calendar_private.credentials values(owner_id,expected_subject,expected_generation+1,token_ciphertext)
 on conflict(user_id) do update set google_subject=excluded.google_subject,generation=excluded.generation,sealed_token=excluded.sealed_token;
 return true;
end $$;

create or replace function public.calendar_begin_attempt(owner_id uuid, expected_subject text, state_digest text, verifier_ciphertext text, expected_generation bigint, return_target text, client_nonce text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_generation bigint;
begin
 if not exists (select 1 from auth.identities where user_id=owner_id and provider='google' and provider_id=expected_subject) then raise exception 'calendar_identity_mismatch'; end if;
 insert into public.google_calendar_connections(user_id,google_subject) values(owner_id,expected_subject)
 on conflict(user_id) do update set google_subject=excluded.google_subject where public.google_calendar_connections.status <> 'connected';
 select generation into current_generation from public.google_calendar_connections where user_id=owner_id and google_subject=expected_subject for update;
 if current_generation is null then raise exception 'calendar_identity_mismatch'; end if;
 if current_generation <> expected_generation then raise exception 'calendar_connection_changed'; end if;
 if return_target='desktop' and client_nonce !~ '^[a-zA-Z0-9_-]{32,128}$' then raise exception 'invalid_calendar_state'; end if;
 update public.google_calendar_connections set attempt_hash=state_digest where user_id=owner_id;
 insert into public.google_calendar_preferences(user_id) values(owner_id) on conflict do nothing;
 delete from cadence_calendar_private.attempts where user_id=owner_id or expires_at < clock_timestamp();
 insert into cadence_calendar_private.attempts values(state_digest,owner_id,expected_subject,current_generation,verifier_ciphertext,return_target,client_nonce,clock_timestamp()+interval '5 minutes');
 return current_generation;
end $$;

commit;
