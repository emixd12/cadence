# Privacy change log

**Rule (owner decision, October 22, 2026):** until the pre-launch privacy pass,
privacy, disclosure and marketing-language conflicts are logged here and never block
development. In-progress work proceeds as if no privacy policy constrains it.

This file lists every decided or implemented change that makes Cadence's current
privacy text, disclosures, user guide or marketing language inaccurate or incomplete.
The pre-launch privacy pass works through the open entries and updates the text in
one review. That pass is not yet ticketed. `docs/DECISIONS.md` (2026-10-22) records
the rule.

Provider terms, data licences and the owner's legal risk decisions stay in
`docs/LEGAL.md`. An entry here links the related `L-` entry when one exists.

## Current text the entries cite

- `components/settings/LegalContent.tsx`: the Privacy page (dated October 21, 2026),
  the Terms page (dated October 18, 2026) and the Trust page (dated August 27, 2026).
  `tests/legal-content.test.tsx` asserts parts of that text.
- `docs/user-guide/*`: factual user guidance.
- Marketing: `apps/marketing` (cadence-me.com), including `src/data/faq.ts`,
  `src/data/routes.ts`, `src/data/developers.ts` and `src/pages/about.astro`.

Entries quote section titles and text rather than line numbers, because line
numbers move.

## How to add or update an entry

1. Give a new entry the next ID (`P-010` is next). Never reuse an ID.
2. Fill in every field below. Quote the conflicting current text briefly and name
   its file and section.
3. Log the change when it is decided or implemented. Do not wait for release.
4. Link the entry ID from every ticket, plan or doc that causes the change.
5. When updated text ships, record the file, the deployment and the date, then set
   the status.

Fields: change; affected tickets and files; conflicting current text; update needed;
status.

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
| [P-005](#p-005-public-statement-that-cadence-sends-no-behavior-data-to-an-ai-provider) | Public statement that Cadence sends no behavior data to an AI provider | logged | 187 | Trust page, test |
| [P-006](#p-006-marketing-review-of-ai-and-travel-claims) | Marketing review of AI and travel claims | logged | 219, 165, 187 | Marketing |
| [P-007](#p-007-first-run-setup-invites-a-home-address) | First-run setup invites a Home address | logged | 212 | Privacy, user guide |
| [P-008](#p-008-setup-purpose-line-does-not-name-google-maps) | Setup purpose line does not name Google Maps | logged | 212 | Setup copy, Privacy |
| [P-009](#p-009-privacy-text-says-saved-base-where-the-interface-says-home) | Privacy text says "saved base" where the interface says "Home" | logged | 215, 212 | Privacy, user guide |

P-003 holds the content of `docs/LEGAL.md` L-011, moved here on October 22, 2026.

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
- **Affected:** Ticket 187. `docs/LEGAL.md` L-012 and Ticket 219 cite Ticket 187, but
  `docs/TICKETS.md` has no Ticket 187 section yet. Files:
  `components/settings/LegalContent.tsx` (Trust, "Data boundaries"),
  `tests/legal-content.test.tsx`.
- **Conflicting current text:** Trust, "Data boundaries": "Cadence does not send
  exported behavior data to an AI provider." The test asserts this sentence. The
  sentence is limited to exported data, but a reader can take it as a general promise.
- **Update needed:** rewrite the sentence so that it agrees with the Daily Brief and MCP
  disclosures, and update the test. The rewrite must also cover Ticket 219's travel
  facts in model input (P-004).
- **Status:** logged.

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
