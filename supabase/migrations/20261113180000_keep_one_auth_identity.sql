-- Ticket 334 (D31.3): an account keeps at least one sign-in identity.
--
-- Supabase Auth refuses to unlink an account's only identity, but its check does
-- not lock: two unlink requests sent at once each see the other identity and both
-- succeed, leaving none (measured: 10 of 10 trials). This trigger locks the user's
-- row, so concurrent removals for one account run one after the other, and refuses
-- the deletion of the last identity.
--
-- "Another way in" here means another row in auth.identities, whatever its provider.
-- A confirmed address can also receive sign-in codes, but only while email sign-in
-- is on (a Cadence flag and a hosted setting), so it does not count: the rule must
-- never depend on a flag that can be turned off.
--
-- Deleting the user still works: the identities cascade after the user row is gone,
-- so the lookup below finds no user and the identity is let through. Automatic
-- linking removes unconfirmed identities only after it has added the new one.
--
-- It runs as the Auth service's role, which owns both tables; the body names only
-- auth tables and built-in functions, so it needs no access to Cadence's schemas.

create or replace function cadence_private.keep_one_auth_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from auth.users where id = old.user_id for update;
  if not found then
    return old;
  end if;

  if exists (
    select 1 from auth.identities
    where user_id = old.user_id and id <> old.id
  ) then
    return old;
  end if;

  raise exception 'cadence_last_identity'
    using errcode = 'P0001',
          detail = 'An account keeps at least one sign-in identity (D31.3).';
end;
$$;

revoke all on function cadence_private.keep_one_auth_identity() from public;
revoke all on function cadence_private.keep_one_auth_identity() from anon;
revoke all on function cadence_private.keep_one_auth_identity() from authenticated;

drop trigger if exists keep_one_auth_identity on auth.identities;

create trigger keep_one_auth_identity
  before delete on auth.identities
  for each row execute function cadence_private.keep_one_auth_identity();

comment on function cadence_private.keep_one_auth_identity() is
  'Ticket 334 (D31.3): refuses deleting an account''s last auth identity; locks the user row so concurrent unlinks serialize.';
