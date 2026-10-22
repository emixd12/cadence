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

- `components/settings/LegalContent.tsx`: the Privacy and Terms pages (both dated
  October 18, 2026) and the Trust page (dated August 27, 2026).
  `tests/legal-content.test.tsx` asserts parts of that text.
- `docs/user-guide/*`: factual user guidance.
- Marketing: `apps/marketing` (cadence-me.com), including `src/data/faq.ts`,
  `src/data/routes.ts`, `src/data/developers.ts` and `src/pages/about.astro`.

Entries quote section titles and text rather than line numbers, because line
numbers move.

## How to add or update an entry

1. Give a new entry the next ID (`P-007` is next). Never reuse an ID.
2. Fill in every field below. Quote the conflicting current text briefly and name
   its file and section.
3. Log the change when it is decided or implemented. Do not wait for release.
4. Link the entry ID from every ticket, plan or doc that causes the change.
5. When updated text ships, record the file, the deployment and the date, then set
   the status.

Fields: change; affected tickets and files; conflicting current text; update needed;
status.

Status values:

- **open**: logged. The current text has not been updated.
- **drafted**: replacement text exists for owner review and is not published.
- **resolved**: the updated text is live, or the change no longer happens. The entry
  says which.

## Index

| ID | Change | Status | Tickets | Surfaces |
| --- | --- | --- | --- | --- |
| [P-001](#p-001-im-here-place-positions-and-completion-place-labels) | "I'm here" place positions and completion place labels | open | 216, 219, 244 | Privacy, user guide, MCP docs |
| [P-002](#p-002-leave-time-feedback-taps-and-learned-travel-habits) | Leave-time feedback taps and learned travel habits | open | 217, 219 | Privacy, user guide |
| [P-003](#p-003-open-meteo-recipient-log-retention-and-attribution) | Open-Meteo recipient, log retention and attribution | open | 218, 219 | Privacy, user guide, interface |
| [P-004](#p-004-daily-brief-model-data-disclosure-and-re-consent) | Daily Brief model-data disclosure and re-consent | open | 219, 216, 217, 218 | Privacy, Settings, user guide |
| [P-005](#p-005-public-statement-that-cadence-sends-no-behavior-data-to-an-ai-provider) | Public statement that Cadence sends no behavior data to an AI provider | open | 187 | Trust page, test |
| [P-006](#p-006-marketing-review-of-ai-and-travel-claims) | Marketing review of AI and travel claims | open | 219, 165, 187 | Marketing |

P-003 holds the content of `docs/LEGAL.md` L-011, moved here on October 22, 2026.

## P-001: "I'm here" place positions and completion place labels

- **Change:** Ticket 216 stores two new kinds of data with the account. First, a
  device-recorded position for Home or a saved place, set when the user marks
  "I'm here". Second, one completion place label per qualifying Completed occurrence:
  `home`, `saved_place:<id>` or `elsewhere`. The user chooses how long labels are kept
  from two or three options. At completion, Cadence reads the device position once in
  the foreground, only if location permission is already granted. It compares that
  position with the device-recorded markers, never with Google coordinates
  (`docs/LEGAL.md` L-003, resolved). Later, Ticket 219 sends label counts to the
  Daily Brief model, for example "logged at home 9 of 10 times".
- **Affected:** Tickets 216 and 219; Ticket 244 adds labels and markers to Full JSON.
  Files: `components/settings/LegalContent.tsx`, `docs/user-guide/travel.md`,
  `docs/user-guide/data-portability.md`, `docs/PRODUCT_SPEC.md`,
  `apps/marketing/src/data/developers.ts`.
- **Conflicting current text:**
  - Privacy, "Travel routing": Cadence reads the device location "only while Cadence
    is open in the foreground: during an explicit permission check, during a travel
    refresh, and once when the Timeline opens". It "does not save device locations."
    The completion read and the "I'm here" read are new read moments. A saved marker
    is a saved device location.
  - Privacy, "Travel routing": "Device locations and route estimates stay in temporary
    memory and are excluded from Cadence sync, exports, backups, analytics, and logs."
    Markers and labels sync with the account.
  - Privacy, "Retention" table, row "Device locations and route estimates": "Memory for
    the current app session" and "Not saved to Cadence's database, synchronization,
    exports, or backups". No row covers markers or labels.
  - `docs/user-guide/travel.md`, "Recipients and retention": "Cadence keeps device
    samples and route results in temporary memory and excludes them from sync,
    exports, backups and telemetry." "Refresh travel estimates": "Device position is
    read only on that open and during a refresh."
  - Privacy, "Exports and connected AI clients", and `developers.ts`: MCP "excludes
    travel settings, route estimates, device location". The text does not say whether
    markers and labels are excluded.
- **Update needed:** name markers and labels as stored account data and say what each
  holds. Describe the completion read and the "I'm here" read. List the retention
  options and the delete control. State sync and backup handling, and Full JSON once
  Ticket 244 ships. State whether MCP exposes markers or labels. Add label counts to
  the model-data disclosure (P-004).
- **Status:** open.

## P-002: Leave-time feedback taps and learned travel habits

- **Change:** Ticket 217 stores, with the account, the usual mode per saved place, the
  learned get-ready time, the arrival buffer and leave-time feedback taps. A tap holds
  an event reference, the answer ("too early", "about right" or "too late") and a time;
  no location. Ticket 219 sends the usual mode per place and the get-ready time to the
  Daily Brief model.
- **Affected:** Tickets 217 and 219. Files: `components/settings/LegalContent.tsx`,
  `docs/user-guide/travel.md`, `docs/user-guide/data-portability.md`.
- **Conflicting current text:**
  - Privacy, "Travel routing": stored travel data is described as user-authored
    locations, Google place identifiers and the monthly usage total. Learned habits and
    feedback taps are not mentioned.
  - Privacy, "Retention" table: no row covers learned habits or taps.
  - Privacy, "Optional Google Calendar": "Cadence does not store Google event details in
    its hosted database." Check whether a tap's event reference counts as an event
    detail.
  - `docs/user-guide/travel.md`, "Recipients and retention": lists the same stored
    travel data and omits habits and taps.
- **Update needed:** describe the habits and taps, what a tap contains, how the user
  edits or deletes them, their retention, sync and export handling, and the model
  facts derived from them (P-004).
- **Status:** open.

## P-003: Open-Meteo recipient, log retention and attribution

- **Change:** Ticket 218 sends a coarse area derived from the device position to
  Open-Meteo and uses its forecasts for a fixed travel margin and a mode suggestion.
  Ticket 219 sends weather facts to the Daily Brief model. Development and testing use
  the free Open-Meteo plan (`docs/LEGAL.md` L-008).
- **Question (from L-011):** what must the privacy content and the interface say once
  Cadence sends coarse areas to Open-Meteo and uses its forecasts?
- **Affected:** Tickets 218 and 219. Files: `components/settings/LegalContent.tsx`
  (Privacy, "Travel routing" and "Processors"), `docs/user-guide/travel.md`,
  `docs/PRODUCT_SPEC.md`, the travel margin line and the Daily Brief.
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
  - `docs/user-guide/travel.md`, "Recipients and retention": names Google Maps only.
- **Update needed:** name Open-Meteo as a recipient of coarse areas and state its
  90-day log retention. Give the advance notice under Maps Platform Terms 4.4(c)(iii);
  it applies because travel already combines device position with Google routing.
  Place Open-Meteo attribution next to weather-derived lines in the travel margin line
  and the Daily Brief. The L-011 reading rated the risk medium until the disclosure
  ships.
- **Status:** open.

## P-004: Daily Brief model-data disclosure and re-consent

- **Change:** Ticket 219 sends travel, habit and weather facts to OpenAI as Daily Brief
  model input. The facts are the usual mode per place, the learned get-ready time, the
  weather outlook, fit conclusions, Behavior Where values, "location not set" and
  label counts. Under `docs/LEGAL.md` L-001, Google route data reaches the model only
  as Cadence's own conclusions. Existing users consent again.
- **Affected:** Ticket 219, with facts from Tickets 216, 217 and 218. Files:
  `components/settings/LegalContent.tsx` (Privacy, "Optional Daily Brief", "Travel
  routing" and the OpenAI row of "Processors"), the Daily Brief Settings disclosure,
  `docs/user-guide/timeline.md`, `docs/user-guide/travel.md`.
- **Conflicting current text:**
  - Privacy, "Optional Daily Brief": "Cadence sends today's Behavior schedule and
    completion history, including findings calculated from it, to OpenAI." Travel,
    habit and weather facts are not listed.
  - Privacy, "Processors", OpenAI row: lists Behavior, Calendar, reminder and note data
    only.
  - `docs/user-guide/travel.md`: "Raw locations and route results are not sent to the
    Daily Brief model. Deterministic travel facts stay separate from the briefing." It
    also says the day's estimates "are not sent to the model."
  - `docs/user-guide/timeline.md`, "Daily Brief": lists what Cadence sends to OpenAI
    without travel facts.
- **Update needed:** list each travel, habit and weather fact sent to OpenAI and state
  what is never sent: addresses, coordinates, place IDs, route durations and raw
  provider responses. Add the re-consent step for existing users. Keep the statement
  that exact leave-by times stay in the calculated line.
- **Status:** open.

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
  disclosures, and update the test.
- **Status:** open.

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
- **Update needed:** align the claims with the updated Privacy page. Add travel copy
  only with deployed evidence, as Ticket 165 requires.
- **Status:** open.
