-- Ticket 332 (D31.2): a Cadence account has no password. Supabase Auth accepts a
-- password at sign-up and through updateUser whenever the email provider is on, and
-- has no setting that turns passwords off alone. This trigger drops any new password
-- before Auth stores it, so password sign-in fails for every real address.
--
-- Addresses on names reserved for testing (RFC 2606 and RFC 6761) keep their
-- password: the test login (`app/auth/test-login`) and the local smoke and
-- integration tests sign in that way. Nobody can receive email at those names, so
-- with email confirmation on (hosted) only a service-role caller can confirm one.
--
-- The body calls only built-in functions: it runs as the Auth service's role, which
-- has no access to Cadence's private schemas.

create or replace function cadence_private.refuse_auth_password()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  address_domain text := lower(substring(coalesce(new.email, '') from '@([^@]+)$'));
begin
  if new.encrypted_password is null or new.encrypted_password = '' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.encrypted_password is not distinct from old.encrypted_password then
    return new;
  end if;

  if address_domain in ('example.com', 'example.net', 'example.org')
     or address_domain ~ '(^|\.)(test|invalid|example|localhost)$' then
    return new;
  end if;

  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function cadence_private.refuse_auth_password() from public;
revoke all on function cadence_private.refuse_auth_password() from anon;
revoke all on function cadence_private.refuse_auth_password() from authenticated;

drop trigger if exists refuse_auth_password on auth.users;

create trigger refuse_auth_password
  before insert or update of encrypted_password on auth.users
  for each row execute function cadence_private.refuse_auth_password();

comment on function cadence_private.refuse_auth_password() is
  'Ticket 332 (D31.2): drops passwords for real addresses so email accounts sign in by link or code only.';
