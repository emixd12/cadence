# Messaging change log

**Rule (owner decision, October 27, 2026; replaces the October 22 privacy-only
rule):** development work records here every change it makes to what Cadence says
about itself, then proceeds. Messaging conflicts never block development, merges or
deployments. The messaging track (Tickets 245 and 246) resolves them in its own
tickets. `docs/DECISIONS.md` (2026-10-27) records the rule.

This file lists every decided or implemented change that makes any of these surfaces
inaccurate or incomplete:

- **Privacy and Terms**: the Privacy and Terms pages.
- **Trust**: the public Trust page and its claims.
- **In-app copy**: disclosures, consent text, Settings and setup wording.
- **User guide**: `docs/user-guide/*`.
- **Marketing**: cadence-me.com, the FAQ, the README and listing copy.
- **Provider submissions**: Google OAuth verification, OpenAI and Claude directory
  listings, Apple and other reviewer-facing text and videos.

The file name was `docs/PRIVACY_CHANGES.md` until October 27, 2026. Existing `P-`
IDs keep their numbers; new entries continue the same `P-` sequence.

Provider terms, data licences and the owner's legal risk decisions stay in
`docs/LEGAL.md`. An entry here links the related `L-` entry when one exists.

## When the track gates

Only outward actions wait on this log. Before a provider submission, public launch
or public listing, the owner resolves (or explicitly accepts) every open entry whose
surfaces that action shows to a reviewer or the public. A source merge, hosted
migration or deployment never waits on an entry.

Development tickets do not edit Privacy, Terms, Trust, marketing or submission text,
or tests that assert that text (`tests/legal-content.test.tsx`), unless the ticket
says so. They log an entry instead.

## Current text the entries cite

- `components/settings/LegalContent.tsx`: the Privacy page (dated October 24, 2026),
  the Terms page (dated October 18, 2026) and the Trust page (dated August 27, 2026).
  `tests/legal-content.test.tsx` asserts parts of that text.
- `docs/user-guide/*`: factual user guidance.
- Marketing: `apps/marketing` (cadence-me.com), including `src/data/faq.ts`,
  `src/data/routes.ts`, `src/data/developers.ts` and `src/pages/about.astro`.

Entries quote section titles and text rather than line numbers, because line
numbers move.

## How to add or update an entry

1. Give a new entry the next ID (`P-044` is next). Never reuse an ID.
2. Fill in every field below. Quote the conflicting current text briefly and name
   its file and section.
3. Log the change when it is decided or implemented. Do not wait for release.
4. Link the entry ID from every ticket, plan or doc that causes the change.
5. When updated text ships, record the file, the deployment and the date, then set
   the status.

Fields: change; affected tickets and files; surfaces (from the list above);
conflicting current text; update needed; status.

Status values:

- **logged**: recorded here. The current text has not been updated.
- **drafted**: replacement text exists for owner review and is not published.
- **resolved**: the updated text is live, or the change no longer happens. The entry
  says which.

## Index

