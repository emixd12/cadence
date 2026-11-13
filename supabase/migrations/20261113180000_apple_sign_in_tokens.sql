-- Ticket 333 (D31.2, L-025): Apple's refresh token, sealed by the server, so account
-- deletion can revoke Cadence's Sign in with Apple authorization. Supabase Auth hands
-- the token to the sign-in callback once and does not keep it. The row goes with the
-- Auth user; account deletion reads it first.
begin;

create table cadence_calendar_private.apple_sign_in_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_digest text not null check (subject_digest ~ '^[a-f0-9]{64}$'),
  sealed_refresh_token text not null check (length(sealed_refresh_token) <= 32768),
  updated_at timestamptz not null default now(),
  primary key (user_id, subject_digest)
);
alter table cadence_calendar_private.apple_sign_in_tokens enable row level security;
revoke all on cadence_calendar_private.apple_sign_in_tokens from public, anon, authenticated;

-- The newest sign-in's token replaces the one kept for the same Apple identity.
create function public.apple_sign_in_keep_token(owner_id uuid, apple_subject_digest text, token_ciphertext text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.identities i where i.user_id = owner_id and i.provider = 'apple') then
    raise exception 'apple_identity_required';
  end if;
  insert into cadence_calendar_private.apple_sign_in_tokens (user_id, subject_digest, sealed_refresh_token)
    values (owner_id, apple_subject_digest, token_ciphertext)
    on conflict (user_id, subject_digest) do update
      set sealed_refresh_token = excluded.sealed_refresh_token, updated_at = now();
end $$;

create function public.apple_sign_in_read_tokens(owner_id uuid)
returns table (subject_digest text, sealed_refresh_token text)
language sql stable security definer set search_path = '' as $$
  select t.subject_digest, t.sealed_refresh_token
  from cadence_calendar_private.apple_sign_in_tokens t
  where t.user_id = owner_id
$$;

revoke all on function public.apple_sign_in_keep_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.apple_sign_in_read_tokens(uuid) from public, anon, authenticated;
grant execute on function public.apple_sign_in_keep_token(uuid, text, text) to service_role;
grant execute on function public.apple_sign_in_read_tokens(uuid) to service_role;

commit;
