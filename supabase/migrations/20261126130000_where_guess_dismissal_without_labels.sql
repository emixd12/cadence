-- Ticket 383 (D37): a guessed Where can be dismissed while Completion places is off.
--
-- 20261024200000_completion_place_labels.sql made markers, labels and suggestion
-- dismissals require `place_label_settings.enabled`, through one trigger function shared
-- by three triggers. This replaces that function only. Markers and labels keep the check
-- unchanged. A dismissal row is admitted while labels are off only when its suggestion is
-- one a model guess can produce (`WHERE_GUESS_DISMISSAL_KEYS` in
-- packages/core/src/resolvers/place-label.resolver.ts: home, anywhere, add_place).
-- A saved-place dismissal still needs labels on, because only counted labels suggest a
-- saved place. The share lock, the error text and the error code are unchanged.
--
-- Turning labels off still deletes every dismissal (clear_place_labels_on_disable), as the
-- Settings confirmation says. A guess dismissal stored while labels are off stays until
-- the next turn-off, the Behavior's deletion or the account's deletion.
--
-- The owner approved the hosted push on November 25, 2026 (D37).

begin;

create or replace function cadence_private.require_place_labels_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hold consent through the write. An opt-out must either delete this write
  -- afterwards or complete first and make this check reject it.
  perform 1 from public.place_label_settings settings
  where settings.user_id = new.user_id and settings.enabled
  for share;
  if not found then
    -- Ticket 383: a guess's dismissal needs no labels. Nested so NEW.suggestion is read
    -- only for the dismissal table.
    if tg_table_schema = 'public' and tg_table_name = 'where_suggestion_dismissals' then
      if new.suggestion in ('home', 'anywhere', 'add_place') then
        return new;
      end if;
    end if;
    raise exception 'Completion place labels are off.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function cadence_private.require_place_labels_enabled()
  from public, anon, authenticated, service_role;

commit;