| ID | Change | Status | Tickets | Surfaces |
| --- | --- | --- | --- | --- |
| [P-001](#p-001-im-here-place-positions-and-completion-place-labels) | "I'm here" place positions and completion place labels | logged | 216, 219, 244 | Privacy, Travel Settings, user guide, MCP docs, marketing |
| [P-002](#p-002-leave-time-feedback-taps-and-learned-travel-habits) | Leave-time feedback taps and learned travel habits | logged | 217, 219 | Privacy, Travel Settings, user guide |
| [P-003](#p-003-open-meteo-recipient-log-retention-and-attribution) | Open-Meteo recipient, log retention and attribution | logged | 218, 219 | Privacy, Settings, marketing, user guide, interface |
| [P-004](#p-004-daily-brief-model-data-disclosure-and-re-consent) | Daily Brief model-data disclosure and re-consent | logged | 219, 216, 217, 218 | Privacy, Daily Brief and Travel Settings, user guide |
| [P-005](#p-005-public-statement-that-cadence-sends-no-behavior-data-to-an-ai-provider) | Public statement that Cadence sends no behavior data to an AI provider | resolved | 187 | Trust page, test |
| [P-006](#p-006-marketing-review-of-ai-and-travel-claims) | Marketing review of AI and travel claims | logged | 219, 165, 187 | Marketing |
| [P-007](#p-007-first-run-setup-invites-a-home-address) | First-run setup invites a Home address | logged | 212 | Privacy, user guide |
| [P-008](#p-008-setup-purpose-line-does-not-name-google-maps) | Setup purpose line does not name Google Maps | logged | 212 | Setup copy, Privacy |
| [P-009](#p-009-privacy-text-says-saved-base-where-the-interface-says-home) | Privacy text says "saved base" where the interface says "Home" | logged | 215, 212 | Privacy, user guide |
| [P-010](#p-010-separate-google-calendar-grant-for-daily-brief) | Separate Google Calendar grant for Daily Brief | drafted | 187 | Privacy, Settings |
| [P-011](#p-011-behavior-descriptions-sent-for-duration-estimates) | Behavior descriptions sent for duration estimates | logged | 188, 184 | Privacy, Daily Brief Settings |
| [P-012](#p-012-daily-brief-trip-conclusions-come-from-the-timeline-calendar-connection) | Daily Brief trip conclusions come from the Timeline Calendar connection | logged | 219, 187 | Privacy |
| [P-013](#p-013-ai-client-re-consent-keeps-already-granted-permissions) | AI client re-consent keeps already granted permissions | logged | 232 | In-app consent copy, user guide |
| [P-014](#p-014-ai-client-consent-offers-every-write-permission-switched-on) | AI client consent offers every write permission, switched on | logged | 259 | Marketing (developer docs), user guide, provider submissions |
| [P-015](#p-015-plain-travel-timing-copy-and-development-only-weather-advice) | Plain travel timing copy and development-only weather advice | logged | 260, 261 | User guide |
| [P-016](#p-016-opt-in-leave-reminders) | Opt-in leave reminders | logged | 275, 277–280 | Privacy, Travel Settings, user guide, marketing |
| [P-017](#p-017-calendar-reads-with-no-user-session) | Calendar reads with no user session | logged | 276, 277 | Privacy, provider submissions |
| [P-018](#p-018-last-estimates-and-per-trip-refresh) | Last estimates and per-trip refresh | logged | 267, 268, 271, 272 | Privacy, user guide |
| [P-019](#p-019-outlook-and-icloud-event-locations-read-for-routing) | Outlook and iCloud event locations read for routing | logged | 283 | Privacy, user guide, provider submissions |
| [P-020](#p-020-remembered-places-and-attendance) | Remembered places and attendance | logged | 281 | Privacy, user guide |
| [P-021](#p-021-next-trip-marks-wider-directions-and-other-travel-guide-wording) | Next-trip marks, wider Directions and other travel guide wording | logged | 269–271, 273, 274, 282 | User guide |
| [P-022](#p-022-weather-margin-can-mean-arriving-later) | Weather margin can mean arriving later | logged | 265 | User guide |
| [P-023](#p-023-no-attendance-question-and-no-travel-for-events-without-a-location) | No attendance question, and no travel for events without a location | logged | D12 (follows 273) | User guide |
| [P-024](#p-024-leave-reminder-switch-and-readiness-list-in-travel-settings) | Leave reminder switch and readiness list in Travel Settings | logged | 279 | Travel Settings, user guide |
| [P-025](#p-025-corrected-places-are-remembered-for-their-location-text) | Corrected places are remembered for their location text | logged | 281 | Privacy, in-app copy, user guide |
| [P-026](#p-026-outlook-and-icloud-events-get-leave-reminders-and-mac-cached-locations) | Outlook and iCloud events get leave reminders, and Mac-cached locations | logged | 283 | Privacy, Travel Settings, user guide, provider submissions |
| [P-027](#p-027-mac-screen-recovery-message) | Mac screen recovery message | logged | 285 | In-app copy (Mac), user guide |
| [P-028](#p-028-day-notes-in-the-timeline-mcp-and-exports) | Day notes in the Timeline, MCP and exports | logged | 292 | User guide, MCP docs, consent copy, Privacy, marketing |
| [P-029](#p-029-daily-brief-facts-sent-to-openai-under-the-users-chatgpt-account) | Daily Brief facts sent to OpenAI under the user's ChatGPT account | logged | 294, 297, 298, 299 | Privacy, Trust, provider submissions |
| [P-030](#p-030-daily-brief-disclosure-on-a-mac-using-a-chatgpt-plan) | Daily Brief disclosure on a Mac using a ChatGPT plan | logged | 294, 299 | In-app copy (Mac) |
| [P-031](#p-031-user-guide-for-using-a-chatgpt-plan) | User guide for using a ChatGPT plan | logged | 294, 299 | User guide |
| [P-032](#p-032-marketing-claim-use-your-chatgpt-plan) | Marketing claim "Use your ChatGPT plan" | logged | 294, 299, 300 | Marketing |
| [P-033](#p-033-settings-groups-trust-links-delete-account-link-and-auto-save) | Settings groups, Trust links, Delete account link and auto-save | logged | 301, 302, 303, 309 | In-app copy, user guide |
| [P-034](#p-034-note-shortcuts-on-for-everyone) | Note shortcuts on for everyone | logged | 305 | In-app copy, user guide, Privacy |
| [P-035](#p-035-one-daily-brief-choice-for-connected-sources-and-one-google-calendar-connection) | One Daily Brief choice for connected sources, and one Google Calendar connection | logged | 306, 307 | Privacy and Terms, in-app copy, user guide, marketing, provider submissions |
| [P-036](#p-036-home-from-the-current-location) | Home from the current location | logged | 308 | Privacy, in-app copy, user guide |
| [P-038](#p-038-hevy-workouts-can-complete-linked-behaviors) | Hevy workouts can complete linked Behaviors | logged | 310, 317, 323 | Privacy, in-app copy, user guide, marketing |
| [P-039](#p-039-stored-hevy-workout-times-and-routine-digests) | Stored Hevy workout times and routine digests | logged | 310, 314, 320, 322 | Privacy, Trust, user guide, marketing |
| [P-040](#p-040-hevy-routine-titles-shown-in-the-link-form) | Hevy routine titles shown in the link form | logged | 310, 315, 317 | Privacy, in-app copy, user guide |
| [P-041](#p-041-hevy-is-read-in-the-background-over-30-days) | Hevy is read in the background, over 30 days | logged | 310, 316, 321 | Privacy, in-app copy, user guide |
| [P-042](#p-042-marketing-claim-log-a-workout-once) | Marketing claim: log a workout once | logged | 310, 323 | Marketing |
| [P-043](#p-043-connector-completion-in-app-copy) | Connector completion in-app copy | logged | 317, 318 | In-app copy, user guide |

P-003 holds the content of `docs/LEGAL.md` L-011, moved here on October 22, 2026.

Since October 24, 2026, 22:13 UTC (PRs #135 and #138 merged and deployed, owner
decision), P-001 to P-004 and P-012 describe live production behavior. The text they
cite has not changed.

## P-001: "I'm here" place positions and completion place labels

- **Change:** Ticket 216 (draft PR #137) stores location-derived data with the
  account, only after the user turns labels on.
  - "I'm here" markers: the device position recorded for Home or a saved place when
    the user selects "I'm here". Positions are stored as integer microdegrees and
    accuracy as whole meters. Recording again replaces the marker.
  - Completion place labels: one label per qualifying Completed occurrence, `home`,
    `saved_place:<id>` or `elsewhere`. Labels are derived location history.
  - The label setting with its retention choice, and dismissed Where suggestions.

  Hosted tables `place_label_settings`, `place_markers`, `completion_place_labels` and
  `where_suggestion_dismissals` use owner-only RLS. Desktop keeps the same data in
  SQLite. Account sync adds four entity kinds, and desktop SQLite backups include the
  data. Full JSON, CSV, JSONL and BehaviorLog exclude it until Ticket 244. MCP does
  not expose markers or labels.
- **New read moments:** at completion, Cadence reads the device position once in the
  foreground, only if location permission is already granted, and never prompts. When
  the user selects "I'm here", the system location prompt may appear, because the user
  asked for it. Cadence compares positions with the device-recorded markers, never with
  Google coordinates (`docs/LEGAL.md` L-003, resolved).
- **Retention and deletion:** the user chooses when turning labels on: 90 days (the
  default), 1 year, or until the user deletes them. A shorter choice deletes older
  labels in the same save. A daily job deletes hosted labels past the window; desktop
  deletes them when it loads labels. Changing a status away from Completed deletes that
  occurrence's label. Settings deletes all markers on request and has a Delete labels
  control. Turning labels off deletes labels, markers and dismissals.
- **Model input:** Ticket 219 sends per-Behavior label counts, for example "logged at
  home 9 of 10 times", without place keys, positions or text (P-004). Owner decision,
  October 23, 2026: the counts cover two periods, labeled separately, the 60-day
  suggestion window and the user's full retained label history. With the "1 year" or
  "until I delete them" choice, the model therefore receives counts from up to that
  whole history.
- **Affected:** Tickets 216, 219 and 244. Files: `components/settings/LegalContent.tsx`,
  `components/settings/TravelSettingsPanel.tsx`, `docs/user-guide/travel.md`,
  `docs/user-guide/data-portability.md`, `docs/PRODUCT_SPEC.md`, the travel redesign
  storage-boundary table in `docs/TICKETS.md`, `apps/marketing/src/data/developers.ts`
  and marketing privacy claims (P-006).
- **Conflicting current text:**
  - Privacy, "Travel routing": Cadence reads the device location "only while Cadence
    is open in the foreground: during an explicit permission check, during a travel
    refresh, and once when the Timeline opens". It "does not save device locations."
    The completion read and the "I'm here" read are new read moments. A saved marker
    is a saved device location.
  - Privacy, "Travel routing": "Device locations and route estimates stay in temporary
    memory and are excluded from Cadence sync, exports, backups, analytics, and logs."
    Markers and labels sync with the account and enter desktop backups.
  - Privacy, "Retention" table, row "Device locations and route estimates": "Memory for
    the current app session" and "Not saved to Cadence's database, synchronization,
    exports, or backups". No row covers markers or labels.
  - Travel Settings: "Device positions and route results stay temporary and never
    enter exports or synced backups."
  - `docs/user-guide/travel.md`, "Recipients and retention": "Cadence keeps device
    samples and route results in temporary memory and excludes them from sync,
    exports, backups and telemetry." "Refresh travel estimates": "Device position is
    read only on that open and during a refresh." PR #137 updates the user guide; the
    approved privacy content stays unchanged.
  - `docs/TICKETS.md`, travel redesign storage-boundary table: it lists device position
    as temporary. PR #129 adds a marker row, but the table does not mark markers as a
    stored exception or labels as derived location history.
  - Privacy, "Exports and connected AI clients", and `developers.ts`: MCP "excludes
    travel settings, route estimates, device location". The text does not say that
    markers and labels are excluded too.
  - Marketing privacy claims about location handling need review (P-006).
- **Update needed:** name markers and labels as stored account data and say what each
  holds. Describe both new read moments. List the retention choices and the delete
  controls. State sync and desktop backup handling, and Full JSON once Ticket 244
  ships. State that MCP does not expose markers or labels. Correct the Travel Settings
  line and the storage-boundary table. Add label counts to the model-data disclosure
  (P-004).
- **Status:** logged.

## P-002: Leave-time feedback taps and learned travel habits

- **Change:** Ticket 217 (draft PR #136) stores new account data: the get-ready time,
  the arrival buffer, a travel mode per place and leave-time answers.
  - Places: for a Calendar event place, Cadence stores a one-way digest of the location
    text, the same digest as the place cache. The digest is pseudonymous, not
    anonymous: a known address can be matched against it.
  - Leave-time answers: each holds a SHA-256 of the event or occurrence reference, the
    local date, the answer, the time and the rules version. No title, event time or
    location.
  - Storage: columns on `travel_settings` with owner RLS, SQLite migration 0019 on
    desktop and the profile sync entity. Native desktop backups include the habits.

  Ticket 219 later sends the usual mode per place and the get-ready time to the Daily
  Brief model (P-004).
- **Retention and deletion:** Cadence keeps the newest 30 answers and remembers a mode
  for at most 100 places, dropping the oldest choice. Settings has a forget control
  for each place. Account deletion removes everything. There is no single "clear
  learned habits" control. Ticket 217 marks the 30 and 100 limits as Cadence
  assumptions, not owner-confirmed.
- **Export:** learned habits, Home and usual travel are not in any export yet. The
  travel redesign storage-boundary table in `docs/TICKETS.md` nevertheless calls them
  exportable. Ticket 244 covers only labels and markers; no ticket yet covers habits,
  Home and usual travel.
- **Affected:** Tickets 217 and 219. Files: `components/settings/LegalContent.tsx`,
  `components/settings/TravelSettingsPanel.tsx`, `docs/user-guide/travel.md`,
  `docs/user-guide/data-portability.md`, the storage-boundary table in
  `docs/TICKETS.md`.
- **Conflicting current text:**
  - Privacy, "Travel routing": stored travel data is described as user-authored
    locations, Google place identifiers and the monthly usage total. Learned habits and
    leave-time answers are not mentioned.
  - Travel Settings on PR #136 now says "Cadence saves only the places you enter and
    the travel habits you tell it." Policy text that says Cadence stores only typed
    places needs the same update.
  - Privacy, "Retention" table: no row covers learned habits or answers.
  - Privacy, "Optional Google Calendar": "Cadence does not store Google event details in
    its hosted database." Cadence now stores a digest of an event's location text and a
    SHA-256 of the event reference. Check whether the sentence still holds.
  - `docs/user-guide/travel.md`, "Recipients and retention": lists the same stored
    travel data and omits habits and answers.
- **Update needed:** describe the habits and answers, what an answer contains, the
  pseudonymous place digest, the per-place forget control, the retention limits,
  account deletion, sync and desktop backup handling, and the missing export. Describe
  the model facts derived from them (P-004).
- **Status:** logged.

## P-003: Open-Meteo recipient, log retention and attribution

- **Change:** Ticket 218 (draft PR #133) rounds the device position to a 0.1° grid,
  about 11 km, and sends only that area to Open-Meteo. Open-Meteo's logs may keep the
  area for 90 days. The forecast sets a fixed travel margin from a versioned table and
  may suggest another mode. Ticket 219's second stage sends the weather outlook to the
  Daily Brief model (P-004). Development and testing use the free Open-Meteo plan
  (`docs/LEGAL.md` L-008).
- **Fact for the policy text:** the shared forecast cache holds only the area key and
  the forecast, in server memory. It keeps one forecast per area per clock hour and
  drops it when the hour ends. It is never tied to a user or account, and it is never
  synced, exported or backed up (`lib/services/weather-forecast.service.ts` on PR
  #133).
- **Question (from L-011):** what must the privacy content and the interface say once
  Cadence sends coarse areas to Open-Meteo and uses its forecasts?
- **Affected:** Tickets 218 and 219. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Travel routing" and "Processors"), the Settings travel disclosure in
  `components/settings/TravelSettingsPanel.tsx`, marketing privacy claims (P-006),
  `docs/user-guide/travel.md`, `docs/PRODUCT_SPEC.md`, the travel margin line in
  `components/timeline/TravelWeather.tsx` and the Daily Brief.
- **Sources** (moved from L-011, checked 2026-10-17):
  - [Open-Meteo terms](https://open-meteo.com/en/terms): logs may contain coordinates
    and are deleted after 90 days.
  - [Open-Meteo licence](https://open-meteo.com/en/licence): CC BY 4.0 credit, a
    licence link, a note of changes, and a link next to any displayed data.
  - Maps Platform Terms 4.4(c)(iii): notify users in advance about "the combination
    and use of End User's location with any other data provider's data".
- **Conflicting current text:**
  - Privacy, "Processors" table: Open-Meteo is not listed.
  - Privacy, "Travel routing": Google Maps Platform is the only named recipient of
    location data.
  - The Settings travel disclosure does not name Open-Meteo.
  - Marketing privacy claims do not name Open-Meteo.
  - `docs/user-guide/travel.md`, "Recipients and retention", names Google Maps only.
    PR #133 adds a "Weather margin" section that names Open-Meteo, the 0.1° area and
    the 90-day logs. The guide will match once that PR merges; the other surfaces
    will not.
- **Update needed:** name Open-Meteo as the recipient of the 0.1° area and state its
  90-day log retention in the Privacy page, the processors table, the Settings travel
  disclosure and marketing claims. Describe the shared cache using the fact above.
  Give the advance notice under Maps Platform Terms 4.4(c)(iii) in the travel
  disclosure; it applies because travel combines device position with Google routing.
  PR #133 places "Weather data by Open-Meteo.com (CC BY 4.0)" beside the weather lines.
  The Daily Brief needs the same credit when weather facts reach it. The L-011 reading
  rated the risk medium until the disclosure ships.
- **Status:** logged.

## P-004: Daily Brief model-data disclosure and re-consent

- **Change:** Ticket 219 adds travel facts to the Daily Brief model input sent to
  OpenAI, in two stages.
  - Stage 1 (draft PR #132): Behavior Where, usual travel and Cadence's yes/no travel
    fit conclusions.
  - Stage 2: learned habits (usual mode per place and get-ready time), the weather
    outlook and label counts. Extend this entry when stage 2 is implemented.
  - Owner decisions, October 23, 2026 (`docs/DECISIONS.md`): label counts cover both
    the 60-day suggestion window and the full retained label history, labeled
    separately. Live route and weather conclusions reach the model through a
    server-signed conclusions token returned with the brief request, once the
    server-only secret is provisioned. The token holds only Cadence's conclusions.

  Under `docs/LEGAL.md` L-001, Google route data reaches the model only as Cadence's
  own conclusions. Route durations, leave-by times, addresses, coordinates and place
  IDs are never sent. Existing users consent again.
- **Affected:** Ticket 219, with facts from Tickets 216, 217 and 218. Files:
  `components/settings/LegalContent.tsx` (Privacy, "Optional Daily Brief", "Travel
  routing" and the OpenAI row of "Processors"),
  `components/briefing/DailyBriefSettingsPanel.tsx`,
  `components/settings/TravelSettingsPanel.tsx`, `docs/user-guide/timeline.md`,
  `docs/user-guide/travel.md`. Marketing AI claims (P-006) and the Trust statement
  (P-005) depend on this entry.
- **Conflicting current text:**
  - Privacy, "Optional Daily Brief": "Cadence sends today's Behavior schedule and
    completion history, including findings calculated from it, to OpenAI." Travel,
    habit and weather facts are not listed.
  - Privacy, "Processors", OpenAI row: lists Behavior, Calendar, reminder and note data
    only.
  - Daily Brief Settings disclosure (`DailyBriefSettingsPanel.tsx`, about line 141 on
    PR #132): it opens with the same sentence and names the optional sources. It does
    not name Behavior Where or usual travel.
  - Travel Settings (`TravelSettingsPanel.tsx`, about line 107 on PR #132): "Travel
    places and route results are not sent to the Daily Brief model." This stays true
    for places and route results, but usual travel is now sent.
  - `docs/user-guide/travel.md`: "Raw locations and route results are not sent to the
    Daily Brief model. Deterministic travel facts stay separate from the briefing."
    The second sentence is no longer true. The guide also says the day's estimates
    "are not sent to the model."
  - `docs/user-guide/timeline.md`, "Daily Brief": lists what Cadence sends to OpenAI
    without travel facts.
- **Update needed:**
  - Name Behavior Where, usual travel and the travel fit conclusions in the Daily
    Brief Settings disclosure, the Privacy page and the OpenAI processor row.
  - Say in the Travel Settings line that usual travel is sent, while places and route
    results are not.
  - Say that label counts cover the full retained history as well as the last 60
    days.
  - Say that live route and weather conclusions are sent once the signed token is
    active.
  - Before live route conclusions ship, cover them in every disclosure, the Privacy
    page and marketing's AI claims (P-005, P-006).
  - Add the stage 2 facts when they ship.
  - State what is never sent: addresses, coordinates, place IDs, route durations,
    leave-by times and raw provider responses.
  - Add the re-consent step for existing users. Keep the statement that exact
    leave-by times stay in the calculated line.
- **Status:** logged.

## P-005: Public statement that Cadence sends no behavior data to an AI provider

- **Change:** none new. Daily Brief already sends Behavior schedule and completion
  history to OpenAI, and connected AI clients read tracking records through MCP. A
  public statement suggests the opposite.
- **Affected:** Ticket 187. `docs/LEGAL.md` L-012 and Ticket 219 cite Ticket 187; its
  section in `docs/TICKETS.md` names the public no-AI disclosure as a release gate. Files:
  `components/settings/LegalContent.tsx` (Trust, "Data boundaries"),
  `tests/legal-content.test.tsx`.
- **Conflicting current text:** Trust, "Data boundaries": "Cadence does not send
  exported behavior data to an AI provider." The test asserts this sentence. The
  sentence is limited to exported data, but a reader can take it as a general promise.
- **Update needed:** rewrite the sentence so that it agrees with the Daily Brief and MCP
  disclosures, and update the test. The rewrite must also cover Ticket 219's travel
  facts in model input (P-004).
- **Status:** resolved. The text below went live on October 24, 2026 at 18:16 UTC
  (PR #147, main `6f2e770b`, app deployment `dpl_GGNbBrLyA7knWGzghH6gWKp7vq5X`, then
  `dpl_9SvrL4ekjjQg5utxsH7hpvnnvrR6` for the Trust refresh). Earlier record: on
  October 24, 2026, for Google's verification of the Daily
  Brief Calendar client (Ticket 187), the Trust sentence was rewritten: exports go only
  where the user sends them; Daily Brief sends the context the Privacy Policy describes,
  Calendar timing only after a separate choice; MCP clients receive records only after
  authorization; Cadence does not use Google user data to train AI models. The same
  change describes both Google Calendar connections in Privacy, "Optional Google
  Calendar", and adds the AI training limit there and in
  `docs/user-guide/privacy-and-account.md`. The owner approved the text on October 24,
  2026. Travel facts stay with P-004.

## P-006: Marketing review of AI and travel claims

- **Change:** before launch, review every public AI and travel claim against shipped
  behavior. Travel adds weather and model input (Tickets 218 and 219). Marketing has
  no travel copy today.
- **Affected:** Tickets 219, 165 and 187. Files: `apps/marketing/src/pages/about.astro`,
  `apps/marketing/src/data/faq.ts`, `apps/marketing/src/data/routes.ts`,
  `apps/marketing/src/data/developers.ts`.
- **Conflicting current text:**
  - About page, FAQ "Can I analyze my Record with an AI service?" and `routes.ts`:
    "When enabled, Daily Brief separately sends selected tracking information to
    OpenAI; Calendar timing and other optional sources require separate choices."
    Travel and weather facts will be a new source.
  - About page: Cadence is not an "AI coach". Check that the travel advice in Ticket
    219 keeps that claim true.
  - `developers.ts`: device coordinates and route computations are excluded from MCP.
    Check against P-001.
- **Update needed:** align the claims with the updated Privacy page. Cover Ticket
  219's travel conclusions before live route conclusions ship (P-004). Name Open-Meteo
  in privacy claims (P-003). Review location-handling claims against stored markers
  and labels (P-001). Add travel copy only with deployed evidence, as Ticket 165
  requires.
- **Status:** logged.

## P-007: First-run setup invites a Home address

- **Change:** Ticket 212 adds an optional "Home and travel" item to first-run setup. It
  links to Settings, Travel and invites the user to save a Home address and usual
  travel. Stored data, its use and its recipients are unchanged: saving Home sends
  nothing to Google, requests no device location and enables no routing.
- **Affected:** Ticket 212 (draft PR #130). Files: `lib/services/onboarding-model.ts`,
  `components/settings/LegalContent.tsx` (Privacy, "Travel routing"),
  `docs/user-guide/navigation-and-setup.md`.
- **Conflicting current text:** Privacy, "Travel routing": "It uses the selected
  transport mode, an optional saved base for the final return, and the device's
  current location". The text treats the base only as a routing input and does not
  say that setup asks for it.
- **Update needed:** say that first-run setup offers to save Home and usual travel,
  that saving them sends nothing to Google, and that routing still needs the Travel
  estimates toggle and its disclosure.
- **Status:** logged.

## P-008: Setup purpose line does not name Google Maps

- **Change:** the Ticket 212 setup item says: "Cadence uses these to estimate travel
  time to and from located Behaviors and Calendar events." It does not name Google
  Maps. The Google disclosure stays beside the Travel estimates toggle, and saving Home
  sends nothing to Google.
- **Affected:** Ticket 212 (draft PR #130). Files: `lib/services/onboarding-model.ts`
  (`FIRST_RUN_TRAVEL_DESCRIPTION`), `components/settings/LegalContent.tsx` (Privacy,
  "Travel routing"). Related: `docs/LEGAL.md` L-012 (Google Maps notices).
- **Conflicting current text:** none contradicts it. The gap is the omission: the
  purpose line describes travel estimates without naming the provider that computes
  them.
- **Update needed:** in the privacy pass, decide whether the setup line names Google
  Maps or relies on the disclosure beside the toggle, and record the reason.
- **Status:** logged.

## P-009: Privacy text says "saved base" where the interface says "Home"

- **Change:** Ticket 215 (PR #112) renames the saved base to Home in Travel Settings
  ("Home (optional)") and replaces Behavior Location with Where. Ticket 212's setup
  item also says Home. The privacy text and some user-guide pages keep the old words.
- **Affected:** Tickets 215 and 212. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Travel routing"), `docs/user-guide/data-portability.md`,
  `docs/user-guide/desktop-local.md`.
- **Conflicting current text:**
  - Privacy, "Travel routing": "an optional saved base for the final return" and
    "user-authored locations, such as Behavior locations and the saved base".
  - `docs/user-guide/data-portability.md`: "Travel settings and the saved base remain
    in native database backups".
  - `docs/user-guide/desktop-local.md`: "Import preserves the saved base".
- **Update needed:** use Home, Where and usual travel, the words the interface shows.
- **Status:** logged.

## P-010: Separate Google Calendar grant for Daily Brief

- **Change:** Ticket 187 (PR #135) gives Daily Brief its own Google Calendar connection.
  It uses a separate Google Cloud project and client, separate consent, calendar selection,
  encrypted credential and Disconnect. The Timeline Calendar connection never reaches the
  model. The migration withdraws existing Daily Brief Calendar choices, so users must
  connect again and allow Calendar again.
- **Affected:** Ticket 187. Files: `components/settings/LegalContent.tsx` (Privacy,
  "Optional Google Calendar" and "Optional Daily Brief").
- **Conflicting current text:**
  - Privacy, "Optional Google Calendar": "The Google Calendar connector is optional",
    "encrypted Google refresh credential" and "Disconnect Google Calendar marks the
    account connection disconnected" describe one connection.
  - Privacy, "Optional Daily Brief": "Connecting a source or displaying it on Timeline
    does not grant model access." Daily Brief now also needs its own Google connection.
- **Update needed:** describe both Google Calendar connections, their separate consent,
  selection, credential and Disconnect, and the one-time renewed choice.
- **Status:** drafted. PR #147 (October 24, 2026, to `main`) describes both connections
  in Privacy, "Optional Google Calendar", and in `docs/user-guide/privacy-and-account.md`,
  for Google's verification of the Daily Brief Calendar client. That text is live
  since October 24, 2026 (see P-005). It does not yet mention the one-time renewed
  choice. Daily Brief Settings now has its own Calendar disclosure line.

## P-011: Behavior descriptions sent for duration estimates

- **Change:** Ticket 188 (PR #135) sends Behavior titles and descriptions to OpenAI in
  one bounded call that estimates session lengths. It applies only to recipes 1.1 and
  1.2 (Ticket 184 candidates), when a Behavior has no default duration and too few
  tracked sessions. Today only the private workbench uses it, after a page-session owner
  confirmation. Production use needs a promoted recipe, a Daily Brief Settings choice
  and a migration for that disclosure.
- **Affected:** Tickets 188 and 184. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Optional Daily Brief" and the processor table's OpenAI row).
- **Conflicting current text:**
  - Privacy, "Optional Daily Brief": "Cadence sends today's Behavior schedule and
    completion history, including findings calculated from it, to OpenAI."
  - Processor table, OpenAI: "Behavior schedule, completion history and calculated
    findings; separately enabled Calendar timing, reminder counts, and selected note
    excerpts". Neither names Behavior titles or descriptions.
- **Update needed:** when a recipe with estimates is promoted, name Behavior titles and
  descriptions as a separate Daily Brief choice and add them to the OpenAI row.
- **Status:** logged.

## P-012: Daily Brief trip conclusions come from the Timeline Calendar connection

- **Change:** Ticket 219's signed travel conclusions token is built from the Timeline
  travel view, which reads Calendar event locations through the Timeline (standard)
  connection. When the Daily Brief connection's snapshot holds exactly the same events
  and revisions, the brief maps the token's event commitments to its own opaque refs
  and sends the conclusions to OpenAI: trips, yes/no fits, unknowns and weather rule
  conclusions, never durations, times or places. If the event sets differ, or Daily
  Brief Calendar is not allowed, the brief drops the whole token. Code:
  `withSuppliedConclusions` and `readCurrentTravelSource` in
  `lib/services/briefing-account-context.service.ts`. `TRAVEL_CONCLUSIONS_SIGNING_SECRET`
  is set in production. The owner chose on October 24, 2026 to ship this as it is.
- **Affected:** Tickets 219 and 187. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Optional Google Calendar" and "Optional Daily Brief"),
  `docs/user-guide/privacy-and-account.md` ("AI use").
- **Conflicting current text:**
  - Privacy, "Optional Google Calendar": "Where Google Calendar for Daily Brief is
    available, Daily Brief reads Calendar only through that connection, never through
    the Timeline connection". The trip conclusions are derived from Timeline
    connection reads.
  - `docs/user-guide/privacy-and-account.md`, "AI use": lists only event timing,
    timezone, availability and response state as Calendar input to the model.
- **Update needed:** either fence event-based trip conclusions out of Daily Brief, or
  say that trip conclusions about events present in both connections come from the
  Timeline connection's event locations and Google Maps (with P-004). Google's
  sensitive-scope review of `cadence-calendar-agent-prod` reads this Privacy text.
- **Status:** logged.

## P-013: AI client re-consent keeps already granted permissions

- **Change:** when an AI client asks again for more access (step-up), the consent
  screen lists the permissions the app already holds, marks them "(already
  granted)" and keeps them selected. Switching one off still removes it. Separately,
  the first sign-in challenge no longer names only read, so AI clients should ask
  for all three published permissions (writes on by default as before). Not yet
  verified live for ChatGPT (Ticket 256).
  Code: `components/oauth/ConsentForm.tsx`, `lib/services/oauth-ui.service.ts`,
  `lib/mcp/server.ts`, migration `20261030230000_oauth_reconsent_keeps_granted_scopes.sql`.
  The "(already granted)" label is the in-app copy the Ticket 232 follow-up requires.
- **Affected:** Ticket 232 follow-up (PR #170). Files:
  `docs/user-guide/privacy-and-account.md` ("Connect and disconnect an AI client").
- **Conflicting current text:** "Switch off either write permission to narrow access.
  Choose **Allow** to connect or **Deny** to refuse." It does not say that a repeat
  request shows earlier permissions as already granted and keeps them on.
- **Update needed:** add that when an app asks again for more access, permissions it
  already has are marked already granted and stay on unless the user switches them
  off. Directory submission text that describes consent should match.
- **Status:** logged.

## P-014: AI client consent offers every write permission, switched on

- **Change:** the consent screen now offers read and both write permissions for
  every connection request, even when the AI client asked only to read, and both
  write switches start on (owner decision, October 31, 2026). One click on Allow
  grants all three; the grant holds exactly what the user leaves on, and the client
  may receive more scopes than it requested. Code: `lib/services/oauth-ui.service.ts`,
  migration `20261031210000_oauth_consent_offers_advertised_scopes.sql`.
- **Affected:** Ticket 259 (PR #175). Files: `apps/marketing/src/data/developers.ts`
  ("Claude connector" and "Scopes and consent"), `docs/user-guide/privacy-and-account.md`
  ("Connect and disconnect an AI client"), and directory submission text that
  describes consent.
- **Conflicting current text:** developers.ts, "Claude connector": "Leave both write
  permissions off for a read-only trial." The writes now start on, so a reader must
  switch them off rather than leave them. "Scopes and consent": "Consent can remove
  either write scope." It does not say that consent may also grant writes the client
  did not request. The user guide's "Switch off either write permission to narrow
  access" stays accurate but does not say both start on.
- **Update needed:** say that both write permissions start on and must be switched
  off for a read-only trial; tell integrators the granted scopes (token response
  `scope`, `get_account_context` `granted_scopes`) may exceed the request; add to
  the user guide that writes start on even for read-only requests.
- **Status:** logged.

## P-015: Plain travel timing copy and development-only weather advice

- **Change:** Tickets 260 and 261 reword the travel lines and limit the weather mode
  advice ("Consider transit or driving instead of walking.") to development builds.
  Owner direction, November 4, 2026
  (`docs/plans/2026-11-04-travel-departure-ux-review.md`). Corrected the same day: an
  earlier draft of this entry and Ticket 261 said "3 hours before the trip", but the
  window counts back from the arrival target (correction C3). Ticket 261 shipped on
  branch `us-work`, November 5, 2026, with these words. The owner approved the wording on
  November 5, 2026 ("Apply R1–R3, approve the rest"; `docs/DECISIONS.md`). The full list is
  `DEPARTURE_PHRASE_REVIEW` in `packages/core/src/services/departure-phrases.ts`.
  - Owner changes R1–R3: "Refresh travel to get the leave time." (was "The leave time is
    ready to check."), "Fix Gym's place or attendance to get a leave time for Dentist."
    (was "… depends on Gym."), and "No leave time for this trip." (was "Leave time
    unknown."), with "No leave time for this trip, because you may arrive late at Gym."
  - Trips: "Leave by 1:15 PM · walking, arrive 2:20 PM.", "Leave by 1:15 PM from Home
    · walking, arrive 2:20 PM.", "Head home 4:40 PM · walking, home by 6:35 PM." The
    date shows only for a trip on another local date. "Origin: …" is gone.
  - Countdown, leave now and late forms from the departure model (Ticket 265), for
    example "You may arrive late: leave by 6:50 PM · cycling, arrive 7:40 PM." Ticket
    260's separate late line is now this one line.
  - Missing estimates: "Last estimate: leave by {time} · checked {time}. Refresh
    travel", "Estimate expired. Refresh travel", "Trip changed. Refresh travel", "No
    route found.", "Leave time appears by {time}.", "Return time unknown." and "Return
    time unknown. Add Home in Settings to estimate it."
  - Weather: "15 min added for thunderstorms.", once per event, in every build; the
    Daily Brief line reads "Leave by 2:05 PM for Dentist (cycling). 10 min added for
    rain." The credit reads "Weather data by Open-Meteo.com (CC BY 4.0)." without
    "Cadence derived travel margins from the forecast."
  - "Free again 6:45 PM." and "Google Maps · checked 8:00 AM."
  - Expanded Behavior row: "Overlaps your trip to {event} ({start}–{end})", "Overlaps
    your trip home ({start}–{end})", and "Return time unknown." in place of "Travel
    timing incomplete".
  - Daily Brief footer: "Calculated by Cadence · Google Maps · 9:00 AM."
  - Status line: no line on a day with no trips unless it has a message. Production
    shows "Travel estimates are unavailable right now. Tracking and Calendar still
    work." in place of "Travel estimates await this deployment's provider review."
  - Calendar details: "Applies to this event until you close the Timeline.", all-day
    days as "Nov 1 – Nov 2" (or "Nov 1"), and "Tentative" or "Cancelled" beside the time.
- **Affected:** Tickets 260 and 261. Files: `docs/user-guide/travel.md`.
- **Surfaces:** user guide.
- **Conflicting current text:** `docs/user-guide/travel.md`:
  - "Refresh travel estimates": "Later trips say "estimated within 3 hours of
    departure" until then."
  - "Refresh travel estimates": "The status line shows Travel as of and the time the
    estimates were observed." It does not say that a day with no trips shows no line.
  - "Weather margin": the table's Suggestion column, "A suggestion appears only for
    the modes its row names." and "Travel timing shows the adjusted leave time with, for
    example, "Includes 10 min for rain.""
  - "Inspect travel and correct a journey": "Text identifies travel-created overlap."
    It does not show the new overlap wording. "for that journey and event revision"
    differs from "Applies to this event until you close the Timeline."
- **Update needed:** quote the new phrases. Say that production shows the weather
  margin without a mode suggestion. Describe the overlap line as naming the trip and
  its times, and the status line as silent on a day with no trips.
- **Status:** logged.

## P-016: Opt-in leave reminders

- **Change:** owner decision D3, November 4, 2026 ("Yes, even with Cadence closed").
  Tickets 275 and 277–280 add an opt-in reminder to get ready to leave, off by default. Web
  sends it by web push from a hosted job. Mac schedules a native notification from the last
  estimate. Cadence stores a hosted preference and a reminder record: owner, trip digest,
  local date, next check time, status, sent time and error. It holds no titles, places,
  positions or durations. The notification text shows the event title, leave time, mode,
  duration, start and arrival.
- **Affected:** Tickets 275 and 277–280. Files: `components/settings/LegalContent.tsx`,
  `components/settings/TravelSettingsPanel.tsx`, `docs/user-guide/travel.md`, marketing
  travel claims (P-006). Related legal entry: L-015.
- **Surfaces:** Privacy, Travel Settings, user guide, marketing.
- **Conflicting current text:**
  - Privacy, retention table, has no row for a leave reminder preference or record.
  - Privacy: "Device locations and route estimates stay in temporary memory". A Mac
    notification keeps a time derived from an estimate until it fires.
  - `docs/user-guide/travel.md` has no reminder section.
- **Update needed:** describe the setting, what it stores, when it sends, where the
  estimate starts, and that a Mac notification names its estimate time. Add a retention
  row. Say which calendars get reminders.
- **Ticket 275 note (November 6, 2026):** the stored fields are now fixed. The preference
  row holds the switch, when it was turned on and the job's next check time. Each reminder
  row also holds a route count and a claim time. Turning reminders off deletes the reminder
  rows; otherwise rows older than the previous local date are deleted. Only trips to a
  located destination get a reminder (D12), and the trip home gets none. Under D15, web
  and Mac each send at most one update when a later estimate moves the leave time 10
  minutes or more earlier; the web job estimates the trip once more after sending to check,
  and the reminder row records when the update sent. Turning reminders off and on the same
  day can repeat a reminder.
- **Ticket 280 note (November 6, 2026):** the Mac keeps, on the device only, each trip's digest,
  fire time and the leave time its reminder named, so a dismissed reminder is not sent again.
  Its text names the start (Home, your previous stop or your position) and when the estimate was
  checked, with no route duration. Travel estimates off on the Mac also stops its reminders.
  The three Mac phrases are listed in `departure-phrases.ts`, not yet approved (D7).
- **Ticket 277 note (November 6, 2026):** after sending, the record keeps the reminder time
  it named as its one check, until the update route runs. The update estimate stops at 80%
  of the monthly travel budget (D16), so near month end an update may not arrive. A trip
  that was dropped after its first estimate and then comes back gets no reminder. Failed
  reminders record a short code such as `no_subscription`.
- **Ticket 278 note (November 6, 2026):** the web notification names the leave time, the event
  title, the mode, the route time in minutes, the start (Home or the previous stop's title) and
  the arrival time. The titles travel only in the encrypted push payload; the link carries the
  trip digest only. The push service holds the notification at most until the leave time. The
  three web phrases are listed in `departure-phrases.ts`, not yet approved (D7).
- **D17 note (November 6, 2026):** the owner approved all Wave 4 wording: the three web and three
  Mac reminder phrases above and the twelve P-024 setting phrases. No travel phrase awaits
  approval.
- **Status:** logged.

## P-017: Calendar reads with no user session

- **Change:** owner decision D3, November 4, 2026. Tickets 276 and 277 let a hosted job read
  Calendar and route trips for an opted-in account with no user session. It reads the
  title only at send time, in memory.
- **Affected:** Tickets 276 and 277. Files: `components/settings/LegalContent.tsx`, Google
  OAuth verification materials. Related legal entry: L-016.
- **Surfaces:** Privacy, provider submissions.
- **Conflicting current text:**
  - Privacy, Google Calendar: "Vercel runtime processes Calendar API requests and returned
    event details while serving a refresh or preparing a briefing." A leave reminder check
    is a new processing moment.
  - Google OAuth verification text, if it describes reads only while the user is active.
    Not checked.
- **Update needed:** add the reminder check as a processing moment. State that it happens
  only for accounts that turned the reminder on, and that Cadence still stores no Google
  event details. Update the verification materials before the next submission.
- **Ticket 277 note (November 6, 2026):** the job reads Calendar, Behaviors and Occurrences
  for an opted-in account at least every 30 minutes, and again at send time, all day
  while reminders stay on. It reads titles only at send time.
- **Ticket 283 note (November 6, 2026):** the job now reads Outlook and iCloud Calendar the same
  way, with no user session. See P-026.
- **Status:** logged.

## P-018: Last estimates and per-trip refresh

- **Change:** owner decision D1, November 4, 2026 ("Last estimate and per-trip refresh").
  Ticket 268 keeps route results in `sessionStorage` across a reload, in the browser session
  only, and labels older times "Last estimate". Ticket 267 replaces the 3-hour rule with a
  whole-day pass and refreshes near a trip's leave time. Ticket 272 keeps the Daily Brief
  travel block visible after expiry. Related legal entry: L-014.
- **Affected:** Tickets 267, 268, 271 and 272. Files: `components/settings/LegalContent.tsx`,
  `docs/user-guide/travel.md`.
- **Surfaces:** Privacy, user guide.
- **Conflicting current text:**
  - Privacy, "Travel routing": "Device locations and route estimates stay in temporary
    memory". Privacy, retention table: "Memory for the current app session".
    `sessionStorage` is browser storage, though it still ends with the session.
  - `docs/user-guide/travel.md`, "Refresh travel estimates": "Marking a Behavior, editing a
    Note or returning to the window does not request again." and "Each refresh estimates
    trips that leave, or must arrive, within the next three hours."
  - `docs/user-guide/travel.md`, same section: "marks it as possibly stale after five
    minutes" and "the line says they may be stale".
- **Update needed:** say that estimates stay in browser session storage until the session
  ends or the listed events clear them. Describe the whole-day pass, the near-departure
  refresh, and the "Last estimate" label.
- **Ticket 272 note, November 5, 2026:** the brief block now keeps last estimates and late
  trips. The day's first brief waits up to 5 seconds for the first whole-day travel result,
  so it usually carries the signed conclusions. The guide's "When the Timeline has current
  travel estimates, the brief request also carries Cadence's signed trip and weather
  conclusions" stays true; it could add that the first brief waits briefly for them. The
  model still receives no times. Not yet edited.
- **Ticket 267 note, November 5, 2026:** the plan is in source. The quoted words did not
  change. The guide should also say that at 80% of the month's travel budget Cadence stops
  refreshing on its own, and Refresh travel still works.
- **Ticket 268 note, November 5, 2026:** clients follow the plan. Today's estimates stay in
  browser session storage across a reload and are cleared by sign-out, an account change,
  travel turned off, a travel settings change or a new day. A trip refresh keeps the other
  trips' times. Returning to the window requests only when a trip is due. The quoted words
  did not change. The 80% pause shows nothing new (owner, November 5, 2026: "Nothing new",
  `docs/DECISIONS.md`); a response reporting the whole budget used shows the approved line
  "Travel estimates resume on {date}." A changed trip whose stop has no title reads "A
  planned trip changed." (approved as written).
- **Status:** logged.

## P-019: Outlook and iCloud event locations read for routing

- **Change:** owner decision D4, November 4, 2026 ("All of these should be covered"). Ticket
  283 reads event locations from Outlook and iCloud and sends them to Google Maps to route.
  Cadence stores no event details.
- **Affected:** Ticket 283. Files: `components/settings/LegalContent.tsx`,
  `docs/user-guide/travel.md`, Microsoft and Apple connector materials.
- **Surfaces:** Privacy, user guide, provider submissions.
- **Conflicting current text:**
  - Privacy, "Outlook Calendar, iCloud Calendar, and Hevy": "Cadence requests only event
    titles, times, timezone, availability, response, and calendar names." and "Cadence reads
    selected calendars and normalizes event titles, times, timezone and availability. It
    discards unsupported details."
- **Update needed:** add locations to both connector descriptions and name Google Maps as
  their recipient. Say that Outlook and iCloud events now get leave times.
- **Ticket 283 note (November 6, 2026):** implemented, not merged. The travel route, the leave
  reminder job and the Timeline's own Outlook and iCloud reads now ask for locations. Outlook
  adds `location` and `isOnlineMeeting` to its Graph `$select`; Cadence joins the location's
  display name and address into one text and treats an online meeting's placeholder (such as
  "Microsoft Teams Meeting", with no address) as no location. iCloud keeps the VEVENT's
  `LOCATION` text it already received. Located events then route under the Google rules: the
  text goes to Google Maps for a place lookup, and an event without a location is not travel
  (D12). The hosted server stores no event detail; the place lookup keeps only the one-way key
  and place ID Ticket 214 already stores. The Daily Brief read never asks for locations, so
  its Outlook and iCloud model input is unchanged. The Privacy sentences quoted above become
  untrue once this ships. P-026 covers the reminder, Mac cache and Settings changes.

## P-020: Remembered places and attendance

- **Change:** owner decision D4, November 4, 2026. Ticket 281 stores a corrected place ID
  under the original text's key, so later events with that text resolve too. It adds a
  hosted-only per-event attendance record keyed by a digest. Turning travel off deletes both.
- **D12 note (November 5, 2026):** a located event is now in person and nothing asks about
  attendance (P-023), so no attendance answer exists to remember. Only the remembered place
  part of this entry still applies.
- **Affected:** Ticket 281. Files: `components/settings/LegalContent.tsx`,
  `docs/user-guide/travel.md`.
- **Surfaces:** Privacy, user guide.
- **Conflicting current text:**
  - `docs/user-guide/travel.md`, "Inspect travel and correct a journey": "Use for this
    journey changes temporary routing only." and "Leave and reopen the Timeline to discard
    journey corrections."
  - In-app text: "Applies only to this event revision while the Timeline is open."
  - Privacy, retention table, has no row for attendance answers.
- **Update needed:** say that corrections and attendance answers are remembered, what is
  stored, and how to delete them. Add a retention row.
- **Status:** logged.

## P-021: Next-trip marks, wider Directions and other travel guide wording

- **Change:** owner decisions D2 and D4, November 4, 2026. Ticket 269 replaces "Travel as of"
  with a next-departure line. Ticket 270 adds a marker and span for the next trip. Ticket 271
  adds Directions to the drawer and located Behavior rows. Ticket 273 adds next-step prompts.
  Ticket 274 keeps the leave-time question through a reload, with digests and end times in
  browser storage. Ticket 282 adds tomorrow's first trip.
- **Affected:** Tickets 269–271, 273, 274 and 282. Files: `docs/user-guide/travel.md`.
- **Surfaces:** user guide.
- **Conflicting current text:** `docs/user-guide/travel.md`:
  - "Refresh travel estimates": "The status line shows Travel as of and the time the
    estimates were observed." Also, from Ticket 269: "After the estimates expire, the line
    says they may be stale", and "the Timeline keeps the last estimates, marked as possibly
    stale". The line now shows the next trip, marked "Last estimate" with its check time, and
    Refresh travel shows only when that trip needs it.
  - "Learned travel habits": "Cadence remembers such trips only while the app stays open,
    so a reload before the event ends means no question that day."
  - From Ticket 271, "Open navigation": "Event details show available Calendar location
    text and a Search in maps link" and "A verified route can offer Directions". The drawer
    and located Behavior rows now have the link too, and Directions stays after an estimate
    expires. "Inspect travel and correct a journey": "event details allow an in-person or
    remote choice and a destination correction"; that form now opens from Change for this
    trip.
- **Update needed:** describe the line, the marker, Directions on rows and the drawer,
  tomorrow's first trip, and the remembered question.
- **Ticket 274 detail (November 5, 2026):** the question now survives a reload. Today's
  candidates stay in the tab's browser session as event digests and end times only, so a
  reload or new Timeline view in that tab still asks once after the event ends. A new tab
  does not inherit them. Not now now also lasts through a reload in that tab. The title comes
  from the current Calendar or Behavior read; a deleted event asks nothing. Sign-out, another
  account, travel turned off and a new day clear them. The guide sentence "Cadence remembers
  such trips only while the app stays open, so a reload before the event ends means no
  question that day" is now wrong. The Privacy Google Calendar section ("The web app holds
  returned event details in memory") still holds as written: only digests of event IDs and
  end times are stored, so no Privacy edit is proposed.
- **Ticket 270 detail (November 5, 2026):** the Timeline shows the next trip's magenta span
  and one marker without hovering. The owner has not yet picked the marker (rail label "Leave
  1:15", a slim row "Leave 1:15 PM for Dentist", or an axis tick only), so the guide text waits
  for that choice. A Behavior the next trip crowds shows its overlap line while collapsed. The
  three marker phrases are on the bench wording review, not yet approved (D7).
- **Ticket 270 detail, decision D13 (November 6, 2026):** the owner chose the marker. The span
  starts at the leave time; a short magenta leader runs from its top into the left rail with a
  small label, "Leave 9:35". Leave now, late and passed times read "Leave now", "May arrive
  late", "Arrive about {time}", "Home about {time}" or "Head home now". The slim-row phrases
  are gone. The guide's Timeline text can now describe this form. The label phrases await
  approval (D7).
- **Ticket 273 detail (November 5, 2026):** a trip with no leave time now says why with one
  action. "Add a place for {event}" and "Fix {event}'s place or attendance" open that event's
  Change for this trip with the destination focused, or Behaviors for a Behavior. "Is {event}
  in person or remote?" ends with In person and Remote, which answer for this trip in one tap.
  "Add Home in Settings" opens Travel settings. With Travel estimates off and a located event
  ahead today, the Timeline offers once "Turn on Travel estimates in Settings to get a leave
  time for {event}." with Not now; it only opens Settings, so consent stays with the toggle.
  The first-run Home and travel row reads Estimates off, not Saved, while the toggle is off.
  The guide's "Inspect travel and correct a journey" and "Set up travel" sections do not
  describe these steps. Five phrases are on the bench wording review, not yet approved (D7):
  In person, Remote, the offer, its Not now, and Estimates off. P-007 keeps the first-run
  row's label and purpose text unchanged.
- **D12 note (November 5, 2026):** "Is {event} in person or remote?", In person and Remote are
  gone, and "Fix {event}'s place or attendance" now reads "Fix {event}'s place". See P-023.
- **Ticket 282 detail (November 6, 2026):** after 5 PM, or once today has no trip left, Cadence
  estimates tomorrow's first trip once, from Home, in a request of its own. When today's line
  has nothing to say, it reads "Tomorrow: leave by 8:10 AM for Dentist." (bench row
  `line-tomorrow`, approved as written, D20). Tomorrow's trip gets no leave reminder, never enters
  the Daily Brief and adds no weather margin. Like today's view, its route view stays in the
  tab's browser session, with the first stop kept only as a digest; sign-out, travel turned off,
  a settings change and a new day clear it. The guide's "Refresh travel estimates" section
  describes today only. The Privacy text about browser storage of travel estimates names no
  day, so no Privacy edit is proposed.
- **Ticket 270 detail, decision D14 (November 6, 2026):** the label is one line ("Leave 1:20")
  on wide layouts and stacked on phones. The trip home's label reads "Home {time}". The owner
  approved "Leave {time}", the late and passed forms, "Home {time}" and the two D12 steps. No
  travel phrase awaits approval.
- **Status:** logged.

## P-022: Weather margin can mean arriving later

- **Change:** Ticket 265 stops a weather margin moving a departure before the trip's ready time.
  When the margin does not fit before the departure, the leave time stays and the margin follows
  the arrival. On a trip with an arrival target, that can mean arriving later or arriving late.
- **Affected:** Ticket 265. Files: `docs/user-guide/travel.md`.
- **Surfaces:** user guide.
- **Conflicting current text:** `docs/user-guide/travel.md`, "Weather margin": "Bad weather
  before a trip adds a fixed margin: leave earlier for an arrival, or expect to arrive later on
  a trip home."
- **Update needed:** say that a margin that cannot fit before the leave time means arriving
  later, for any trip. Weather stays off until the owner turns it on.
- **Approved wording** (owner, November 5, 2026): the margin line reads "15 min added for
  thunderstorms.", and a trip the margin makes late reads "You may arrive late: leave by
  1:20 PM from Home · walking, arrive 2:05 PM." before the leave time, or "You may arrive
  late: arrive 2:05 PM." after it.
- **Status:** logged.

## P-023: No attendance question, and no travel for events without a location

- **Change:** owner decision D12, November 5, 2026. A Calendar event with a location is in
  person; one without a location is not travel. It asks nothing, gets no route and never holds
  up a later trip; the Timeline and Daily Brief still show it as an event. The attendance
  question ("Is {event} in person or remote?" with In person and Remote) and the attendance
  choice in Change for this trip are removed; the correction asks only for the destination.
  "Fix {event}'s place or attendance to get a leave time for {event}." becomes "Fix {event}'s
  place to get a leave time for {event}.". The trip home with no saved Home reads "Add Home in
  Settings to estimate the return time.", whose first words open Travel settings, in place of
  "Return time unknown. Add Home in Settings to estimate it.". The two new sentences are on the
  bench wording review, not yet approved (D7).
- **Affected:** decision D12. Files: `docs/user-guide/travel.md`.
- **Surfaces:** user guide.
- **Conflicting current text:** `docs/user-guide/travel.md`, "Inspect travel and correct a
  journey": "When routing is available, event details allow an in-person or remote choice and a
  destination correction for that journey and event revision."; "Refresh travel estimates":
  "an event's time, location or attendance changes".
- **Update needed:** drop the in-person or remote choice; say an event without a location is not
  travel; describe the no-Home return sentence and its Settings link.
- **Status:** logged.

## P-024: Leave reminder switch and readiness list in Travel Settings

- **Change:** Ticket 279, November 6, 2026. How you travel gains one checkbox, off by
  default: "Remind me when it is time to get ready to leave." Below it, a readiness list
  names this device's notifications ("Notifications: {device state}.", with a "Turn on
  notifications" link), whether Home is saved, and where the estimate starts. Web says
  "Reminders estimate from Home or your previous stop, never from this device's position."
  A linked Mac says it reminds from its last estimate and names when that estimate was
  checked. A line says only Google Calendar events and Behaviors get reminders, not Outlook
  or iCloud events. The switch cannot turn on while Travel estimates is off. It is one
  switch per account, saved on the hosted server, and hidden on an unlinked Mac. All twelve
  new phrases are on the bench wording review, not yet approved (D7).
- **Affected:** Ticket 279, with P-016. Files: `docs/user-guide/travel.md`, "Learned travel
  habits", which the interaction registry links for INT-TRAVEL-013.
- **Surfaces:** Travel Settings, user guide.
- **Conflicting current text:** `docs/user-guide/travel.md` describes How you travel as
  get-ready time, arrival buffer and travel per place, with no reminder switch.
- **Update needed:** describe the switch, the readiness list, the Travel estimates
  requirement, that it applies to every device on the account, and which sources get
  reminders. P-016 carries the Privacy and retention wording.
- **D17 note (November 6, 2026):** the owner approved all twelve phrases as written.
- **Ticket 283 note (November 6, 2026):** the line "For now, only Google Calendar events and
  Behaviors get reminders, not Outlook or iCloud events." is removed, because Outlook and
  iCloud events now get reminders. Eleven phrases remain. See P-026.
- **Status:** logged.

## P-025: Corrected places are remembered for their location text

- **Change:** Ticket 281, as narrowed by decision D12, implemented November 6, 2026. When a
  Calendar event has a location and its corrected destination resolves, the hosted route
  stores the corrected place's Google place ID in `travel_place_cache` under the one-way key
  of the event's original location text. That text then resolves to the corrected place after
  a reload and for every other event, Behavior Where or saved Home with the same normalized
  text, for up to 365 days. No place or event text is stored. Turning travel off deletes the
  rows. A correction for an event without a location still lasts only while the Timeline is
  open. Correcting a place again replaces the remembered one, and correcting it back to the
  event's own location text forgets it (verifier fix). Refines P-020; nothing about
  attendance is stored (P-023).
- **Affected:** Ticket 281. Files: `lib/services/travel-route-refresh.service.ts`,
  `components/timeline/ExternalEventDetails.tsx`, `components/settings/LegalContent.tsx`,
  `docs/user-guide/travel.md`.
- **Surfaces:** Privacy, in-app copy, user guide.
- **Conflicting current text:**
  - Privacy, travel section: "To avoid repeat lookups, Cadence stores Google's place
    identifier for each looked-up location with the account, keyed by a one-way fingerprint
    of the typed text." The identifier under a fingerprint can now be a corrected place's.
  - `docs/user-guide/travel.md`, "Inspect travel and correct a journey": "Use for this
    journey changes temporary routing only." and "Leave and reopen the Timeline to discard
    journey corrections."
  - In-app text, Calendar details: "Applies to every event, Behavior and Home with the same
    location. Turning off Travel estimates forgets it." is new, approved with an owner change
    on November 6, 2026 (decision D20; it replaces the proposed "Applies to this event and other
    events at the same location."). The approved "Applies to this event until you close the
    Timeline." now shows only for an event without a location.
- **Update needed:** say that a corrected place is remembered for that location text,
  including for Behaviors and Home with the same text, that only a place identifier and a
  one-way key are stored, for how long, and that turning travel off or correcting back to the
  original text forgets it. The in-app note is approved (D20); the Privacy text and user guide
  still need the update.
- **Status:** logged.

## P-026: Outlook and iCloud events get leave reminders, and Mac-cached locations

- **Change:** Ticket 283 (decision D4), implemented November 6, 2026, not merged. Outlook and
  iCloud events with a location get leave times, trips and leave reminders under the same
  rules as Google Calendar events (P-019 covers the location read itself).
  - The hosted leave reminder job (Tickets 276 and 277) reads Outlook and iCloud Calendar for an
    opted-in account with no user session, through its own token channel. It decrypts the
    sealed Outlook refresh token or iCloud app-specific password the same way a signed-in read
    does. It reads locations for routing and titles only at send time, in memory.
  - The Travel Settings line "For now, only Google Calendar events and Behaviors get reminders,
    not Outlook or iCloud events." is removed.
  - The Mac's disposable Outlook and iCloud caches now hold event locations, as the Google
    Calendar cache already does.
  - Decision D18 (November 6, 2026) replaces the earlier note that such days lose the Daily
    Brief's signed travel conclusions. The brief now gets them for Outlook and iCloud stops when
    that Calendar's Daily Brief disclosure is on: yes/no fits, trip states and weather margins
    about those events, never times or places. With the disclosure off, a day with a stop from
    that Calendar gets none; a day where that Calendar has only unlocated events keeps them. No disclosure text changes; text describing the brief's travel
    facts should not say they cover Google Calendar events only.
- **Affected:** Ticket 283, with P-016, P-017, P-019 and P-024. Files:
  `components/settings/LegalContent.tsx`, `docs/user-guide/travel.md`, Microsoft connector
  submission materials.
- **Surfaces:** Privacy, Travel Settings, user guide, provider submissions.
- **Conflicting current text:**
  - Privacy, "Outlook Calendar, iCloud Calendar, and Hevy": "Cadence requests only event
    titles, times, timezone, availability, response, and calendar names." and "It discards
    unsupported details." Locations are now requested and kept for travel.
  - Privacy, retention table, "Desktop Outlook, iCloud, and Hevy caches": does not say the
    caches can hold event locations.
  - Privacy, Google Calendar processing moments (P-017) name only Google Calendar for the
    sessionless reminder check.
  - `docs/user-guide/travel.md`: names Google Calendar as the travel source. Not checked line
    by line.
- **Update needed:** say Outlook and iCloud events get leave times and reminders; name the
  sessionless reminder check for both connectors; add locations to the desktop cache row;
  describe the Teams-placeholder rule. Update the Microsoft connector materials before the next
  submission.
- **Status:** logged.

## P-027: Mac screen recovery message

- **Change:** Ticket 285 defect fix, implemented November 7, 2026. It reached `main` through
  PR #195 and ships in Mac 0.1.9 with the travel revamp (D23). When a Mac app
  screen fails to render, Cadence now shows "This screen could not be shown. Try again, or open
  another screen." with **Try again**, and keeps the navigation, account sync and Settings
  working. Before, the whole window went blank. If the app shell itself fails, the existing
  message "Cadence could not open. Quit and reopen the app to try again." now also covers render
  failures, not only a failed start. The owner approved both messages on November 7, 2026
  (D21).
- **Affected:** Ticket 285. Files: `apps/desktop/src/desktop-error-boundary.tsx`,
  `docs/user-guide/desktop-local.md`.
- **Surfaces:** in-app copy (Mac), user guide.
- **Conflicting current text:** `docs/user-guide/desktop-local.md`, "Retry loading local data",
  describes **Try again** only for local data that cannot be opened. It does not mention a
  screen that cannot be shown.
- **Update needed:** add one line to the user guide section describing the screen recovery
  message. The wording itself is approved (D21).
- **Status:** logged.

## P-028: Day notes in the Timeline, MCP and exports

- **Change:** a user can save one note for a whole day under each Timeline date. MCP
  read access (`cadence.read`) now includes day notes, and the occurrence write
  permission (`cadence.occurrences.write`) also edits day notes. Full JSON and
  BehaviorLog exports include day notes. Day notes have their own Note shortcuts pool.
  Code: `components/timeline/DayNoteControl.tsx`,
  `supabase/migrations/20261110120000_day_notes.sql`, Ticket 292.
- **Affected:** Ticket 292. Files: `docs/user-guide/timeline.md` (no day-note
  section; `INT-TIMELINE-012` points at "Save or edit an Occurrence Note" until it
  exists), `docs/user-guide/privacy-and-account.md` (what an AI client can read and
  write), the OAuth consent permission descriptions, the MCP developer docs, the
  Privacy page's description of stored notes and exports.
- **Conflicting current text:** consent and docs describe the occurrence write
  permission as "Mark Occurrences Completed, Not Completed, or Unresolved, and edit
  Occurrence notes", and read access as Behaviors, Occurrences, statuses and notes,
  without day notes.
- **Update needed:** add a "Save or edit a day note" user-guide section and point
  `INT-TIMELINE-012` at it; name day notes in Privacy's stored-data and export lists.
  The consent scope summaries in `packages/core/src/integration/scopes.ts` already name
  day notes (Ticket 292 says so). The generated developer reference adds the two tool
  pages; the hand-written changelog in `apps/marketing/src/data/developers.ts` still
  lists only 1.0.0 and needs a 1.1.0 entry.
- **Status:** logged.

## P-029: Daily Brief facts sent to OpenAI under the user's ChatGPT account

- **Change:** decided November 7, 2026 (`docs/DECISIONS.md`, D27); Tickets 297–299
  implement it. On a signed-in Mac with a connected ChatGPT plan, the Mac sends the Daily
  Brief facts to OpenAI under the user's own ChatGPT account, not Cadence's API account.
  Cadence's server prepares the facts and validates the output but makes no OpenAI request for
  that brief. ChatGPT access and refresh tokens stay in the Mac's Keychain; Cadence's server
  never receives them. The Mac shows the ChatGPT account's email. Disconnect
  revokes the refresh token at OpenAI. Web briefs and Mac briefs without plan usage are
  unchanged.
- **Affected:** Tickets 294, 297, 298 and 299. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Optional Daily Brief", the processor table's OpenAI rows; Trust, "Data
  boundaries"). Related legal entry: L-017.
- **Surfaces:** Privacy, Trust, provider submissions.
- **Conflicting current text:**
  - Privacy, "Optional Daily Brief": "Cadence sends today's Behavior schedule and completion
    history, including findings calculated from it, to OpenAI." and "Cadence requests
    store:false from OpenAI". On a plan, the Mac sends it under the user's account.
  - Processor table, OpenAI: "Optional Daily Brief generation where enabled" describes only
    Cadence's own use of OpenAI.
  - Trust, "Data boundaries": "Optional Daily Brief sends the context described in the Privacy
    Policy to OpenAI".
- **Update needed:** say that a Mac using a ChatGPT plan sends the same brief facts to OpenAI
  under the user's ChatGPT account, which OpenAI's terms and that account's data controls
  govern; that Cadence holds no ChatGPT token; and what Disconnect does. Confirm which OpenAI
  retention terms apply to plan requests.
- **Status:** logged.

## P-030: Daily Brief disclosure on a Mac using a ChatGPT plan

- **Change:** decided November 7, 2026 (D27); Ticket 299 implements it. On a Mac with plan
  usage, the brief runs on the user's ChatGPT plan, and a usage limit stops the brief with
  "Manage usage" instead of falling back to Cadence's key.
- **Affected:** Tickets 294 and 299. Files: `components/briefing/DailyBriefSettingsPanel.tsx`.
- **Surfaces:** in-app copy (Mac).
- **Conflicting current text:** Daily Brief settings: "Cadence sends today's Behavior schedule
  and completion history, including findings calculated from it, to OpenAI." and "OpenAI data
  retention may apply.", which links OpenAI's API data controls.
- **Update needed:** on a Mac with plan usage, say the brief runs on the user's ChatGPT plan
  and link the data controls that apply. Ticket 299 leaves this text unchanged and logs its own
  new card copy separately.
- **Status:** logged.

## P-031: User guide for using a ChatGPT plan

- **Change:** decided November 7, 2026 (D27); Ticket 299 implements it. Mac users can connect
  ChatGPT from Settings, see "Using ChatGPT plan", open "Manage usage" and disconnect.
- **Affected:** Tickets 294 and 299. Files: `docs/user-guide/timeline.md` ("Daily Brief"),
  `docs/user-guide/privacy-and-account.md` ("Outlook, iCloud, Hevy, and Daily Brief data").
- **Surfaces:** user guide.
- **Conflicting current text:** `docs/user-guide/timeline.md`, "Daily Brief": "Cadence sends
  today's Behavior schedule and bounded completion history, including findings calculated
  from it, to OpenAI." It names no ChatGPT plan option.
- **Update needed:** describe connecting ChatGPT on the Mac, plan usage on and off, the
  usage-limit state with "Manage usage" (no fallback to Cadence's key), reconnect and
  Disconnect, and that the web app has no ChatGPT option.
- **Status:** logged.

## P-032: Marketing claim "Use your ChatGPT plan"

- **Change:** decided November 7, 2026 (D27). After Ticket 300 passes and a Mac release ships
  the feature, marketing may say Mac users can run the Daily Brief on their ChatGPT plan.
- **Affected:** Tickets 294, 299 and 300. Files: `apps/marketing/src/data/faq.ts`
  ("use-external-ai"), `apps/marketing/src/data/routes.ts`,
  `apps/marketing/src/pages/about.astro`. Related legal entry: L-019.
- **Surfaces:** marketing.
- **Conflicting current text:** FAQ, "Can I analyze my Record with an AI service?": "When
  enabled, Daily Brief separately sends selected tracking information to OpenAI". It names no
  ChatGPT plan option.
- **Update needed:** after release, add "Use your ChatGPT plan" for Cadence for Mac, naming it
  Mac only and following OpenAI's brand guidelines. No claim before release.

## P-033: Settings groups, Trust links, Delete account link and auto-save

- **Change:** decided November 10, 2026 (`docs/DECISIONS.md`); not implemented. Settings
  becomes four groups (General, Connections, Planning, Account and data). The Trust and
  legal section becomes one line of Privacy, Terms and Trust links at the end of the page.
  Delete account becomes a plain link at the end of the page that opens the same form.
  Most settings save as they change, so **Save travel settings** goes away; **Save
  timezone** stays. Settings wording is rewritten to be clear and warm.
- **Affected:** Tickets 301, 302, 303 and 309. Files: `app/(app)/settings/page.tsx`,
  `components/settings/*`, `apps/desktop/src/settings-screen.tsx`.
- **Surfaces:** in-app copy, user guide.
- **Conflicting current text:** `docs/user-guide/privacy-and-account.md`: "Under **Trust
  and legal**, choose **Privacy**, **Terms**, or **Trust**." and "In **Delete account**,
  choose **Open Export**." `docs/user-guide/travel.md`: "Select Save travel settings after
  changing Home or usual travel." `docs/user-guide/timeline.md`: "Settings lists every
  read-only source under **Connected sources**".
- **Update needed:** rewrite those user guide steps for the groups, the links line, the
  Delete account link and auto-save. Review each rewritten in-app sentence from Ticket 309
  that states what Cadence does with data.
- **Ticket 309 additions (November 10, 2026).** Ticket 309 rewrote Settings wording but left
  every sentence that states what Cadence sends, stores or shares. These kept sentences need
  plainer wording in Ticket 246. The before-and-after list is
  `docs/qa/2026-11-10-settings-wording.md`.
  - `components/settings/ConnectorLibrary.tsx`, Connected sources: "Optional read-only
    context from other services. Sources never change Behaviors, Occurrences, statuses,
    Notes, or tracked time." "Context" is vague; name what shows (events, workout times).
  - `components/settings/GoogleCalendarPanel.tsx`: the description "Read-only context from
    the Google account used for Cadence. …"; the connected line "Cadence reads selected
    calendars only. Disconnecting removes this Calendar connection …"; both disconnect
    results, including "Google could not confirm grant revocation; remove Cadence in Google
    account permissions if needed"; and the wrong-account paragraph ("Removing Cadence
    Calendar access there affects the entire Calendar project …"). "Grant", "revocation"
    and "Calendar project" are jargon.
  - `components/settings/OutlookCalendarPanel.tsx`: the description "Read-only calendar
    context from a personal, work, or school Microsoft account. …"; the permission
    disclosure "Microsoft asks you to allow reading your calendars, which covers event
    details. …"; the connected line "… Disconnecting deletes Cadence's saved Microsoft
    access; Microsoft keeps the permission until you remove it there."; the disconnect
    result "Cadence deleted its saved Microsoft access."
  - `components/settings/IcloudCalendarPanel.tsx`: the description "Read-only calendar
    context from your Apple Account. …"; `ICLOUD_CUSTODY_COPY`, which says twice that Apple
    does not limit the password to Calendar; the connected line "… Disconnecting deletes
    Cadence's saved copy; Apple keeps the app-specific password active …"; the disconnect
    result "Cadence deleted its saved Apple Account email and app-specific password."
  - `components/settings/HevyPanel.tsx`: the description "Provider responses can contain
    exercises, titles, notes, sets and weights; Cadence discards these details." Ticket 309
    names "provider responses" as jargon; a plainer form is "Hevy also sends exercises,
    titles, notes, sets and weights. Cadence does not keep them." The intake sentence
    "Cadence stores it encrypted on its server, never on this device, and scans at most 500
    workouts across your full history, even for today." is one long sentence. The connected
    line "Disconnecting deletes Cadence's saved key. …" and the disconnect result "Cadence
    deleted its saved API key."
  - `lib/ui/connectors.ts`, `CONNECTOR_REVOCATION_COPY`: the Microsoft, Hevy and Apple
    removal steps, also shown in Delete account.
  - `components/settings/ConnectedAppsPanel.tsx`: "AI clients with access to this Cadence
    account. Disconnect stops their access immediately." The section is "Connected apps"
    and each item says "Verified client" or "Unverified client", as the consent screen
    (`components/oauth/ConsentForm.tsx`) does. Choose one name, app or client, in Settings
    and consent text together.
  - `components/settings/TravelSettingsPanel.tsx`: the Travel estimates disclosure ("While
    this is on, Cadence sends trip start and end points …"); "Cadence saves only the places
    you enter and the travel habits you tell it. Device positions and route results stay
    temporary …"; "A current position is available. Cadence did not save it." The Home help
    text and the Home lookup message stay with P-036.
  - `components/briefing/DailyBriefSettingsPanel.tsx`: each source's "Sends …" line; the
    coverage line "Only timing is sent, never event titles, …"; the reminder history and
    Notes disclosures; the closing paragraph "Cadence sends today's Behavior schedule and
    completion history, including findings calculated from it, to OpenAI. …"; the panel
    description "Cadence can prepare one read-only briefing …", which repeats the drawer's
    purpose line; and the Mac line "Hosted context does not include unsynchronized or
    local-only desktop data." ("hosted context" is jargon).
  - `components/settings/AccountDeletionPanel.tsx`: "Account deletion removes the
    signed-in Cadence account and its hosted behavior records. This cannot be undone."
    ("hosted behavior records" is jargon) and "Deletion also removes Cadence's saved access
    for connected sources. …"
  - `apps/desktop/src/settings-screen.tsx`, Local profile: "Tracking data uses this Mac's
    SQLite database as an offline working copy. Account changes synchronize while Cadence
    runs with connectivity. Native reminders stay on this Mac, and desktop email delivery
    remains inactive." and "Tracking data stays on this Mac. No cloud account or email
    delivery is connected." `SETTINGS_ACCOUNT_PURPOSE`: "Optional. Link this Mac to your
    Cadence account to synchronize tracking data and connect sources." "SQLite", "working
    copy" and "connectivity" are jargon.
  - `apps/desktop/src/account/account-panel.tsx`: "SQLite is this Mac's offline working
    copy. Account changes synchronize while Cadence runs with connectivity."; "Your local
    data has not been uploaded or replaced. …"; "Disconnecting does not delete hosted
    account data."
  - `apps/desktop/src/local-database-controls.tsx`: "Cadence stores the live database in its
    macOS Application Support folder."
  - User guide text that Ticket 309's renamed labels make stale:
    `docs/user-guide/reminders-and-timezone.md` ("**Detected _timezone_**", "**Use detected
    timezone**"; timezone options now read as places, such as "New York"),
    `docs/user-guide/timeline.md` ("**Show Calendar context on Timeline**", "**Show
    all-day events**", "**Refresh Calendar**", and "choose calendars in Connectors"),
    `docs/user-guide/desktop-local.md` ("**Request notification permission**", "**Refresh
    reminder coverage**", "**Apply conflict decisions**", "**Discard drafts and restart**").
    The new labels are "Your device is set to …", **Use device timezone**, **Show Google
    Calendar events on Timeline**, **Show all-day Google Calendar events**, **Refresh Google
    Calendar**, Connected sources, **Allow notifications**, **Check reminders**, **Apply
    choices** and **Discard changes and restart**. The Mac's section is now
    **Notifications**, not Native notifications.
- **Status:** logged.

## P-034: Note shortcuts on for everyone

- **Change:** decided November 10, 2026 (`docs/DECISIONS.md`); not implemented. Note
  shortcuts are on by default. A Behavior no longer needs its own switch, repeated Notes
  are matched without a request, and Settings shows no Note shortcuts control. The stored
  switch stays so the control can return.
- **Affected:** Ticket 305. Files: `components/note-shortcuts/NoteShortcutControls.tsx`,
  `packages/core/src/types/note-shortcut.ts`, `docs/PRODUCT_SPEC.md` ("Recurring Note
  shortcuts contract"), `docs/UI_SPEC.md` ("Note shortcut controls").
- **Surfaces:** in-app copy, user guide, Privacy.
- **Conflicting current text:** `docs/user-guide/timeline.md`, "Use a Note shortcut": "Open
  **Settings** and enable **Note shortcuts**. Open an active Behavior's **Details and
  Settings**, enable its Note shortcuts, then choose **Find repeated". `docs/user-guide/desktop-local.md`,
  "Note shortcuts": "Settings controls the global **Note shortcuts** setting." Privacy text
  on Note shortcuts was not checked.
- **Update needed:** rewrite both user guide sections. Check whether the Privacy page
  describes Note shortcuts as opt-in and correct it if so.
- **Status:** logged.

## P-035: One Daily Brief choice for connected sources, and one Google Calendar connection

- **Change:** decided November 10, 2026 (`docs/DECISIONS.md`); not implemented. One Daily
  Brief choice covers every connected source, with a per-source list under Advanced. Daily
  Brief reads Google Calendar through the Timeline connection, and the separate **Google
  Calendar for Daily Brief** connection is retired.
- **Affected:** Tickets 306 and 307. Files: `components/briefing/DailyBriefSettingsPanel.tsx`,
  `components/settings/GoogleCalendarPanel.tsx`, `components/settings/LegalContent.tsx`.
  Related legal entry: L-021. Related: P-010 and P-012 (Google verification).
- **Surfaces:** Privacy and Terms, in-app copy, user guide, marketing, provider submissions.
- **Conflicting current text:** Privacy: "Google Calendar, Outlook Calendar, iCloud Calendar
  and Hevy each need a separate Daily Brief choice. Connecting a source or displaying it on
  Timeline does not grant model access." and "Daily Brief reads Calendar only through that
  connection, never through the Timeline connection". Terms: "Separate choices control
  optional Calendar timing, reminder delivery counts, and selected Notes." In-app: "Calendar
  timing, recorded workouts and the sources above are optional, and each needs its own
  choice here." `docs/user-guide/timeline.md`: "Outlook Calendar, iCloud Calendar and Hevy
  each need their own choice" and the section "Calendar for Daily Brief".
  `apps/marketing/src/data/faq.ts`, `new-connector-model-choice`: "No. Google Calendar,
  Outlook Calendar, iCloud Calendar and Hevy each need a separate default-off Daily Bri…".
  `tests/legal-content.test.tsx` asserts parts of the Privacy text.
- **Update needed:** rewrite each passage for one choice and one Google connection. Say
  that a source connected later is covered by the choice already made. Update the Google
  verification narrative before any submission.
- **Status:** logged.

## P-036: Home from the current location

- **Change:** decided November 10, 2026 (`docs/DECISIONS.md`); not implemented. A button
  beside Home reads the device position once, sends it to Google to get an address, and
  fills the Home field for the user to confirm. The position is not stored.
- **Affected:** Ticket 308. Files: `components/settings/TravelSettingsPanel.tsx`,
  `lib/services/travel-provider.ts`, `docs/COSTS.md`.
- **Surfaces:** Privacy, in-app copy, user guide.
- **Conflicting current text:** Privacy: "Cadence reads the device location only while
  Cadence is open in the foreground: during an explicit permission check, during a travel
  refresh, and once when the Timeline opens with a current estimate". In-app: "Use a full
  address. Trips home and Behaviors set to Home use it." `docs/user-guide/travel.md`:
  "**Home (optional)**: a full address."
- **Update needed:** add the Home button to the list of location reads and to what is sent
  to Google Maps Platform. Rewrite the Home help text and the user guide line.
- **Status:** logged.

## P-037: Daily Brief text in Mac builds released before Ticket 307

- **Change:** implemented November 10, 2026 on web and in the Mac source (Ticket 307).
  Daily Brief reads Google Calendar through the Timeline connection once hosted migration
  `20261110160000` runs. Installed Cadence for Mac builds released before this change
  (0.1.9 and earlier) still render the old Daily Brief Settings copy from their own bundle.
- **Affected:** Tickets 306 and 307. Files: the Daily Brief Settings copy shipped in
  published Mac builds. Related: P-035 and L-021.
- **Surfaces:** in-app copy on installed Mac builds; desktop release notes.
- **Conflicting current text:** published Mac builds say "Your Timeline Google Calendar
  connection is never used", which becomes false after the migration, and still offer the
  separate Google Calendar for Daily Brief connection, which the server now refuses.
- **Update needed:** ship a Mac release with the new panel, and decide whether the release
  notes or an in-app notice should tell users of older builds. Until then the older text
  stays on those Macs.
- **Status:** logged.

## P-038: Hevy workouts can complete linked Behaviors

- **Change:** decided November 10, 2026 (D28). After Tickets 310–324 ship, a Behavior the
  user links to Hevy is marked Completed when a matching workout is recorded. There is no
  approval for each completion (D28.1). Each one is labeled "From Hevy", and the user can
  change it. Cadence never changes a status the user set. No code has shipped; today's
  text stays accurate until Ticket 323 passes.
- **Affected:** Tickets 310, 317 and 323. Files: `components/settings/LegalContent.tsx`,
  `components/settings/HevyPanel.tsx`, `docs/user-guide/privacy-and-account.md`,
  `docs/user-guide/timeline.md`, `apps/marketing/src/data/faq.ts` ("hevy-timing-limits").
- **Surfaces:** Privacy, in-app copy, user guide, marketing.
- **Conflicting current text:**
  - Privacy, "Outlook Calendar, iCloud Calendar, and Hevy": "Workouts never automatically
    complete or change a Behavior or Occurrence."
  - Hevy panel in Settings: "A workout never completes a Behavior."
  - User guide, privacy and account: "A workout never completes a Behavior or proves free
    time." Timeline: "A recorded workout never completes a Behavior and never shows when
    you are free."
  - FAQ, "What does the Hevy connector use?": "Workouts never automatically complete a
    Behavior or prove free time."
- **Update needed:** at release, say a workout completes a Behavior only when the user
  links that Behavior to Hevy; describe the label, how to change a completion, the 30-day
  window and that no notification is sent. Add copy entries for the link form (Ticket 317).
- **Status:** logged.

## P-039: Stored Hevy workout times and routine digests

- **Change:** decided November 10, 2026 (D28.3, D28.6). Cadence will store, with the
  account: source links (the Behavior, the source and digests of the chosen routine
  identifiers), source matches (an opaque activity reference, the workout's start and end,
  and the Occurrence's scheduled time) and a check state for each source. Today Cadence
  stores no Hevy record on its server except the sealed key.
  - Routine identifiers are kept only as account-scoped SHA-256 digests. Titles,
    exercises, sets, weights and notes are still never stored.
  - Matches are tracking history. Disconnecting Hevy keeps them; deleting the account
    removes them.
  - Ticket 320 syncs links and matches to linked Macs, into SQLite and user-created
    backups.
  - Status events export with their provenance. Match timing exports only if Ticket 322
    adds it.
- **Affected:** Tickets 310, 314, 320 and 322. Files: `components/settings/LegalContent.tsx`,
  `docs/user-guide/privacy-and-account.md`, `apps/marketing/src/data/faq.ts`. Related legal
  entry: L-023.
- **Surfaces:** Privacy, Trust, user guide, marketing.
- **Conflicting current text:**
  - Privacy, "Outlook Calendar, iCloud Calendar, and Hevy": "Cadence does not persist
    these source events or workouts in its hosted database." and "Cadence discards these
    details and exposes only recorded workout timing and duration."
  - Privacy, provider table, "Microsoft Graph, Apple iCloud, and Hevy": "Hevy details are
    discarded after receipt".
  - User guide, privacy and account: "Cadence discards them and keeps only
    identity/revision and timing fields needed for normalized snapshots."
  - FAQ, "What does the Hevy connector use?": "API responses can include exercises, sets,
    weights, titles, routines and notes; Cadence discards these details."
- **Update needed:** name the stored fields and where they live; say routine identifiers
  are kept as digests; state retention on disconnect and on account deletion; add Mac
  storage and backups after Ticket 320.
- **Status:** logged.

## P-040: Hevy routine titles shown in the link form

- **Change:** decided November 10, 2026 (D28.3). The Behavior form's routine picker reads
  routine titles from Hevy and shows them so the user can choose. The titles are not
  stored or logged. The allowlist of Hevy reads gains `GET /v1/routines`, and
  `GET /v1/workouts/events` if Ticket 311 selects it.
- **Affected:** Tickets 310, 315 and 317. Files: `components/settings/LegalContent.tsx`,
  `components/settings/HevyPanel.tsx`, `docs/user-guide/privacy-and-account.md`.
- **Surfaces:** Privacy, in-app copy, user guide.
- **Conflicting current text:**
  - Privacy, "Outlook Calendar, iCloud Calendar, and Hevy": "Provider responses can
    contain workout titles, exercises, sets, weights, routines and notes. Cadence discards
    these details and exposes only recorded workout timing and duration."
  - Hevy panel in Settings: "Provider responses can contain exercises, titles, notes, sets
    and weights; Cadence discards these details."
- **Update needed:** say routine titles are shown in the link form and not kept, and name
  the added reads.
- **Status:** logged.

## P-041: Hevy is read in the background, over 30 days

- **Change:** decided November 10, 2026 (D28.5, D28.6). For an account with a source link,
  a hosted job reads Hevy without Cadence being open: once before a reminder, at intervals
  after a scheduled start, and once a night. Opening the Timeline also runs a check.
  Matching covers today and the 30 prior local dates, and a past day can change with no
  notification. The Hevy panel shows the last successful check time.
- **Affected:** Tickets 310, 316 and 321. Files: `components/settings/LegalContent.tsx`,
  `components/settings/HevyPanel.tsx`, `docs/user-guide/timeline.md`. Related legal entry:
  L-023.
- **Surfaces:** Privacy, in-app copy, user guide.
- **Conflicting current text:**
  - User guide, Timeline: "Choose **Refresh Hevy** to read today's workouts now."
  - Hevy panel in Settings: "Hevy connected. Recorded workouts from today appear on the
    Timeline."
  - No current text says Cadence reads Hevy while the app is closed or reads more than
    today for display.
- **Update needed:** say when Cadence reads Hevy for a linked Behavior, that it does so
  with the app closed, how far back it looks and that past days can change.
- **Status:** logged.

## P-042: Marketing claim: log a workout once

- **Change:** decided November 10, 2026 (D28). After Ticket 323 passes and the feature is
  on, marketing may say a workout logged in Hevy completes the linked Behavior in Cadence.
- **Affected:** Tickets 310 and 323. Files: `apps/marketing/src/data/faq.ts`
  ("hevy-timing-limits", "new-connector-availability"). Related legal entry: L-023.
- **Surfaces:** marketing.
- **Conflicting current text:** FAQ, "What does the Hevy connector use?": "Workouts never
  automatically complete a Behavior or prove free time."
- **Update needed:** after release, describe linking a Behavior to Hevy. State that Hevy
  Pro is required and that the link is opt-in for each Behavior. No claim before release.
- **Status:** logged.

## P-043: Connector completion in-app copy

- **Change:** Tickets 317 and 318 add in-app text, shown only while
  `CADENCE_CONNECTOR_COMPLETION` is on: the "Complete from Hevy" section ("A matching
  workout marks this Behavior Completed on the workout's day. It never changes a status
  you set, and each completion is labeled “From Hevy”."), its refusal and save messages,
  the Timeline line "From Hevy" or "From Hevy · 2 workouts", "Workout in Hevy", the Hevy
  panel's "Last checked for completed Behaviors …", and the Behaviors review line "On
  schedule 6 of 9. Usually 40 min later."
- **Affected:** Tickets 317 and 318. Files: `components/behaviors/SourceLinkSettings.tsx`,
  `components/timeline/OccurrenceRow.tsx`, `components/settings/HevyPanel.tsx`,
  `packages/core/src/resolvers/analytics.resolver.ts`,
  `packages/core/src/services/timeline-source-evidence.ts`.
- **Surfaces:** in-app copy, user guide.
- **Conflicting current text:** the Hevy panel description still ends "A workout never
  completes a Behavior." (P-038). It is accurate while the flag is off.
- **Update needed:** review the new strings in the messaging track before Ticket 323
  turns the flag on, together with P-038, and add the user-guide steps.
- **Status:** logged.
