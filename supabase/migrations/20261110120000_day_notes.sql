-- Ticket 292: day notes.
--
-- One note per calendar date in the user's timezone. A day note has no status,
-- no Behavior and no Occurrence; it never changes adherence, Needs decision or
-- reminders. Clearing keeps the row with a null note, so synchronization never
-- needs a tombstone. Ownership is bound to auth.uid(); clients cannot write the
-- table directly.
begin;

create table public.day_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  note text,
  revision integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint day_notes_user_date_key unique (user_id, local_date),
  constraint day_notes_user_id_key unique (user_id, id),
  constraint day_notes_note_valid check (
    note is null or (btrim(note) <> '' and char_length(note) <= 2000)
  ),
  constraint day_notes_revision_valid check (revision between 1 and 2147483647)
);

alter table public.day_notes enable row level security;
create policy day_notes_select_own
  on public.day_notes for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.day_notes from public, anon, authenticated, service_role;
grant select on table public.day_notes to authenticated;

-- Compare-and-set on the note text, like Occurrence notes. A first save expects a
-- null note. Returns no row when the stored note differs from expected_note.
create function public.save_day_note(
  target_local_date date,
  expected_note text,
  next_note text
)
returns setof public.day_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  stored public.day_notes;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if target_local_date is null then
    raise exception 'Choose a valid day for this note.' using errcode = '22023';
  end if;
  if next_note is not null and (btrim(next_note) = '' or char_length(next_note) > 2000) then
    raise exception 'The day note is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':day_note:' || target_local_date::text, 0)
  );
  select * into stored
  from public.day_notes day_note
  where day_note.user_id = owner_id and day_note.local_date = target_local_date
  for update;

  if not found then
    if expected_note is not null then
      return;
    end if;
    if next_note is null then
      return;
    end if;
    insert into public.day_notes (user_id, local_date, note)
    values (owner_id, target_local_date, next_note)
    returning * into stored;
    return next stored;
    return;
  end if;

  if stored.note is distinct from expected_note then
    return;
  end if;
  if stored.note is not distinct from next_note then
    return next stored;
    return;
  end if;

  update public.day_notes day_note set
    note = next_note,
    revision = day_note.revision + 1,
    updated_at = statement_timestamp()
  where day_note.user_id = owner_id and day_note.id = stored.id
  returning * into stored;
  return next stored;
end;
$$;

revoke all on function public.save_day_note(date, text, text)
  from public, anon, service_role;
grant execute on function public.save_day_note(date, text, text) to authenticated;

commit;
