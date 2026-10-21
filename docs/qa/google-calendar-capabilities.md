# Google Calendar capability verification

Verified from official Google and Supabase documentation on 2026-09-16.
The initial research changed no provider configuration. Authorized setup on
2026-09-16 created Calendar-only project `cadence-calendar-498717` and enabled
`calendar-json.googleapis.com`. Later dated checkpoints in this file record OAuth
setup, deployed and installed acceptance, verified branding, and the September 18
data-access submission. Google still reports that submission under review.
`STATUS.md` is the current ledger.

## Result

The September 16 research found Ticket 134 feasible with one server-owned Google
OAuth connection shared by web and desktop. Cadence requires separate Calendar
consent after Cadence sign-in because the Supabase session does not grant Calendar
API access. The implementation later adopted this architecture. Dated sections
below distinguish the original recommendation from source, live, installed,
deployed, and provider-review evidence.

Use these scopes:

- `openid`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

The two Calendar scopes are the narrowest documented combination that can list subscribed calendars and read their events.
Do not request `calendar`, `calendar.readonly`, Drive, or any write scope.
See [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

Use a separate Google Cloud project for the Calendar connector.
Keep the existing Supabase Google sign-in project isolated.
Google revocation removes every OAuth scope granted to a project and invalidates tokens for every client in that project.
A separate project lets Calendar disconnect revoke Calendar access without revoking the Sign in with Google grant.

Both clients should call one Cadence server connector.
The server owns Google client credentials, the refresh token, token refresh, identity checks, pagination, and response adaptation.
Desktop stores only its existing Supabase session and a short-lived connection attempt state in Keychain.
Desktop never receives a Google access token, refresh token, or Google client secret.

## Current Cadence boundary

The web login route requests ordinary Google sign-in through Supabase.
It supplies no Calendar scope, offline-access parameter, or consent parameter.
The callback exchanges the Supabase PKCE code and discards provider-token fields.
See `app/auth/google/route.ts:31-36` and `app/auth/callback/route.ts:41-54`.

Supabase can return `provider_token` and `provider_refresh_token` when extra scopes and Google offline-access parameters are requested.
Supabase does not store or refresh provider tokens.
The current login path therefore cannot supply durable Calendar access without substantial credential handling changes.
The [Supabase Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google) and [social-login token guide](https://supabase.com/docs/guides/auth/social-login#provider-tokens) document this limit.

Cadence already reads the authenticated Supabase user with `auth.getUser()`.
The returned Google identity exposes its provider account ID.
Supabase documents `provider_id` as the OAuth provider's account identifier.
See `lib/auth/current-user.ts:18-28` and the [Supabase identity object](https://supabase.com/docs/guides/auth/identities#the-user-identity-object).

Desktop uses Supabase PKCE with `cadence://auth/callback`.
It validates callback origin, state, and a five-minute lifetime.
It consumes pending state before code exchange.
See `apps/desktop/src/account/auth.ts:71-86` and `apps/desktop/src/account/auth.ts:165-187`.

Desktop stores the Supabase session, PKCE verifier, and pending state in fixed Keychain entries.
The Rust boundary rejects unknown key names.
The native implementation uses the non-synchronizing Data Protection Keychain with `AfterFirstUnlockThisDeviceOnly`.
See `apps/desktop/src/account/auth.ts:30-55`, `apps/desktop/src-tauri/src/auth.rs:6-20`, and `apps/desktop/src-tauri/native/auth.m:10-61`.

Desktop records only the Supabase user ID, email, and authentication time in SQLite.
The current account record does not retain the Google provider subject.
The server must derive the expected Google subject from the authenticated Supabase identity.
Desktop must not treat its stored email as an identity key.

The current native backup command copies the full `cadence.sqlite3` database.
An event cache inside that database would enter user backups and protected account-disconnect backups.
See `apps/desktop/src-tauri/src/files.rs:117-153` and `apps/desktop/src-tauri/src/local_store/db.rs:292-324`.

## Verified provider capabilities

### Consent and identity binding

Google supports incremental authorization with `include_granted_scopes=true`.
Google returns a refresh token for server-side offline access when the request uses `access_type=offline`.
Google may only return the refresh token on the first qualifying consent.
Reconnect should use `prompt=consent` and replace a returned refresh token atomically.
See the [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

The proposed Calendar project is separate from the Supabase sign-in project.
Its request is feature-time consent, not an extension of the existing Supabase Google grant.
`include_granted_scopes=true` preserves prior scopes granted within the Calendar project only.

Google accepts either an email or a Google `sub` value as `login_hint`.
Cadence should send the expected Google `sub` to reduce wrong-account selection.
The callback must still compare identities.
Hints do not authorize an account.

Google documents `sub` as unique across Google Accounts and never reused.
Google advises using `sub`, not email, as the stable account identifier.
See the [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference) and [Sign in with Google practices](https://developers.google.com/identity/siwg/best-practices).

The connector callback must obtain the new grant's Google subject through verified OpenID Connect output.
It must compare that subject with the signed-in user's Supabase Google `provider_id`.
It must reject a mismatch before saving a connection or changing local data.
It must discard the unsaved token, show a same-account error, and link to Google's account grant-management page.
It must not revoke the mismatched grant automatically.
A revoke affects the entire Calendar project and could disconnect another Cadence account or device using that Google identity.
Offer revoke only as explicit cleanup after disclosing that project-wide effect.

The callback must verify that Google granted both Calendar scopes.
Google can return fewer scopes than requested.
Partial consent cannot produce a connected state.

### Calendar discovery

`calendarList.list` returns the calendars subscribed by the user.
It supports `maxResults` up to 250 and continues with `nextPageToken`.
It returns identifiers, labels, colors, selected/hidden state, primary state, timezone, and effective access role.
See [CalendarList: list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) and the [CalendarList resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList).

Request `showHidden=true` so Settings can show the complete subscribed list.
Request `minAccessRole=reader` because free/busy-only calendars cannot supply the requested rich details.
Default selection should use the primary calendar plus entries Google marks selected.
The user remains able to change the selection before events appear.

### Bounded event reads

For every selected calendar, call `events.list` with:

- `timeMin` equal to the first displayed day's local start instant.
- `timeMax` equal to the local start instant after the last displayed day.
- `singleEvents=true`.
- `showDeleted=true`.
- `orderBy=startTime`.
- `timeZone` equal to the Cadence profile timezone.
- `maxResults=2500`.
- `maxAttendees=100`.
- A partial-response `fields` selection containing only the adapter fields and page token.

Derive `timeMin` and `timeMax` from local dates with the project's Temporal boundary rules.
Do not parse `YYYY-MM-DD` with JavaScript `Date`.

Google defines `timeMin` as an exclusive lower bound on event end.
Google defines `timeMax` as an exclusive upper bound on event start.
Using both returns events that intersect the half-open display range, including overnight and multi-day events.
See [Events: list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

One event page can contain fewer rows than requested while another page remains.
Only an absent `nextPageToken` proves completion.
The default page size is 250 and the maximum is 2,500.

`singleEvents=true` expands recurring series into concrete instances.
Moved exceptions carry `recurringEventId` and `originalStartTime`.
Cancelled instances arrive with `status=cancelled` when `showDeleted=true`.
See [recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents) and [Calendar events and calendars](https://developers.google.com/workspace/calendar/api/concepts/events-calendars).

Do not use Calendar sync tokens for this cache.
Google forbids combining a sync token with `timeMin` or `timeMax`.
A complete bounded read is smaller and easier to reconcile correctly.

Google can return rate limits as 403 or 429.
Treat both the same.
Use capped exponential backoff with jitter and a finite retry count.
See [Calendar API errors](https://developers.google.com/workspace/calendar/api/guides/errors) and [usage limits](https://developers.google.com/workspace/calendar/api/guides/quota).

## Provider field matrix

The typed adapter must validate every consumed field and reject malformed required data.
It must ignore unknown optional provider fields so Google can add fields without breaking reads.
It must not pass a raw Google object into shared core or UI code.
All optional values remain nullable.
Null never means an empty value was supplied.

| Cadence field | Google source | Verified coverage | Required adapter rule |
|---|---|---|---|
| Source identity | Calendar ID plus event `id` | Event IDs are opaque and scoped to a calendar | Use a composite cache ID. Never key by title or email. |
| Logical instance | `iCalUID`, `originalStartTime`, start | `iCalUID` is shared by recurring instances | Derive a separate presentation-deduplication key. Keep the composite source ID. |
| Title | `summary` | Optional or hidden by access restrictions | Use an empty normalized string with an explicit `restricted` or `not_provided` reason. UI may show a factual unavailable-details label. |
| Description | `description` | Optional; Google says it can contain HTML | Sanitize on the server. Never render or cache unsanitized HTML. |
| Timed start/end | `start.dateTime`, `end.dateTime`, time zones | RFC 3339; event end is exclusive | Preserve instants and provider timezone. Derive duration only when the end is meaningful. |
| All-day start/end | `start.date`, `end.date` | End date is exclusive | Preserve date-only meaning. Never convert it to a midnight timed event. |
| Unspecified end | `endTimeUnspecified` | Google still supplies a compatibility end | Mark duration unavailable. Do not claim the compatibility end as known duration. |
| Availability | `transparency` | `opaque` blocks time and is Google's default; `transparent` does not block time | Map to busy/free. Apply the documented default only to a valid resource where the field was requested; restricted, deliberately omitted, or unrecognized values remain unknown. This does not grant permission to rearrange the event. |
| Location | `location` | Optional free text | Store as text. Do not auto-link arbitrary location content. |
| Google source URL | `htmlLink` | Read-only event link | Accept only a valid HTTPS URL. Open through the user's browser. |
| Organizer | `organizer.displayName`, `email`, `self` | Optional or hidden | Preserve available values. Do not infer organizer from attendees. |
| Attendees | `attendees[]`, `attendeesOmitted` | Names, email, response, optional/resource/organizer/self flags may be present. `maxAttendees` bounds the response; Google can then return only the participant. | Request at most 100. Preserve `attendeesOmitted`. Mark attendee detail `provider_omitted` when true. Do not slice an apparently complete provider list locally. |
| Conference | `conferenceData.conferenceSolution`, `entryPoints[]`, `notes`; fallback `hangoutLink` | Google permits at most one video, SIP, and more entry point, but zero or more phone entry points. It documents no total maximum. | Sanitize notes. Validate each URI by its documented scheme. Bound normalized entry points to 10 and mark detail `client_truncated` if more arrived. Display access codes only when supplied. |
| Recurrence | `recurringEventId`, `originalStartTime`; concrete start/end | Expanded instances and moved exceptions are supported | Store series ID and original start. Do not expose provider recurrence rules for expanded display. |
| Cancellation | `status=cancelled` | Cancelled instances are available with `showDeleted=true` | Treat as a reconciliation tombstone. Do not render as a live event. |
| Attachments | `attachments[].title`, `mimeType`, `fileUrl` | Google permits at most 25 attachments per event | Preserve all returned attachments. Validate HTTPS URLs. Do not download, preview, probe, or call Drive automatically. No Drive scope is required to surface returned links. |
| Visibility/detail restriction | Calendar `accessRole`, event `visibility`, omitted fields | Reader access can hide private-event details | Carry field-level absence reasons. Do not invent title, attendee, or location data. |

The provider-neutral external event should add these safe fields to Ticket 132's base contract.
This research sketch is not the final enum contract. Ticket 134 must reconcile
it with `docs/EXTERNAL_EVENT_CONTRACT.md`, including unsupported and unknown
field states, before publishing schema/types and mapping fixtures:

```ts
type ExternalEventField =
  | "title"
  | "description"
  | "location"
  | "source_url"
  | "organizer"
  | "attendees"
  | "conference"
  | "recurrence"
  | "attachments";

type ExternalEventFieldAvailability = Partial<
  Record<
    ExternalEventField,
    "not_provided" | "restricted" | "provider_omitted"
  >
>;

type ExternalEventDetailCompleteness = Partial<
  Record<
    "attendees" | "conference_entry_points" | "attachments",
    "complete" | "provider_omitted" | "client_truncated" | "restricted"
  >
>;
```

Use typed organizer, attendee, conference-entry-point, recurrence-instance, and attachment arrays.
Use a timed/all-day start union.
Derive `detailsTruncated` from any `provider_omitted` or `client_truncated` completeness value.
Do not use a bare `detailsTruncated` flag without field-specific completeness.
The adapter must sanitize description and conference notes before constructing this type.
The adapter must validate every source, conference, and attachment URI before constructing this type.

### Duplicate handling

Cache each provider copy under `(connection, calendarId, event.id)`.
Do not collapse records by `event.id` alone.

For presentation, derive a logical instance key from `iCalUID` plus `originalStartTime` or concrete start.
When selected calendars contain the same logical instance, choose one display copy deterministically.
Prefer primary calendar, then the user's self copy, then Settings selection order.
Retain source aliases so a later refresh can reconcile every calendar copy.
Do not collapse a row when `iCalUID` is absent.

## Selected research architecture, 2026-09-16

### OAuth and server broker

Use a separate Google Cloud project and one confidential web OAuth client for the Calendar connector.
Register only HTTPS callback URLs owned by Cadence.
Do not ship its client secret in the web bundle or desktop app.

The authorization request should use:

- Authorization Code flow with PKCE.
- A random 256-bit state.
- A five-minute attempt lifetime.
- `access_type=offline`.
- `include_granted_scopes=true`.
- `prompt=consent`.
- `login_hint` set to the expected Google `sub`.
- The three scopes listed above.

Because the connector uses its own Google project, incremental consent applies only to prior grants in that connector project.

The state record must bind the attempt to the Cadence user ID, expected Google subject, PKCE verifier, return target, and expiry.
Consume the state before code exchange.
Never log the code, verifier, token response, subject, calendar IDs, event IDs, or event content.

The web callback returns to Settings.
The desktop attempt also uses the HTTPS server callback.
After success, the server redirects to a new opaque desktop deep link such as `cadence://calendar/callback`.
The deep link must carry only result state, never a Google or Supabase token.
Desktop should validate its pending state and then read connection status through the authenticated server API.

Keep Google access tokens ephemeral in server memory.
Persist only the refresh token needed for later reads.
Seal the refresh token with authenticated encryption under a versioned server-only key.
Store the sealed value in a private hosted credential table keyed to `user_id`.
Keep safe connection status and calendar selections in separate owner-scoped tables with RLS.

The credential table and OAuth-attempt table must remain outside exposed Data API schemas.
Exact server repository functions may access them.
Every operation must prove the requesting Supabase user, expected Google subject, and row owner before use.
Do not expose a function that returns a decrypted provider token to `authenticated`, `anon`, or desktop clients.

This boundary needs a focused security review before migration work.
The review must reconcile the repository's ordinary RLS rule with the callback's server-only credential write.
The simplest acceptable implementation is an exact server-only repository, not a general service-role data client.

Supabase changed new-table Data API exposure behavior in 2026.
Any new public connection or selection table needs explicit grants and RLS.
See the [Supabase changelog](https://supabase.com/changelog?types=breaking-change) and `docs/SUPABASE_WORKFLOW.md`.

### API and service ownership

The research proposed these server-owned paths for Ticket 134. Later checkpoints
record their implementation and acceptance:

- A protected connection-start action for web.
- `POST /api/google-calendar/connection` for a desktop authorization URL.
- `GET /auth/google-calendar/callback` for Google's HTTPS callback.
- `GET /api/google-calendar/connection` for status.
- `DELETE /api/google-calendar/connection` for global disconnect.
- `GET /api/google-calendar/calendars` for the complete calendar list.
- `PUT /api/google-calendar/calendars` for selected IDs and visibility.
- `GET /api/google-calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD` for one bounded, complete typed snapshot.

Web requests use the existing cookie-backed Supabase client.
Desktop requests use its Supabase access token as a bearer credential.
The server must call Supabase `auth.getUser(token)` before using any connector row.
Do not trust desktop-provided user IDs, emails, or provider subjects.

`lib/services/google-calendar.service.ts` owns consent, identity binding, lifecycle, refresh coalescing, complete provider reads, and typed responses.
`lib/db/` owns connection, selection, state, and credential records.
A small provider adapter owns Google requests and raw response validation.
`apps/desktop/src/calendar/google-calendar.ts` owns desktop request coordination and cache adaptation.
Native Rust owns the separate cache database and atomic replace/clear commands only.

Do not add a service account, domain-wide delegation, webhook, watch channel, background helper, or Calendar write path.

## Desktop cache custody

Create a separate owner-only `calendar-cache.sqlite3` beside `cadence.sqlite3`.
Do not add Google event tables to `cadence.sqlite3`.
The existing backup and restore commands must continue to copy only `cadence.sqlite3`.
Release backup scripts and protected account-disconnect backups must also exclude `calendar-cache.sqlite3`.

Every cache row must include the hosted Supabase user ID.
The cache must never be readable in account-free local mode.
It must contain only selected calendar metadata, sanitized typed events, and freshness receipts.
It must contain no Google token, OAuth code, PKCE verifier, Cadence session, raw provider payload, or account-sync baseline.

Apply a successful refresh in one native transaction:

1. Verify the hosted account ID, selected calendar set, requested date range, and response completeness.
2. Upsert the complete sanitized event snapshot.
3. Apply cancellation tombstones.
4. Delete prior rows in the covered range that are absent from the complete response.
5. Evict rows outside the currently displayed range.
6. Write the successful range, selection revision, and `last_refreshed_at` receipt.
7. Commit once.

Do not call the native replace command until every page from every selected calendar succeeds.
An interrupted or failed refresh keeps the previous complete snapshot.
It may update a non-content attempt/error receipt, but it must not advance `last_refreshed_at`.

The UI may report Calendar empty only when a successful receipt covers the requested range and current selection.
Use these distinct states:

- Not connected.
- Not loaded.
- Refreshing.
- Current.
- Stale, showing last refreshed data.
- Refresh failed, showing last refreshed data.
- Reconnect required.

## Refresh policy

One refresh coordinator per client must coalesce Timeline and Settings requests by account, selection revision, timezone, and date range.
One in-flight request serves every matching caller.

- On connect: load every calendar-list page, let the user confirm selection, then fetch the displayed range.
- On Timeline or Settings open: refresh when no complete receipt exists, the requested range changed, the selection changed, or the last success is at least 15 minutes old.
- On desktop resume or visibility return: refresh once when visible and the last success is at least 15 minutes old.
- While visible: schedule at most one refresh at the next 15-minute freshness boundary. Cancel the timer while hidden or minimized.
- Manual refresh: start immediately unless a matching request is already running. Do not start parallel work.
- After local midnight or Show more days: request the new exact displayed range and atomically replace coverage.

Back off 403/429 and transient 5xx responses with jitter.
Stop after a small finite retry budget.
Honor `Retry-After` when present.
Never fetch on current-time-dot animation, hover, preview open, or each event row.

## Settings and lifecycle

Web and desktop Settings need the same account-bound states and actions:

- Connect Google Calendar.
- Connected Google identity.
- Reconnect required.
- Selected subscribed calendars.
- Per-calendar visible state.
- Global Calendar context visibility.
- Global all-day-event visibility.
- Last successful refresh and current freshness state.
- Refresh now.
- Disconnect Google Calendar.

Account-free desktop mode shows Calendar as unavailable and leaves local tracking unchanged.
Calendar consent denial returns to disconnected state without changing Cadence data.
A wrong Google account returns a specific same-account error without changing the Cadence session.
Wrong-account cleanup discards the unsaved token.
It does not revoke the project grant unless the user explicitly chooses cleanup after seeing the cross-account and cross-device effect.

Disconnect is global for the Cadence account.
The server must revoke the Google refresh token, delete the credential, connection, and selection records, and stop new refreshes.
The current desktop clears its cache immediately.
Other desktops clear their cache on their next open, resume, manual refresh, or connector response.
No webhook is required.

Google documents that revocation invalidates all OAuth scopes and tokens for the Google Cloud project.
This is why the Calendar project must remain separate from Supabase sign-in.
See the [Google token revocation section](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).

Web sign-out clears the Cadence session but leaves the account's global Calendar connection available after the next Cadence sign-in.
Web has no persistent event cache to clear.
Desktop Cadence sign-out or account disconnect clears the current Mac's Calendar cache and pending Calendar state.
It does not revoke the global Calendar grant.

Google `invalid_grant` or repeated 401 after one token refresh marks the connection revoked.
The server deletes the unusable credential and returns `reconnect_required`.
Each client then clears its event cache.
Calendar selections may be retained only as non-content reconnect preferences.

Account deletion should attempt Google revocation before deleting the credential.
A provider outage must not prevent Cadence account deletion.
If revocation fails, delete the local credential and tell the user in advance that Google Account settings may still show the stale grant.
Never retain the token after Cadence account deletion for a later retry.

External calendar events, selections, connection records, and credentials stay outside BehaviorLog exports, JSON/CSV exports, Markdown exports, desktop account-sync snapshots, and ordinary Cadence backups.
The desktop cache file is disposable and must not enter restore input.

The phrase "no tokens in backups" is achievable for every Cadence-generated export and desktop backup.
Durable hosted credentials can still exist as sealed ciphertext in the hosting provider's infrastructure backups.
Privacy and operations docs must state the actual hosted retention model before release.
If the requirement intends to ban even encrypted infrastructure backup retention, Cadence needs a separate non-backed credential store before implementation.

## Exact implementation gates

Ticket 132 owner approval is complete. Ticket 134 implementation still requires
all of these changes in one reviewed slice:

- Add the Google OAuth routes and bearer-authenticated desktop API boundary to `docs/ROUTE_MAP.md`.
- Add provider setup, secret rotation, revocation, outage, and deletion procedures to `docs/OPERATIONS.md`.
- Add owner-scoped hosted connection, selection, OAuth-attempt, and private credential contracts to `docs/DATA_MODEL.md`.
- Add the separate cache file, schema, atomic commands, and backup exclusions to `docs/DESKTOP_DATA_MODEL.md` and `docs/DESKTOP_BUILD.md`.
- Update privacy and help copy before enabling the integration.
- Add migrations through the Supabase CLI and regenerate database types.
- Add explicit grants, RLS, ownership constraints, and many-user isolation tests.
- Add provider fixtures for every page, private details, omitted attendees, recurrence exceptions, cancellation, duplicate copies, malformed URLs, unsafe HTML, 401, 403, 429, 5xx, and interrupted pagination.
- Add cache tests proving incomplete results never replace complete results.
- Add scans proving tokens remain absent from frontend bundles, SQLite, logs, exports, account-sync snapshots, and user backups.
- Update the interaction registry and design-system evidence when Settings controls become implemented.

Provider setup remains a separate authorized operation:

1. Create a separate Google Cloud project for the Calendar connector.
2. Enable the Google Calendar API.
3. Configure Cadence branding, support contact, authorized domains, privacy URL, and exact HTTPS redirect URIs.
4. Declare only `openid`, calendar-list read-only, and events read-only scopes.
5. Configure separate development/staging and production projects or clients.
6. Add explicit test users while the external app remains in Testing.
7. Store client ID, client secret, and credential-encryption key only in server environments.
8. Submit the production app for sensitive-scope verification before public use.
9. Account for Google Workspace administrator restrictions.

Google classifies reading Calendar events as sensitive access.
Testing status limits users and can limit refresh-token lifetime.
Published public use needs Google verification.
See [sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) and the [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

## Original pre-implementation acceptance gates, 2026-09-16

This section records the pre-implementation state. Current live evidence follows
in the 2026-09-17 checkpoint below.

Documentation verifies the protocol and API capabilities.
It does not verify Cadence's real provider configuration or live acceptance.

The following gates were open at this checkpoint:

- The current Supabase Google identity's `provider_id` must match the Calendar grant's Google `sub` in a real test.
- Google must return both selected read-only scopes and a durable refresh token for the configured Calendar project.
- Google consent denial and wrong-account selection need live web and installed-desktop checks.
- Calendar-list and event fields need real consumer and Workspace fixtures, including private events and domain restrictions.
- Pagination, rate limits, revocation delay, and `invalid_grant` handling need controlled provider tests.
- Google sensitive-scope verification and production publishing are not complete.
- Hosted migrations, server secrets, redirect URIs, Vercel configuration, and desktop deep-link registration are not configured.
- Apple-signed Data Protection Keychain acceptance remains required for the new pending-state key.
- No real-account data was read during this verification.

Run synthetic fixtures first.
Use a separately authorized test account and test Google Cloud project for live acceptance.
Do not claim Ticket 134 complete until both web and installed desktop flows pass the Ticket 134 verification list.

## Implementation boundary update, 2026-09-16

Focused security review accepted the server-owned architecture before migration.
The installed Supabase TypeScript identity interface omits `provider_id`; the
adapter accepts that verified Auth field when present and otherwise reads the
provider identity's `identity_data.sub`. SQL independently checks the exact
`auth.identities.provider_id` before credential installation. It never authorizes
from editable user metadata or email. Live identity parity remains unverified.

## Authorized live checkpoint, 2026-09-17

The owner approved hosted rollout and real-account acceptance. The dedicated Google project, exact callback, read-only scopes, test user, production secrets, and Calendar migration are configured. Live web same-account consent and primary-calendar event refresh pass. Installed native consent/deep-link reconnect, selection, refresh, disconnect revocation, and local cache cleanup pass. The broker enforces the signed-in Google subject match before storing credentials. The user-approved account now supplies live event context to both clients.

Google sensitive-scope verification/public publishing remain open. Live wrong-account rejection now passes on web and installed desktop; installed offline restart also passes. Provider-failure cases, Workspace field restrictions, and the remaining combined acceptance matrix remain open. Installed there-and-back account switching and secondary Calendar isolation/cleanup now pass. Existing synthetic and real local SQL contracts cover those boundaries but do not replace live evidence. Native preview.40 uses the legacy login Keychain with an ad hoc signature; Ticket 115 still owns Apple-trusted distribution. See `day-progress-release.md` for current evidence and rollback records.

## Tickets 140–141: research, recording script, and submission preparation

Prepared on 2026-09-17. This section prepares the verification work only. It
does not claim a recording, YouTube upload, Google submission, or approval.

### Current provider requirements

Google requires a sensitive-scope video to show the complete English OAuth
consent screen, the submitted app name, the OAuth client ID in the consent-page
address bar, and the enabled functionality for each requested sensitive scope.
The video must be uploaded to YouTube Studio as **Unlisted** and its link entered
in the Verification Center. [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

Google's documented submission sequence is: complete and publish branding, then
request Data Access verification. Branding needs current project contacts,
verified authorized domains, an accurate public homepage, and a privacy-policy
link on the same domain. Google states that published branding must exist before
a Data Access request. [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

Testing remains unsuitable for public release. Google limits Testing to 100
listed test users and expires a test-user authorization, including its refresh
token, after seven days. Production apps requesting unapproved sensitive scopes
show an unverified-app warning and remain subject to a 100-new-user cap. [Google App Audience](https://support.google.com/cloud/answer/15549945?hl=en)

The current live checkpoint records a separate Calendar project and live
read-only acceptance. The earlier Testing checkpoint used the existing production Vercel broker
callback. Neither is evidence that the final public client, domain, branding, or
sensitive scopes are approved. Tickets 138 and 139 must establish the final
public URLs and disclosures before this work records the submitted experience.

### Recommended recording method

Use the macOS Screenshot screen-recording tool on one clean display. Select the
Cadence and browser area, enable click indicators, and record one continuous
English flow. This keeps the browser handoff visible without third-party
recording software. Local inspection found `/usr/sbin/screencapture` with
interactive video, click-indicator, and duration options, plus QuickTime Player
and `ffmpeg`; no recording has occurred. Use `ffmpeg` only to inspect or trim a
start/end mistake. Do not cut out consent, the address bar, account selection,
or the return to Cadence.

Create a dedicated Gmail identity for demonstration and ongoing Cadence tests.
Use only a known name. Do not invent personal details or reuse a password. A
human must choose the password, complete any verification, and accept account
terms. Use a controlled Calendar with harmless events, such as “Cadence demo
event” and “Cadence all-day test.” Do not show personal calendars, event
descriptions, attendees, locations, tokens, secrets, unrelated tabs,
notifications, browser history, or desktop files. The OAuth client ID must remain
readable because Google requires it in the address bar. The test email visible
during the actual consent flow is expected.

### Timed demonstration script

Record this against the final production Calendar client and final public URLs.
Do not substitute a local bench, a fixture, an old preview callback, or a mock.
If a screen differs from this script, update the script before recording and
preserve the complete real flow.

| Time | Actual action and spoken or visible explanation | Required evidence |
|---|---|---|
| 0:00–0:15 | Open the public Cadence homepage. Show the short Calendar description and the privacy-policy link. State: “Cadence is a personal behavior tracker. Calendar is optional and read-only.” | Final public homepage and privacy URL on the verified domain. |
| 0:15–0:35 | Start signed out. Use Cadence’s normal Google sign-in and return to Cadence. State: “This signs into Cadence. It does not grant Calendar access.” | The user-facing Google sign-in path, when the recorded account needs it. |
| 0:35–0:55 | In Cadence Settings, show that Calendar is disconnected. Show the Calendar disclosure and select **Connect Google Calendar**. | Separate, user-initiated Calendar consent. |
| 0:55–1:25 | In the system browser, show the whole consent screen in English. Pause with the address bar visible so `client_id` is readable. Show the app name and both Calendar permissions. Select the designated test account and grant access. | Submitted Calendar client ID, app name, exact consent scopes, and affirmative grant. |
| 1:25–1:50 | Return to Cadence Settings. Show the subscribed Calendar list. Select the controlled Calendar only, save the selection, and state: “Cadence reads this list only so I can choose which calendars appear.” | `calendar.calendarlist.readonly` use; selection is local Cadence preference, not a Google Calendar change. |
| 1:50–2:15 | Select **Refresh Calendar**, then open Timeline. Show the two controlled event markers in the displayed date range. Open a marker preview and its details. State: “Cadence reads selected events to display context. It does not create, change, or delete Calendar events.” | `calendar.events.readonly` use and visible read-only context. |
| 2:15–2:25 | In web Settings, select **Disconnect Google Calendar**. Confirm the web Timeline no longer shows Calendar context. | The connection is account-wide and can be removed. |
| 2:25–2:55 | Open the installed desktop Cadence app. In Settings select **Connect Google Calendar**. Show the external-browser handoff, the full English consent screen, and the `cadence://calendar/callback` return. | Desktop uses the same server broker and external browser. No embedded Google authorization view. |
| 2:55–3:15 | In the native app, select the controlled Calendar, save, refresh, and show its Timeline marker. | Native selection and read-only Timeline use. |
| 3:15–3:25 | In the native app, select **Disconnect Google Calendar** and confirm Calendar context disappears. | Revocable connection and removal of visible Calendar context. |

The web disconnect deliberately resets the account-wide connection before the
desktop handoff. Show the second consent prompt in full with the same final
client identity. Do not splice a native handoff into an otherwise incomplete
authorization flow.

### Scope justification draft

Use these statements only after rechecking the final deployed client, consent
screen, and source paths. They describe current code, not a submitted decision.

| Scope | Current Cadence use | Why a narrower scope cannot provide the feature |
|---|---|---|
| `openid` | `createCalendarAuthorization` requests it with the two Calendar scopes. `exchangeCalendarCode` reads Google's `sub` and compares it with the signed-in Cadence Google subject before it stores a credential. See `lib/services/google-calendar-oauth.ts:5`, `:63-70`, and `:85-96`. | Cadence must bind a Calendar grant to the already authenticated Cadence account without using mutable email. It requests no `email` or `profile`; `openid` is the minimal identity scope used to receive and validate the stable subject. |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | `readGoogleCalendarCalendars` calls CalendarList and Settings displays the returned calendars for user selection. See `lib/services/google-calendar-provider.ts:232-260` and `lib/services/google-calendar.service.ts:94-108`. | Calendar event access does not provide the user’s subscribed Calendar list. This scope permits listing only. `calendar.calendarlist` could add or remove subscriptions, and `calendar.readonly` is broader. Google documents this scope for seeing subscribed calendars and permits it for `calendarList.list`. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) and [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) |
| `https://www.googleapis.com/auth/calendar.events.readonly` | `getCalendarEvents` fetches selected Calendar events for the displayed bounded date range. The provider normalizes them for Timeline markers, preview, and details. See `lib/services/google-calendar.service.ts:118-154` and `lib/services/google-calendar-provider.ts:116-229`. | Cadence must display selected-event context, including controlled test titles and times. `calendar.events.freebusy` has no event context, `calendar.events.owned.readonly` excludes subscribed shared calendars, and `calendar.events.public.readonly` excludes private or non-public Calendars. Cadence does not request `calendar.events`, `calendar.readonly`, or `calendar`, so it cannot write events or calendars. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) and [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) |

### Privacy and playback checklist

- Confirm the recording uses the final app name, public homepage, privacy URL,
  support email, authorized domains, HTTPS callback, and Calendar OAuth client.
- Confirm the consent language selector says English and both requested Calendar
  scopes are visible. Confirm the address bar shows the same client ID entered
  in the Verification Center.
- Confirm all displayed event data belongs to the designated test calendar.
  Inspect every frame for browser tabs, notifications, tokens, secrets, private
  Calendar data, personal emails, file paths, and unrelated account content.
- Confirm the recording shows actual Settings selection, manual refresh, Timeline
  use, desktop browser handoff, and disconnect. Confirm no Calendar write action
  appears.
- Play the exported file from start to finish before upload. Upload it as
  **Unlisted** only after identifying and recording the destination YouTube
  channel. Open its link in a signed-out browser and confirm the reviewer can
  watch it. Unlisted means anyone with the link can view and share it; it is not
  private. [YouTube Help](https://support.google.com/youtube/answer/9230970?hl=en)

### Submission fields and review follow-up

Record the following after actual actions. Do not put secrets, tokens, reviewer
emails, or private message text in git.

| Field | Value to record after the action |
|---|---|
| Google Cloud project ID and final Calendar OAuth client ID | `cadence-calendar-498717`; `567431620531-jilr3qg9oob1pbbvfhqkdnh797ep21uf.apps.googleusercontent.com`. Sign-in project remains separate. |
| Final homepage, privacy policy, terms URL if configured, authorized domains, redirect URI, and JavaScript origins | Saved and read back: `https://cadence-me.com`, `https://app.cadence-me.com/privacy`, `https://app.cadence-me.com/terms`. Added authorized `cadence-me.com` and exact `https://app.cadence-me.com/auth/google-calendar/callback`; retained legacy domains/callback. JavaScript origins unchanged. |
| Branding verification status, publish time, and Data Access request time | Search Console ownership verified September 17, 2026. Owner confirmed In production. Google verified and published Cadence branding. Calendar data-access submission accepted September 18, 2026 at 10:52 EDT; verified status observed September 20. |
| Exact declared scopes | `openid`, `calendar.calendarlist.readonly`, and `calendar.events.readonly`; console readback reconfirmed all three September 20. Calendar-list/OpenID appear under non-sensitive; events-readonly appears under sensitive and is verified. No restricted scopes are listed. |
| Demonstration artifact path, SHA-256, duration, unlisted YouTube URL, and signed-out playback result | Final 214.833-second export and SHA-256 recorded below. Unlisted https://youtu.be/vUi5s2B51Uo; unauthenticated privacy-enhanced embed playback passes. Earlier FFlbGp-_6bE is superseded. |
| Demonstrated web deployment and installed desktop build | Video: dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua. Separate installed QA: preview.40; no native footage in this export. |
| Developer contact and support inbox monitor | Owner retained `info@identityscaffolding.com` and named Emiliano Bache Rodriguez as its human monitor on September 17, 2026. |
| Reviewer request date, requested evidence, response date, and current Verification Center status | Submitted September 18, 2026, 10:52 EDT. Verified status observed September 20. No reviewer correspondence was read. |
| Final decision, approved scopes, approved client, and post-decision web/native consent smoke result | Data access verified, observed September 20. `calendar.events.readonly` explicitly verified; other declared scopes remain `openid` and `calendar.calendarlist.readonly`. Production broker client matches the ID above. Post-approval web/native smoke checks remain outstanding. |

Before submission, identify any genuinely test-only clients, preview callbacks,
and private-only redirects for removal through the provider workflow. The existing
`cadence-blush-three.vercel.app` callback is a production compatibility endpoint,
not a disposable preview. Do not remove it or redirect the installed desktop
broker while clients still require it. Ticket 138 owns that migration and its
compatibility evidence. Google recommends separate testing and production
projects and says production clients must not contain test or pre-release
redirect URIs. [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)

### Dedicated demo identity preparation, 2026-09-17

The owner authorized a dedicated Gmail account for demonstration and ongoing
Cadence testing. The signup form received only the known name, Emiliano Bache
Rodriguez. Google then required birthday and gender. The account setup remains
open in Identity Scaffolding Chrome for the owner to supply missing details,
choose a new password, complete verification, and accept required agreements.
No account creation success, credentials, or invented personal details are recorded.

YouTube account inspection identified existing channel `brittlebeliefs`
(`https://www.youtube.com/channel/UCXSp9JAdGUai5kTss6E8MCQ`). The support identity
`info@identityscaffolding.com` has no YouTube channel. No upload occurred.
A local import fixture is prepared at
`/private/tmp/cadence-domain-release-20260917/cadence-demo.ics`: two timed demo
events and one two-day all-day demo event, with no attendees or alarms. Its dates
are September 17–18, 2026; adjust them if recording occurs later. Import only
into the dedicated test account after signup completes. This fixture is not
live Calendar evidence or a recording.


### Dedicated identity and Calendar preparation, 2026-09-17

The owner completed signup for `cadence.testing.is@gmail.com`. The existing
Google Account page and Calendar account control both confirmed that identity.
The operator created the private `Cadence demonstration` calendar in
America/New_York and saved these harmless synthetic events through Calendar UI:

| Event | Time | Other data |
|---|---|---|
| Demo planning | September 17, 2026, 13:00–13:30 Eastern | Synthetic-event description; no guests, location, or reminder |
| Demo afternoon walk | September 17, 2026, 16:00–16:30 Eastern | Same harmless description; no guests, location, or reminder |
| Demo workshop | All day September 17–18, 2026 | Same harmless description; no guests, location, or reminder |

The attempted ICS upload returned `Not allowed`; the Chrome extension lacks
file-URL upload permission. No ICS import completed. Direct event creation
completed instead, and Calendar displayed each saved event with the correct
calendar, title, and time. The Calendar OAuth project's audience now lists the
dedicated identity alongside both existing test users. Publishing remains Testing.

New-domain Cadence sign-in is ready at `/login`. The page states that continuing
accepts Cadence Terms and acknowledges Privacy. The operator requested required
action-time confirmation for this agreement and the dedicated account's read-only
Calendar access. No new-account Cadence login or Calendar grant has completed yet.


### Dedicated account web acceptance and desktop preparation, 2026-09-17

The owner completed Cadence sign-in and reported completion of the pending step.
Settings confirmed `cadence.testing.is@gmail.com`. Google consent requested only
the calendar-list and event read permissions, in addition to OpenID association.
The dedicated account granted them and returned to the new-domain Settings page.
Only `Cadence demonstration` was selected; its primary calendar and Holidays in
the United States remained unselected. Save and refresh succeeded. Timeline showed
Calendar current, both timed demo markers, and Demo workshop on September 17 and
18 only. Demo afternoon walk preview showed 16:00–16:30 Eastern. Its read-only
details showed the synthetic description, 30-minute duration, America/New_York,
and no attendees, location, conference, or attachments. No source-event or
Behavior mutation occurred during this acceptance check. Demo workshop details
also showed `2026-09-17 through 2026-09-19 (exclusive)` and `2 calendar days`.

The owner explicitly approved backing up the installed desktop database,
temporarily switching to the dedicated test account, and restoring the primary
account afterward. Settings Back Up created the private local file
`/private/tmp/primary-before-demo-20260917.sqlite3` outside the repository and
release candidate. Its mode is owner-only and SQLite `PRAGMA quick_check` returned
`ok`. The native automation timed out after saving; normal Quit/relaunch restored
inspection. Keep a local copy disconnected the primary account and displayed the
retained app-managed SQLite path. The hosted primary account was not deleted.

The first desktop OAuth attempt opened in the other Chrome profile. Moving its
already-generated Google URL between profiles failed with HTTP 400 and did not
link an account. The operator cancelled it and restarted the native flow after
selecting Identity Scaffolding in Chrome. The dedicated-account chooser then
remained pending. Native Chrome controls repeatedly reported active user
interaction, preventing inspection of the external-app handoff. The operator
requested an uninterrupted Chrome window before continuing. This checkpoint does
not claim desktop sign-in, restoration, native Calendar acceptance, recording,
upload, or Google submission. Existing owner approval and eventual Google approval
remain separate.

Documentation validation after this checkpoint: `npm run agents:check` and
`git diff --check` passed. No runtime code or deployment changed in this continuation.


### Installed dedicated-account acceptance continuation, 2026-09-17

The owner requested completion of the approved desktop test. A fresh native
Google sign-in opened in Identity Scaffolding Chrome. The operator selected
`cadence.testing.is@gmail.com` and accepted Chrome's Open Cadence.app prompt.
Native accessibility timed out after the callback. Normal Quit/relaunch restored
inspection, and Settings confirmed the dedicated identity with first-link review
still pending. Immediate callback rendering is not claimed.

The operator chose Ignore local data and use account data. Cadence created a
protected backup before replacement and reported Account data is current.
Read-only SQLite checks found eight categories, zero Behaviors, and zero
Occurrences; integrity and foreign keys passed. Primary data did not enter the
dedicated account. The original private backup remains available.

Installed preview.40 read the existing dedicated Calendar grant and selected
only Cadence demonstration. Native Refresh Calendar succeeded. Timeline displayed
both timed demo markers and Demo workshop on September 17 and 18, excluding
September 19. Native details showed a two-calendar-day duration and the exclusive
September 19 end. No tracking or source-event mutation was submitted.

Native global Calendar disconnect succeeded. Web reload showed Calendar is not
connected and removed all event markers/labels. Native calendar-cache.sqlite3
contained zero complete snapshots and zero pending refreshes; integrity passed.

A fresh native Calendar flow reached the preserved legacy broker's English
consent screen with the dedicated identity and the same calendar-list/event
read-only scopes. Automatic approval review rejected scope selection because
Google grants account-wide calendar reads, while the reviewer interpreted the
existing authorization as limited to harmless test-calendar data. The operator
left both scope boxes unchecked and asked for explicit approval of those two
account-wide read-only permissions for the dedicated identity. No workaround or
new grant occurred after rejection. Native reconnection and primary-account
restoration are pending at this checkpoint. No recording, upload, or Google
review submission occurred.


The owner subsequently explicitly approved both account-wide read-only Google
Calendar scopes for the dedicated account and requested reuse of that approval
for equivalent operations. The operator selected both permissions and activated
Continue. The prior approval gate is resolved. Callback completion remains
unverified because native Chrome controls repeatedly reported user interaction
and changing foreground tabs. The operator requested a brief uninterrupted
Chrome handoff, not another permission approval.


### Native reconnection and primary restoration completed, 2026-09-17

The approved fresh Calendar grant completed through the installed preview.40
legacy broker. Settings confirmed the dedicated identity and Calendar connected.
The operator selected only Cadence demonstration, saved, and refreshed. Timeline
showed both timed demo events and the two-day workshop. Read-only cache inspection
found one complete snapshot, one selected calendar, and the September 17–24 range;
SQLite integrity passed. Immediate callback rendering was not observed.

Keep a local copy disconnected the dedicated account. Normal Google sign-in then
restored emibache@gmail.com. Settings reports Account data is current and the
primary account's existing Calendar selection is restored. No Calendar permission
or selection was changed for that primary account.

Read-only comparison against the private pre-demo backup verified identical IDs,
counts, and every stored value across categories, Behaviors, schedules, slots,
definition/configuration history, 1,638 Occurrences, 1,226 status events, 12 time
sessions, import runs/mappings, imported notes/interventions, and shortcut states.
All 1,600 reminder IDs remain. One reminder advanced from pending to sent, changing
only its status, processing_started_at, sent_at, and updated_at. Both databases
pass quick_check and have zero foreign-key violations. The backup remains outside
the repository at its previously recorded private path.

Ticket 138's domain/native compatibility acceptance is complete. Ticket 140's
actual recording/upload remains in progress. No recording, upload, or Google
submission is claimed. Owner approval, technical verification, and Google's
future review remain distinct. No runtime code or deployment changed.


### Review-inbox and recording readiness checkpoint, 2026-09-17

The owner named Emiliano Bache Rodriguez as the human monitoring
info@identityscaffolding.com. Google Branding readback confirms Cadence Calendar,
the final public homepage/privacy/terms URLs, that support/developer inbox, and
preserved legacy authorized domains. The console still states Testing and offers
no branding-verification action in that state. No publishing-state change occurred.
Google's sensitive-scope requirements were rechecked against its official guide
(updated August 19, 2026): real English sign-in/consent, visible app name/client ID,
scope-use demonstration, and an accessible unlisted video remain required.

The installed macOS Screenshot controls failed to launch or timed out. QuickTime
opened, but New Screen Recording did not expose usable recording controls.
BetterCapture inspection also timed out. The installed Chrome recorder opened;
its initial video mode showed Cloud storage with camera and microphone off.
Local storage was not verified because the foreground changed during setup.
No recording was started and no media was uploaded. An unrelated Gmail screenshot
was rejected by automatic approval review; no screenshot workaround was used.
The operator moved to the dedicated demo page and requested an uninterrupted
screen-control window after further foreground changes. The primary desktop
account remains restored. Browser Settings remains on the dedicated test account.

Documentation checks after native restoration: npm run agents:check and
git diff --check passed. Full runtime checks from the reviewed release remain the
applicable evidence; this continuation changed documentation only.


### Actual demonstration and second desktop restoration, 2026-09-17

The installed Awesome Screen Recorder extension captured one isolated Chrome
window in Local storage mode. Camera, microphone, and system audio were off.
The four-minute continuous production web flow covers homepage/Privacy, Google
sign-in, disconnected Calendar Settings, separate English consent, both read-only
permissions, readable Calendar client ID, selection of only Cadence demonstration,
save/refresh, Timeline timed preview/details, two-day all-day details, and global
disconnect. The final Timeline says Calendar is not connected. No Calendar write
operation occurred. This actual sequence supersedes the planned 3:25 script.
Desktop footage was unnecessary for the shared broker/client scope demonstration;
installed consent and data preservation remain separately verified above.

The production app is dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua. The final client is
567431620531-jilr3qg9oob1pbbvfhqkdnh797ep21uf.apps.googleusercontent.com.
The actual unverified Google consent label is cadence-me.com. Configured branding
is Cadence Calendar; Google has not approved that brand or its sensitive scope.

The final local artifact is
/private/tmp/cadence-oauth-demo-20260917/cadence-calendar-oauth-demo.mp4.
It is 240 seconds, 1146 × 720, 30 fps H.264, 2,379,603 bytes, with no audio.
SHA-256: 2232c8c93d2f8308053b6474acf62d5749d6bac844c500fcd1ad658495289e36.
Opaque masks cover unrelated saved-account identities and transient OAuth URL
parameters. The test identity, real consent, scopes, and public client ID remain
visible. No cuts, timing changes, or recreated interface were introduced.
All 240 one-second samples were visually inspected; sensitive transitions received
additional inspection. QuickTime played the full export and full-file ffmpeg
decoding passed. Raw media and private backup files remain outside git and must
not be uploaded. This privacy masking is an explicit update to the earlier
trim-only recording plan.

YouTube Studio confirmed channel brittlebeliefs, UCXSp9JAdGUai5kTss6E8MCQ.
The planned upload is Unlisted, not made for kids, with the title
“Cadence Calendar — OAuth verification demonstration.” No upload has occurred:
the upload dialog displays a Terms of Service/Community Guidelines agreement.
Action-time confirmation is pending. Signed-out playback therefore remains open.

Before the second native switch, an online SQLite backup was saved privately as
/private/tmp/primary-before-native-recording-20260917.sqlite3 (mode 0600).
The approved test-account switch and primary-account restoration used normal UI.
All rows in all 15 tracking tables match this backup exactly, including 34
behaviors, 1,638 occurrences, and 1,600 reminder deliveries. Both databases pass
quick_check with zero foreign-key violations. Primary Settings reports Account
data is current; its existing Calendar selection remains intact.

Observed native UI issue: after Keep a local copy and reconnect, a stale
“Account disconnected” success notice can hide the Keep a local copy control.
Normal quit/reopen clears that notice. Account synchronization and restored data
passed; no runtime fix was made in this publication task.


Final restoration readback: after normal restart, Settings shows the primary
identity, Account data is current, and Keep a local copy. The stale notice is
absent. QuickTime readback confirms elapsed 04:00, duration 04:00, playback off.
Google Verification Center explicitly says verification is not required while
Testing; no submission control is available in that state. Documentation checks
npm run agents:check and git diff --check pass.


### Unlisted publication and Google submission gate, 2026-09-17

The owner confirmed YouTube’s agreement at the upload step. The reviewed MP4
uploaded through the browser file chooser. YouTube checks completed with no
copyright issues. The title is “Cadence Calendar — OAuth verification
demonstration”; audience is not made for kids; visibility is Unlisted. Studio
confirmed Video published. The link is https://youtu.be/FFlbGp-_6bE on brittlebeliefs
(channel UCXSp9JAdGUai5kTss6E8MCQ). Description discloses the privacy masks,
actual unverified domain label, scope use, test data, and lack of Google approval.
No raw recording or private primary-account data was uploaded.

A fresh Chrome Incognito window displayed Sign in, the Unlisted label, the correct
video title/channel, and advancing playback (0:02 of 4:00). Reviewer access passes
without a Google account. The Incognito test window was closed afterward. The
in-app browser inherited a signed-in session, so it was not used as signed-out
evidence. Ticket 140 is complete; Google may still request revised evidence.

Google Verification Center requires leaving Testing before submission. The actual
Push to production dialog says the app will be available to any Google Account.
That audience-expansion confirmation is pending; no Google publishing-state change,
review submission, or approval occurred. All three scope declarations and the
existing callbacks remain unchanged. Public rollout remains subject to Ticket 137.


### Verified branding continuation — September 17, 2026

The owner confirmed the production-audience expansion at the open Google dialog.
The Calendar project `cadence-calendar-498717` now reports In production. Google
found that the consent name Cadence Calendar did not match the homepage. Changing
the consent name to Cadence resolved the finding. Google verified the branding,
and publishing it produced the confirmation that verified branding is shown to
users. The project and client IDs, callbacks, scopes, and separate sign-in project
remain unchanged. This is Google's branding approval, not Calendar-access approval.

The scope justification and submission summary are saved. Final submission remains
at the unanswered Verification Questionnaire. Google's current video requirements
require matching app name and branding. The existing unlisted video shows the
previous domain label, so Ticket 140 is reopened for actual updated footage. No
consent labels will be replaced or simulated in the recording. The dedicated test
account remains disconnected; the primary desktop account remains restored.

The owner retained info@identityscaffolding.com and named Emiliano Bache Rodriguez
as the human monitor. The September 17 Privacy approval remains owner approval,
not independent legal review. No Calendar data-access submission or approval has
occurred. Reference: https://support.google.com/cloud/answer/13464321 .


### Updated-brand recording — September 17, 2026, 21:29 EDT

A new continuous local recording completed in Awesome Screen Recorder. It shows
actual Google sign-in, the pending-review warning, the verified Cadence consent
name, both read-only Calendar scopes, demonstration-calendar selection, refresh,
timed and two-day event details, and successful disconnect. The dedicated account
remains disconnected. The recorder shows approximately 3 minutes 40 seconds.
Download, privacy editing, playback review, and replacement upload remain pending;
this checkpoint does not complete Ticket 140.

Automatic approval review blocked reading the live OAuth address to select the
client ID. No OAuth parameters were extracted through that rejected action. The
previous reviewed recording contains the same client's readable address-bar ID;
retain truthful capture provenance if using it as supplemental client evidence.
Browser URL policy separately blocked automated access to the extension's saved
video page. The user was asked to download the completed recording. No alternate
extension-access route was attempted after that block.

The Privacy page still contained a Testing-mode availability sentence. The
continuation corrects only that obsolete availability statement to pending review.
Data handling, retention, scope, and Limited Use disclosures remain as owner
approved. This operational correction is not independent legal review.


September 18 download checkpoint: the user downloaded
`Cadence-·-Decide-your-days-own-every-record.mp4`. Its 3,694,663 bytes and
SHA-256 `6b23892aea067bcb247de486615eb342f37e035c60228c8d25f23624f28612a9`
match the earlier raw four-minute recording exactly. It is not the updated-brand
recording. The requested replacement remains the recorder's Settings | Cadence
Tracker item, approximately 3:40. No replacement upload or final Google submission
was made from the older file.


### Final verified-brand video and submission — September 18, 2026

The user downloaded the correct `Settings-Cadence-Tracker.mp4` recording.
The final privacy-reviewed export is:
`/private/tmp/cadence-oauth-demo-20260917/verified-brand/cadence-calendar-verified-brand.mp4`.
SHA-256: `a2d7b2ae0d8b974776c5f4fc24939b605aea367c73309b2bb02b06a2e3130c14`.
It is 2,042,323 bytes, 214.833 seconds, H.264, 1146×720, 30 fps, with no audio.
The raw recording and review artifacts remain private and outside git.

The actual September 17 main recording shows dedicated-account sign-in, the
expected pending-sensitive-review warning, Cadence identity consent, both Calendar
read-only permissions, only the demonstration calendar selected, refresh, timed
preview/details, two-day all-day details, and disconnect. Three unrelated account
chooser identities and transient OAuth address parameters are masked. The ending
Privacy segment was trimmed because it showed the obsolete Testing-mode sentence;
the subsequent production correction is recorded in release QA.

At 3:25, a separately labeled ten-second client reference shows the public client
ID from the earlier reviewed recording. It identifies that earlier capture and the
unchanged production client. It is not presented as continuous current-brand footage.
No consent wording or app identity was replaced. Web deployment demonstrated:
`dpl_CHQVE4LWvUPG6LN4dpW3YwTTAgua`; installed preview.40 acceptance remains separate
QA evidence. Both surfaces share the same hosted Calendar client.

Privacy inspection covered 215 one-second samples in 14 contact sheets, plus
full-resolution consent/client-reference frames. Full-file decoding passed.
QuickTime completed playback at 3:35 with the final client reference visible.
YouTube published the export as Unlisted on brittlebeliefs
(`UCXSp9JAdGUai5kTss6E8MCQ`): https://youtu.be/vUi5s2B51Uo .
Checks found no issues; the video is not made for kids. The prior video remains
available but is superseded as submission evidence.

Reviewer access passed through the unauthenticated `youtube-nocookie.com` player
embedded on a temporary loopback page in Chrome. Its title/channel matched, and
playback advanced to 0:03 of 3:34. The direct embed first returned Error 153 because
it lacked an embedding referrer; the normal embedded player resolved that setup
error. No Google account sign-in was performed for the privacy-enhanced player.
This check is not claimed as a new Incognito-window test. The temporary server
and test tabs were removed afterward.

Google saved the replacement link and the unchanged 965-character scope
justification. The 941-character additional information names both Google projects,
the production client, shared desktop broker, legacy callback compatibility, test
data, masking, explicitly earlier client-reference provenance, and inbox monitor.
All four questionnaire eligibility questions were answered No. The requirements
acknowledgment and conditional restricted-scope acknowledgment were checked; no
restricted scopes are requested.

The final Submit for verification action succeeded on September 18 at 10:52 EDT
(14:52 UTC). Verification Center reports: **Your app's data access is under review.**
Trust and Safety confirms receipt. All seven review steps show in progress.
The console estimates a first email within 3–5 days and review within 4–6 weeks;
these are Google's estimates, not guaranteed dates. The last approved consent
screen remains in use. Branding remains verified and shown to users.

Ticket 140 is complete. Ticket 141 remains in progress until Google's decision
covers the actual client/scopes and post-approval web/native smoke checks pass.
Owner Privacy approval, technical acceptance, and provider approval remain distinct.
Emiliano Bache Rodriguez monitors info@identityscaffolding.com. Task heartbeat
`cadence-google-review-follow-up` previously checked Verification Center daily at
09:00 local. The owner requested disabling it on September 28 after Google approval;
the app confirmed `PAUSED`. It did not read or monitor that inbox. Ticket 141's
one-time post-approval web/native smoke checks remain outstanding. Private reviewer
correspondence must stay out of git.

Final documentation checks passed: `agents:check`, `interactions:check`,
`resolvers:check`, and `git diff --check`. No new runtime change required another
full build or test run.

## PR 55 event-list parameter review — September 18, 2026

Google's [Events.list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
does not define `conferenceDataVersion`. The [Events.insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
defines it for conference copying/creation and explicitly refers to event
modification requests. Keep the read-only list request's `conferenceData` fields
projection. The review suggestion to add a write-only parameter to every list
page does not apply. Existing adapter tests cover conference entry points.

## Verification Center follow-up — September 19, 2026, 09:01 EDT

Signed-in Computer Use checked `cadence-calendar-498717`. Data access remains
under review; verified branding remains visible to users. The progress dialog
now lists six steps. Google marks homepage requirements and branding guidelines
complete, both last reviewed September 18. Privacy policy, app functionality,
appropriate data access, and minimum scopes remain in progress.

No actionable reviewer request or final decision appears in the console.
The check did not read the inbox, send correspondence, or change configuration.
Emiliano Bache Rodriguez remains the inbox monitor. Ticket 141 and public rollout
gates remain open; partial review progress does not establish scope approval.
Only this record and `STATUS.md` changed for the check. `git diff --check` passed;
runtime tests were not rerun for this evidence-only update.


## Google data-access approval observed — September 20, 2026

The scheduled signed-in Computer Use check opened Verification Center for
`cadence-calendar-498717`. Google now states: **Your app's data access has been
verified.** Branding remains verified and shown to users. This is an observed
provider decision; the exact approval timestamp was not exposed or inferred.

September 21, 22, and 23 follow-ups checked the signed-in Verification Center.
Branding and data access remain verified. No new actionable request appears. The checks changed
no configuration and did not read the inbox. Post-approval smoke checks remain
outstanding. `git diff --check` passed for this evidence-only update.

September 24 follow-up could not access the Identity Scaffolding Chrome session;
Computer Use reported that the instance was unavailable. Today's provider status
is not verified. The last successful check remains September 23. Resuming the
check requires the signed-in Identity Scaffolding profile to be available.
No project configuration changed, no inbox was read, and no correspondence was
sent. This session failure provides no evidence that Google changed its approval.
September 25 follow-up: Computer Use could not access the Identity Scaffolding
Chrome session. The available-browser inventory contained no matching profile.
Today's provider status is not verified; September 23 remains the last successful
check. The September 24 request to open that signed-in profile remains outstanding.
This unchanged session blocker provides no evidence of a Google decision change.
No configuration, scopes, callbacks, or rollout gates changed. No inbox was read
and no correspondence was sent.

September 26 follow-up: the owner signed the Claude browser pane (not Chrome)
into info@identityscaffolding.com, and the check ran there. The pane holds
emibache@gmail.com as `authuser=0` and Identity Scaffolding as `authuser=1`,
so the console URLs need `authuser=info@identityscaffolding.com` or
`authuser=1`; the default account shows "You need additional access". The
Verification Center reports branding verified and shown to users and data
access verified. Data Access still declares `calendar.calendarlist.readonly`
and `openid` as non-sensitive, `calendar.events.readonly` as the only
sensitive scope, and no restricted scopes. No actionable reviewer request
appears. No configuration changed, no inbox was read, and no correspondence
was sent. Google exposes no public API for verification status (the console's
`oauthconfig` and `clientauthconfig` services refuse discovery), so the pane
session or a Claude in Chrome connection in the Identity Scaffolding profile
remains the way to repeat this check; the local gcloud CLI is signed in as
info@identityscaffolding.com for every API-backed operation.

The September 26 scheduled follow-up found that record but could not independently
repeat it. The Identity Scaffolding Chrome session remained unavailable. Automatic
approval review blocked selecting Claude Desktop because it could expose unrelated
private content. No alternate route was used to bypass that rejection. The existing
September 26 provider evidence above is preserved; this automation obtained no new
provider decision and changed no configuration, scopes, callbacks, or rollout gates.

September 27 and 28 scheduled follow-ups: Computer Use again reported the Identity
Scaffolding Chrome session unavailable; the browser inventory contained no matching
profile. Today's provider status is not verified. The recorded September 26 check
remains the latest provider evidence. The existing request to open the signed-in
Chrome profile remains outstanding. No configuration, scopes, callbacks, or rollout
gates changed. No inbox was read and no correspondence was sent. Ticket 141 remains
in progress pending post-approval smoke checks. `git diff --check` passed.

Data Access lists `calendar.events.readonly` with **This scope is verified**.
The unchanged non-sensitive declarations are `calendar.calendarlist.readonly`
and `openid`. The restricted-scope list is empty. Clients lists one web client,
Cadence Calendar broker, with the submitted production ID:
`567431620531-jilr3qg9oob1pbbvfhqkdnh797ep21uf.apps.googleusercontent.com`.

The check changed no project configuration, scopes, callbacks, or rollout gates.
No inbox was read and no correspondence was sent. Emiliano Bache Rodriguez remains
responsible for info@identityscaffolding.com. Owner Privacy approval, independent
legal review, technical acceptance, and Google approval remain separate facts.

Ticket 141 remains in progress. Post-approval web/native consent smoke checks
have not run. Earlier pre-approval acceptance does not replace those checks.
Ticket 137's remaining technical gates and Ticket 115's Apple trust gate remain.
Public pending-review copy requires reconciliation with approval during the
post-approval release work; this read-only provider check deploys nothing.

Verification for this evidence-only update: `git diff --check` passed. Runtime
code did not change, so runtime tests and builds were not rerun.

## Production Calendar pending-state audit — September 27, 2026

The source audit found and corrected malformed persisted-state acceptance.
Installed production Calendar acceptance remains unverified by this audit.
This section preserves all earlier provider and installed acceptance records.

`DesktopCalendarConnection` stores `accountId`, a random state, and `createdAt`
in the fixed `pending-calendar-state` entry before requesting the broker URL.
The native adapter uses the Data Protection Keychain for production builds.
It disables synchronization and uses `AfterFirstUnlockThisDeviceOnly`.
The Rust allowlist admits this key; `auth.m` required no change.

`complete()` removes pending state before validation and a broker connection read.
Cancellation, browser-open failure, Calendar disconnect, and account cleanup remove
the entry. Account cleanup also clears the separate disposable Calendar cache.
Same-account restart can complete an unfinished attempt only within five minutes.
The callback requires the current Cadence account and the saved random state.
Sequential replay cannot reuse consumed or cancelled pending state.

Two synthetic regressions failed before the correction. A missing `createdAt`
bypassed both age comparisons. A null state matched an absent callback state.
The shared parser now requires nonnull pending data, nonempty string state,
and a finite numeric timestamp. Both regressions reject before broker access.
Both regressions also verify pending-state removal. No Google token or source
event crosses this parser; the server still owns consent and credentials.

Source references: `apps/desktop/src/calendar/google-calendar.ts`,
`apps/desktop/src/account/auth.ts`, `apps/desktop/src-tauri/src/auth.rs`, and
`apps/desktop/src-tauri/native/auth.m`. Regression and lifecycle evidence lives
in `tests/desktop-calendar.test.ts`. Hook/account evidence lives in
`tests/desktop-calendar-hook.dom.test.tsx`, `tests/desktop-auth.test.tsx`, and
`tests/desktop-auth-upgrade.test.ts`.

### Installed acceptance matrix

Only the parent agent controls the installed app and browser during acceptance.
These actions remain pending until an installed result records the exact candidate.
Preserve the protected database, rollback app, and current Calendar selection first.
Record labels, counts, presence booleans, and integrity comparisons only.
Keep account identifiers, Calendar labels, URLs, states, and credentials outside git.

| Native path and action | Required observable evidence |
|---|---|
| Settings → Google Calendar → Refresh Calendar | Connected status, selected-calendar count, successful refresh, and Calendar markers. |
| Settings → Google Calendar → Connect Google Calendar; cancel Google consent in the browser | Return callback, disconnected status, and no pending state or newly cached events. |
| Start consent; quit and reopen Cadence; complete consent within five minutes | Same-account connection, selected list, consumed pending state, and unchanged tracking fingerprints. |
| Repeat a consumed callback through the native handler | Rejection without another accepted callback, changed account, or cache mutation. Never record callback URLs. |
| Finish an expired attempt after five minutes | Rejection and cleared pending state; a fresh connect remains available. |
| Settings → Google Calendar → Disconnect Google Calendar | Disconnected status, zero cached Calendar markers, cleared pending state, and factual revocation outcome. |
| Settings → Account → disconnect while keeping the local copy | Local mode, empty local Calendar cache, removed pending state, and preserved tracking fingerprints. Global Calendar connection remains separate. |
| Reconnect the original account and restore the original Calendar selection | Current account data, current Calendar refresh, matching tracking fingerprints, SQLite integrity, and foreign-key checks. |

The connected panel exposes Save, Refresh, and Disconnect. Connect appears only
when disconnected or reconnection is required. The panel has no native Calendar
Cancel button; cancellation uses the browser's consent flow or account cleanup.

Candidate `0.1.1-rc.1` can establish legitimate production Keychain lifecycle
evidence. A read-only comparison confirms its source lacks this parser correction.
The correction requires a later reviewed build for final distribution acceptance.
Synthetic tests do not prove installed Keychain persistence or callback delivery.

### Verification and remaining gates

Node `24.19.0` ran four focused test files: 34 passed.
Coverage includes malformed records, state/account mismatch, expiry, future time,
instance restart, sequential replay, cancellation, browser failure, and account cleanup.
Focused ESLint, desktop TypeScript, `agents:check`, `interactions:check`, and
`resolvers:check` passed. Full repository checks belong to the parent task's final
verification. No native rebuild, provider call, live Keychain/SQLite operation,
or UI control ran during this source audit.

The latest recorded Google decision remains the September 26 approval evidence.
This audit obtained no fresh provider status. Google sensitive-scope approval
does not close post-approval web/native smoke checks, Ticket 137's controlled
provider-failure/Workspace and installed fixture cases, or Ticket 115's Apple gates.
The September 27 signed-in browser-session blocker remains recorded above.

Platform impact: desktop owns this parser correction. Web consent and broker
behavior require no source change. Marketing needs no new capability claim.
Future native mobile remains deferred under the existing shared Calendar contract.
