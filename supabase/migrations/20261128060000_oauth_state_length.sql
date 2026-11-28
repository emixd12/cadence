begin;

-- Ticket 381: Gemini's custom connector sends an OAuth `state` of about 1,170 characters.
-- The 1,024 limit refused its authorization request with invalid_request. The value is
-- opaque protocol data, held for 10 minutes and returned unchanged to the client.
alter table cadence_oauth_private.pending_authorizations
  drop constraint pending_authorizations_state_check,
  add constraint pending_authorizations_state_check check (length(state) <= 4096);

commit;
