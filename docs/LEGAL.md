# Legal register

This file is the single place for Cadence's legal matters and questions: provider
terms, data licences, privacy obligations and the owner's risk decisions. Product
decisions that depend on an entry link to it from `docs/DECISIONS.md` or the ticket.

Readings here are the project's interpretation of public terms. They are not legal
advice. Earlier legal findings that predate this file stay in their tickets and plans
until someone moves them here.

## How to add or update an entry

Log a suspected terms or licence issue here and continue. Entries never stop
development, merges, deployments or ongoing tasks (`docs/DECISIONS.md`, 2026-11-04).

Privacy-text, disclosure and marketing-language items go to `docs/MESSAGING_CHANGES.md`,
not here. Until the pre-launch privacy pass they never block development. Link the
`P-` entry from the related `L-` entry when both exist.

1. Give a new entry the next ID (`L-020` is next). Never reuse an ID.
2. Fill in every field below. Quote the clause briefly and link the source.
3. When someone rechecks a source, update its check date and the reading.
4. Record an owner decision only from the owner's own words, with its date.
5. Link the entry ID from every ticket, plan or doc that depends on it.

Fields: question; affected tickets and files; provider, clause, source and check date;
current reading; risk level; owner decision or risk acceptance; status; next action.

Status values:

- **open**: unanswered. Development continues. Only the owner decides whether the
  entry changes the work (`docs/DECISIONS.md`, 2026-11-04).
- **accepted risk**: the owner accepted the risk under stated limits. The question may
  still be asked.
- **resolved**: answered, or moot because the matter no longer applies. The entry says
  which.
- **moved**: the entry now lives in `docs/MESSAGING_CHANGES.md`. The stub names the `P-`
  entry.

Risk levels:

- **high**: the planned work likely breaches a term or law.
- **medium**: a plausible reading finds a breach; the term is ambiguous.
- **low**: no current exposure, or a breach is unlikely.
- **none**: moot.

## Index

| ID | Question | Status | Risk | Tickets |
| --- | --- | --- | --- | --- |
| [L-001](#l-001-google-maps-content-in-daily-brief-model-input) | Google Maps content in Daily Brief model input | accepted risk | medium | 219, 218, 216 |
| [L-002](#l-002-google-coordinates-sent-to-a-non-google-provider) | Google coordinates sent to a non-Google provider | open | low today | 218, 216 |
| [L-003](#l-003-ticket-216-radius-comparison-against-google-coordinates) | Ticket 216 radius comparison against Google coordinates | resolved (design change) | none | 216 |
| [L-004](#l-004-google-weather-api-facts-in-model-input) | Google Weather API facts in model input | resolved (moot) | none | 218, 219 |
| [L-005](#l-005-google-weather-api-shared-one-hour-cache) | Google Weather API shared one-hour cache | resolved (moot) | none | 218 |
| [L-006](#l-006-weatherkit-shared-cache) | WeatherKit shared cache | resolved (moot) | none | 218 |
| [L-007](#l-007-weatherkit-facts-in-model-input) | WeatherKit facts in model input | resolved (moot) | none | 218, 219 |
| [L-008](#l-008-open-meteo-commercial-status-and-upstream-licences) | Open-Meteo commercial status and upstream licences | open | medium | 218, 219 |
| [L-009](#l-009-openweather-share-alike) | OpenWeather share-alike | resolved (moot) | none | 218, 219 |
| [L-010](#l-010-tomorrowio-contract-terms) | Tomorrow.io contract terms | resolved (moot) | none | 218 |
| [L-011](#l-011-weather-privacy-disclosure-and-attribution) | Weather privacy disclosure and attribution | moved to P-003 | — | 218, 219 |
| [L-012](#l-012-google-maps-notices-in-cadences-terms-and-privacy-content) | Google Maps notices in Cadence's terms and privacy content | closed | low | 213, 214, 165 |
| [L-013](#l-013-google-route-warnings-in-the-travel-display) | Google route warnings in the travel display | open | low | 163, 164 |
| [L-014](#l-014-last-known-leave-time-after-the-five-minute-window) | Last-known leave time after the five-minute window | open | medium | 163, 164, 170, 214, 267, 268 |
| [L-015](#l-015-leave-reminder-schedule-derived-from-a-route-estimate) | Leave reminder schedule derived from a route estimate | open | medium | 275, 277, 280 |
| [L-016](#l-016-calendar-reads-with-no-user-session) | Calendar reads with no user session | open | medium | 276, 277 |
| [L-017](#l-017-chatgpt-plan-usage-in-a-paid-or-hosted-app) | ChatGPT plan usage in a paid or hosted app | open | medium | 286–292 |
| [L-018](#l-018-sign-in-with-chatgpt-devkit-licence) | Sign in with ChatGPT DevKit licence | open | low | 287, 289, 291 |
| [L-019](#l-019-openai-brand-guidelines-for-the-chatgpt-button) | OpenAI brand guidelines for the ChatGPT button | open | low | 291 |

L-004 to L-011 came from the open questions in
`docs/plans/2026-10-17-weather-provider-comparison.md`. That plan's first question is
part of L-002.

## L-001: Google Maps content in Daily Brief model input

- **Question:** May Cadence send facts derived from Google Routes and Geocoding results
  to OpenAI as Daily Brief model input?
- **Affected:** Ticket 219 (model input), Ticket 218 (weather margin and mode rules),
  Ticket 216 (label counts; since L-003's October 22 resolution they no longer depend
  on Google coordinates). Files: `TravelTimingModelProjection` in
  `packages/core/src/types/travel.ts`, `projectBriefingContext` in
  `packages/core/src/services/briefing-config.ts`, `lib/services/daily-brief-openai.ts`.
- **Sources** (checked 2026-10-17):
  - Google Maps Platform Terms 3.2.3(c): "Customer will not create content based on
    Google Maps Content." Example (vi): "convert text-based driving times into
    synthesized speech results." Example (vii): use Maps Content "to train, test,
    validate or fine-tune" models.
    [Maps Platform Terms](https://cloud.google.com/maps-platform/terms), last modified
    August 26, 2026.
  - Service Specific Terms 10.2 (Maps Grounding Lite API): grounded output stays
    subject to the Maps restrictions, "including the prohibition on model training".
    Section 10.2.1 allows LLM grounding through that API "as a limited exception … to
    the prohibition on using Google Maps Content to create content".
    [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms),
    last modified October 15, 2026.
  - OpenAI: API data is not used for training. Abuse-monitoring logs, which may hold
    prompts, are kept up to 30 days. Cadence sends `store: false`.
    [OpenAI data controls](https://platform.openai.com/docs/guides/your-data).
- **Current reading:** Google treats LLM output built from Maps Content as a case of
  the "create content" prohibition; it grants an exception only through Grounding
  Lite. Example (vi) shows Google treats re-expressing driving times in another form as
  prohibited. Sending route durations or trip lengths for the model to rewrite is
  therefore likely prohibited. Cadence's own yes/no conclusions are further from Maps
  Content, but still derived from it; no term addresses them. OpenAI keeps the input
  up to 30 days in abuse logs and does not train on it.
- **Risk level:** medium under the regime below; high without it.
- **Owner decision, 2026-10-18 (risk acceptance):**
  - Cadence may send the model only its own deterministic conclusions derived from
    Google route data. Examples: "run fits before the afternoon trip: yes", "travel
    day", "the Home Behavior does not fit today because of travel".
  - It never sends route durations, rounded trip lengths, leave-by times, or anything
    from which a route duration can be recovered. For example, a departure time shown
    next to an event time reveals the duration.
  - Exact timing stays in the calculated line beside the brief.
  - The owner accepts this as a business risk without asking Google first.
- **Status:** accepted risk.
- **Question to Google (sent 2026-10-23):** Google Maps Platform support case
  76805292, opened from the Cadence Cloud project (`habit-tracker-498717`) by
  info@identityscaffolding.com, as the owner decided on October 22. Issue type
  Technical, priority P4, contact by email. The case asks:
  - whether sending Cadence's own yes/no travel conclusions to the Daily Brief model,
    with no durations, distances, leave-by times or place data, complies with Maps
    Platform Terms 3.2.3(c);
  - whether Maps Grounding Lite (Service Specific Terms 10.2.1) is the only permitted
    path;
  - under what conditions the use would be permitted.
- **Support outcome (recorded 2026-10-29):** case 76805292 received an internal
  consultation, followed by a reply that Technical Support cannot authoritatively
  approve the architecture or determine compliance. Support referred Cadence to its
  own legal review and Google Sales for custom licensing, terms or exceptions.
  This is neither approval nor a finding of noncompliance. The binary-conclusion
  and Grounding Lite questions remain unresolved. See the
  [dated correspondence record](legal/2026-10-29-google-maps-case-76805292.md).
- **Owner direction, 2026-10-29:** save the correspondence in the legal documents
  and continue developing the feature set. This direction does not establish that
  compliance risk is absent or expand the October 18 accepted-risk limits. See
  [the decision record](DECISIONS.md#2026-10-29-google-maps-support-evidence-and-continued-development).
- **Next action (updated 2026-10-29):** continue under the existing accepted-risk
  regime; do not await an unspecified further support review or treat the response
  as clearance. Ticket 219 must test that no duration-bearing value reaches model
  input. The private briefing workbench keeps synthetic travel facts, because the
  existing reading of example (vii) bars testing or validating models with Maps
  Content. Further legal review or a Sales request needs the owner's instruction;
  record any substantive answer or permission here.
- **Open point (still unresolved after the October 29 reply):** a yes/no fit
  conclusion can bound route duration from one side. Example: a run ending 1:30 PM
  plus an event at 3:00 PM plus "fits: yes" implies the trip takes under 90 minutes.
  The October 23 owner decision held this point for Google's reply. That reply does
  not settle it. The options remain asking for an authoritative answer or sending
  only day-level conclusions (for example "travel day"); Ticket 219 should weigh
  the same option. No option is newly selected by this evidence update.

## L-002: Google coordinates sent to a non-Google provider

- **Question:** May Cadence send a coordinate obtained from Google Maps Platform,
  rounded to a coarse area or not, to a non-Google provider such as a weather API?
- **Affected:** Ticket 218 (weather area). Ticket 216 no longer needs Google
  coordinates after L-003's October 22 resolution. Files:
  `lib/services/travel-provider.ts`, `lib/services/travel-route-refresh.service.ts`.
- **Sources** (checked 2026-10-17):
  - Maps Platform Terms 3.2.3(a): "Customer will not export, extract, or otherwise
    scrape Google Maps Content for use outside the Services", including to "store,
    reshare, or rehost" it outside the services. 3.2.3(c) and example (iv), see L-003.
    [Maps Platform Terms](https://cloud.google.com/maps-platform/terms).
  - Service Specific Terms 6.3 (Geocoding), 14.3 (Places) and 19.3 (Routes) allow
    caching coordinates for 30 days. They grant no right to use them with another
    service. [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
- **Current reading:** no term permits it. The conservative reading is that it is not
  allowed, and rounding does not clearly remove the coordinate's Google origin.
- **Exposure today: none** (working tree checked 2026-10-18). Cadence stores place IDs
  only:
  - The hosted geocode request asks only for `results.placeId,results.granularity,results.types`
    (`lib/services/travel-provider.ts:19`). The API-key fallback receives coordinates
    in the response body and keeps only the place ID.
  - Routes are requested by place ID, and the routes field mask requests no
    coordinates.
  - The only coordinates in the system come from the device
    (`lib/services/travel-route-refresh.service.ts:312`).
- **Risk level:** low today. High if Cadence starts fetching Google coordinates and
  sends them out.
- **Owner decision:** none.
- **Status:** open.
- **Next action:** Ticket 218 derives the weather area from the device position. Any
  change that fetches Google coordinates cites this entry. Ask Google in writing if
  weather at each stop becomes a requirement.

## L-003: Ticket 216 radius comparison against Google coordinates

- **Question:** May Cadence compare the device position with Google coordinates of
  Home and saved places, using Ticket 216's 150 m and 400 m radii, to label
  completions?
- **Affected:** Ticket 216. It would add a coordinate fetch and a device-side coordinate
  cache that do not exist today (L-002).
- **Sources** (checked 2026-10-17):
  - Maps Platform Terms 3.2.3(c) example (iv): Customer will not "use latitude/longitude
    values from the Places API as an input for point-in-polygon analysis". 3.2.3(b): no
    caching except as the Service Specific Terms permit.
    [Maps Platform Terms](https://cloud.google.com/maps-platform/terms).
  - Service Specific Terms 6.3.1 (Geocoding coordinates, 30 days), 6.3.2 (indefinite
    per-user cache "solely to support the direct, End User facing functionality") and
    14.3 (Places coordinates, 30 days).
    [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).
- **Current reading:** a radius test is a point-in-circle check, a close analogue of
  the point-in-polygon example. The example names the Places API, but the list is
  illustrative, so Geocoding coordinates are likely covered too. Labels from this
  comparison would also reach model input as label counts (L-001).
- **Risk level:** none under the October 22 design. It was high for the design as
  first written.
- **Owner decision, 2026-10-22 (option B, relayed by the orchestrating agent session):**
  place positions come from the user's own device. The user records an "I'm here"
  marker at Home or a saved place, and Cadence compares the completion position with
  those markers. Cadence fetches no Google coordinates and compares nothing with them.
  `docs/DECISIONS.md` (2026-10-22, Ticket 216) records the decision.
- **Status:** resolved (design change). Reopen if Ticket 216 or a later ticket fetches
  Google coordinates or compares a position with them.
- **Next action:** none. Storing marker positions and labels is a privacy-text change,
  logged as `docs/MESSAGING_CHANGES.md` P-001.

## L-004: Google Weather API facts in model input

- **Question:** May derived Google Weather API facts reach OpenAI input?
- **Affected:** Tickets 218 and 219.
- **Sources** (checked 2026-10-17): Maps Platform Terms 3.2.3(c); Service Specific
  Terms 10.2.1 and section 21; the
  [Weather API policies](https://developers.google.com/maps/documentation/weather/policies),
  which allow "entirely new content" from Environment APIs with "Includes data from
  Google Maps" attribution.
- **Current reading:** unclear; the terms point both ways. Under the L-001 regime,
  forecast facts from Google would be Google content in model input, not Cadence
  conclusions from route data. The Google Weather API therefore conflicts with the
  regime.
- **Risk level:** none while Google Weather is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if Google Weather is reconsidered.
- **Next action:** none.

## L-005: Google Weather API shared one-hour cache

- **Question:** Would a one-hour server cache read by many users count as resharing
  "outside the services" under Maps Platform Terms 3.2.3(a)(i)?
- **Affected:** Ticket 218.
- **Sources** (checked 2026-10-17): Service Specific Terms 21.2 permits caching hourly
  forecast values for one hour with no per-user isolation rule; Geocoding 6.3.2, by
  contrast, requires isolation.
- **Current reading:** probably allowed, but not stated.
- **Risk level:** none while Google Weather is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if Google Weather is reconsidered.
- **Next action:** none.

## L-006: WeatherKit shared cache

- **Question:** Does a one-hour cache keyed by area and read by many users meet Apple
  Developer Program License Agreement Attachment 8 section 1.6 ("temporary and limited
  basis solely to improve the performance") and avoid section 1.5's "secondary or
  derived database"?
- **Affected:** Ticket 218.
- **Sources** (checked 2026-10-17):
  [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/),
  Attachment 8.
- **Current reading:** unclear.
- **Risk level:** none while WeatherKit is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if WeatherKit is reconsidered.
- **Next action:** none.

## L-007: WeatherKit facts in model input

- **Question:** May Cadence send transformed WeatherKit facts to OpenAI as a processor
  under Attachment 8 section 1.2? Does OpenAI's 30-day abuse-log retention count as
  storage by Cadence?
- **Affected:** Tickets 218 and 219.
- **Sources** (checked 2026-10-17): Apple Developer Program License Agreement,
  Attachment 8; [OpenAI data controls](https://platform.openai.com/docs/guides/your-data).
- **Current reading:** probably allowed for transformed data shown to users; sending it
  to a third-party model is not addressed.
- **Risk level:** none while WeatherKit is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if WeatherKit is reconsidered.
- **Next action:** none.

## L-008: Open-Meteo commercial status and upstream licences

- **Question:** Does Cadence count as commercial use under Open-Meteo's terms? Does any
  share-alike duty from upstream data pass to Cadence?
- **Affected:** Tickets 218 and 219; `docs/COSTS.md` weather row.
- **Sources** (checked 2026-10-17):
  - [Open-Meteo terms](https://open-meteo.com/en/terms): the free API is for
    non-commercial use only. Commercial use includes apps "that have subscriptions or
    display advertisements" and "Integrating our service into commercial products".
  - [Open-Meteo licence](https://open-meteo.com/en/licence): API data under CC BY 4.0;
    the UK Met Office source is listed as CC BY-SA.
- **Current reading:** Cadence has no subscription or advertising today, but the
  owner's US$5 per user price goal points to a subscription. The paid API Standard
  plan avoids the question. Open-Meteo offers its API output under CC BY 4.0, which
  suggests no share-alike duty reaches Cadence; the licence page does not say so
  directly.
- **Risk level:** medium on the free tier; low on a paid plan.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18. On 2026-10-22
  (relayed by the orchestrating agent session) the owner chose the plans: use the free
  Open-Meteo plan for development and testing. The paid API Standard plan is required
  before commercial use.
- **Status:** open until Cadence subscribes to API Standard.
- **Next action:** subscribe to API Standard before commercial use, then record the
  subscription date here and in `docs/COSTS.md`. Ask Open-Meteo about the UK Met Office
  share-alike only if Cadence will rely on that model.

## L-009: OpenWeather share-alike

- **Question:** Would CC BY-SA 4.0 make Daily Brief text an adaptation that must carry
  the same licence?
- **Affected:** Tickets 218 and 219.
- **Sources** (checked 2026-10-17):
  [OpenWeather terms of sale](https://openweather.co.uk/api/files/file/OpenWeather_T%26C_of_sale.pdf):
  products under CC BY-SA 4.0, data and database under ODbL.
- **Current reading:** unclear.
- **Risk level:** none while OpenWeather is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if OpenWeather is reconsidered.
- **Next action:** none.

## L-010: Tomorrow.io contract terms

- **Question:** Would a negotiated order permit a shared cache, commercial use and
  model input, and require naming Tomorrow.io as a third-party beneficiary?
- **Affected:** Ticket 218.
- **Sources** (checked 2026-10-17):
  [Tomorrow.io Subscription Terms](https://www.tomorrow.io/legal/terms-of-service/),
  last updated October 19, 2023.
- **Current reading:** self-serve accounts bar commercial use and storing unaltered
  data.
- **Risk level:** none while Tomorrow.io is not used.
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18.
- **Status:** resolved (moot). Reopen if Tomorrow.io is reconsidered.
- **Next action:** none.

## L-011: Weather privacy disclosure and attribution

- **Status:** moved to `docs/MESSAGING_CHANGES.md` P-003 on October 22, 2026. P-003 keeps
  the question, sources, reading and next action. Under the owner's October 22 rule it
  does not block development before the pre-launch privacy pass.

## L-012: Google Maps notices in Cadence's terms and privacy content

- **Question:** What must Cadence's terms of service and privacy content say now that
  travel routing uses Google Maps Platform and Cadence stores Google place IDs?
- **Affected:** Tickets 213 and 214 (monthly limit, place-ID storage), Ticket 165
  (travel release acceptance). Files: `components/settings/LegalContent.tsx` (Privacy
  "Travel routing", processors and retention tables; Terms "Travel routing limits"),
  `tests/legal-content.test.tsx`, `docs/qa/travel-release.md`.
- **Sources** (checked 2026-10-18;
  [Maps Platform Terms](https://cloud.google.com/maps-platform/terms), last modified
  August 26, 2026):
  - 3.2.2(a)(i): the application's terms of service will "notify users that the
    Customer Application includes Google Maps features and content" and state that use
    is subject to the Google Maps End User Additional Terms of Service
    (https://maps.google.com/help/terms_maps/) and the Google Privacy Policy
    (https://policies.google.com/privacy).
  - 4.4(a): Google collects request data, including "latitude/longitude coordinates",
    and may use and retain it under the Google Privacy Policy.
  - 4.4(c)(iii): notify users in advance of the types of data collected, and do not
    obtain or cache a user's location without "express, prior, revocable consent".
  - 3.2.2(b): display the attribution Google provides. The Timeline's travel details
    already show "Google Maps" with each estimate.
- **Current reading:** the live terms lacked the 3.2.2(a)(i) notice while hosted routing
  was enabled from September 22, 2026. The live privacy text still says routing is
  disabled and geocodes are not stored. After Ticket 214, Cadence stores place IDs,
  which the Routes and Geocoding policies permit indefinitely (`docs/COSTS.md`). The
  approved draft adds the 3.2.2(a)(i) notice and links, names Google Maps Platform as a
  processor, lists the data sent (including selected Calendar event location text),
  the foreground location reads, place-ID storage, the monthly usage total and
  deletion on turning travel off. Location reads rely on routing consent plus the
  operating system's location permission; either can be revoked.
- **Risk level:** medium until the draft is deployed; low afterwards.
- **Owner decision, 2026-10-18:** "Approved. Keep the LegalContent.tsx draft as is."
  Both pages and the retention table carry the date October 18, 2026, which should
  match the deployment date.
- **Status:** closed October 18, 2026. Production deployment
  `dpl_7ePteYsUBqwQHUfufXVrUJduEDL2` serves the approved notices; live readback passed.
- **Next action:** retain the verified notices with future releases; this entry is resolved. The Privacy statement that Cadence does not send behavior data
  to an AI provider is a separate conflict under Ticket 187, logged as
  `docs/MESSAGING_CHANGES.md` P-005.

## L-013: Google route warnings in the travel display

- **Question:** Do the Maps Platform terms require Cadence to show the route warnings
  Google returns, or may Cadence hide or reword them?
- **Affected:** Tickets 163 and 164. Files:
  `components/timeline/ExternalEventDetails.tsx` (`renderTravelTiming` prints every
  `estimate.warnings` string), `lib/services/travel-provider.ts` (reads up to 10
  `routes[0].warnings`). Plan: `docs/plans/2026-11-04-travel-departure-ux-review.md`.
- **Provider, clause, source and check date:** Google Maps Platform, Routes API. Not
  checked. Ticket 163 lists warnings among the provider obligations without citing a
  clause.
- **Current reading:** none. Logged from the November 4 review, which proposes showing
  only warnings a user can act on.
- **Risk level:** low.
- **Owner decision or risk acceptance:** none yet. Under the 2026-11-04 rule, this entry
  does not hold the copy work.
- **Status:** open.
- **Next action:** read the Routes API policies when convenient and record the clause.

## L-014: Last-known leave time after the five-minute window

- **Question:** May Cadence keep showing a leave time derived from a Google route
  estimate after five minutes, marked as a last estimate, instead of withdrawing it?
- **Affected:** Tickets 163, 164, 170, 214, 267 and 268. Files:
  `lib/services/travel-provider.ts` (`boundedExpiry`, 300 seconds),
  `packages/core/src/services/brief-travel-guidance.ts`,
  `components/timeline/ExternalEventDetails.tsx`, `lib/ui/travel.ts`. Plan:
  `docs/plans/2026-11-04-travel-departure-ux-review.md` (proposals P2 and P4; correction
  C1). Related messaging entry: P-018.
- **Provider, clause, source and check date:** Google Maps Platform general terms and
  Routes Service Specific Terms on caching, as summarized in `docs/COSTS.md` ("caching
  terms"). Not rechecked for this entry.
- **Current reading:** `docs/COSTS.md` calls the five-minute window "a conservative
  reading" and leaves open whether brief in-memory reuse during one viewing counts as
  caching. This also describes shipped behavior, not only a proposal: the drawer and
  dialog already keep the last times in memory after five minutes, with no mark
  (`renderTravelTiming` has no clock or stale input; checked November 4, 2026). Only the
  status line warns. Ticket 268 adds the label and keeps display data in `sessionStorage`
  across a reload, in the browser session only.
- **Kept across a reload (Ticket 268, `cadence:travel-session`):** one account and one local
  date. The route view: leg IDs (hashes), roles, commitment refs (event and Occurrence IDs),
  mode, ready times, provenance revisions (Calendar etags and the settings revision; a device
  origin keeps only its sample time), the Google-derived duration, departure and arrival times,
  provider warning text and attribution, observed and expiry times, segments and collisions,
  the weather summary when weather is on, `behaviorSources` (Occurrence IDs and learned
  durations) and `budget`. Also the refresh record: a source-key digest, trip keys, attempt
  times and the last device-routed time, and one digest per stop of its times, place and
  attendance. No coordinates, place text, event titles or Daily Brief token. Sign-out, account change, travel off, settings change and a new day clear it.
- **Risk level:** medium.
- **Owner decision or risk acceptance:** owner decision D1, November 4, 2026: "Last
  estimate and per-trip refresh" (`docs/DECISIONS.md`). That decides the product
  behavior. It does not answer the terms question. Under the 2026-11-04 rule, this entry
  holds nothing.
- **Status:** open.
- **Next action:** read the caching clauses again when convenient and record the reading.

## L-015: Leave reminder schedule derived from a route estimate

- **Question:** May Cadence store a next check time, derived in part from a Google route
  estimate, with a leave reminder? May a Mac notification keep a time derived from an
  estimate until it fires?
- **Affected:** Tickets 275, 277 and 280. Files: planned hosted reminder record;
  `apps/desktop/src/local-reminder.service.ts`. Plan:
  `docs/plans/2026-11-04-travel-departure-ux-review.md` (proposal P3). Related messaging
  entry: P-016.
- **Provider, clause, source and check date:** Google Maps Platform general terms and
  Routes Service Specific Terms on caching, as summarized in `docs/COSTS.md` ("caching
  terms"). Not rechecked for this entry.
- **Current reading:** none. The hosted record stores no durations, titles, places or
  positions. Its next check time and the Mac's scheduled time still depend on an estimate.
- **Risk level:** medium.
- **Owner decision or risk acceptance:** none on the terms question. Owner decision D3,
  November 4, 2026: "Yes, even with Cadence closed" (`docs/DECISIONS.md`). Under the
  2026-11-04 rule, this entry holds nothing.
- **Status:** open.
- **Next action:** read the caching clauses when convenient and record the reading.

## L-016: Calendar reads with no user session

- **Question:** Do Google's Calendar API terms and user data policy allow a hosted job to
  read a user's Calendar with no user session, for a reminder the user opted into?
- **Affected:** Tickets 276 and 277. Files: `lib/supabase/integration-token.ts`,
  `lib/services/google-calendar.service.ts`, the planned reminder job. Related messaging
  entry: P-017.
- **Provider, clause, source and check date:** Google API Services User Data Policy and
  the OAuth verification record. Not checked.
- **Current reading:** none. Logged from the November 4 plan.
- **Risk level:** medium.
- **Owner decision or risk acceptance:** none on the terms question. Owner decision D3,
  November 4, 2026: "Yes, even with Cadence closed" (`docs/DECISIONS.md`). Under the
  2026-11-04 rule, this entry holds nothing.
- **Status:** open.
- **Next action:** read the policy when convenient and record the clause.

## L-017: ChatGPT plan usage in a paid or hosted app

- **Question:** Does Cadence for Mac stay within OpenAI's ChatGPT plan program once Cadence
  charges for accounts, or because the signed-in Mac brief relies on Cadence's hosted server
  for its context? Would plan usage in the hosted web app need OpenAI's approval?
- **Affected:** Tickets 286–292. Files: the planned Mac connection
  (`apps/desktop/src-tauri`, `apps/desktop/src`) and hosted prepare and complete routes under
  `app/api/advisor/brief`. Decision: `docs/DECISIONS.md`, 2026-11-07, D25.
- **Provider, clause, source and check date:** OpenAI, Sign in with ChatGPT, token sharing
  for open-source apps: open-source and locally run apps may use a user's ChatGPT plan; a
  paid or remotely hosted app needs OpenAI's approval first.
  `https://developers.openai.com/siwc/llms-full.txt` and
  `https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt`. Read for the plan on
  November 7, 2026; not rechecked for this entry.
- **Current reading:** Cadence for Mac is MIT-licensed and runs locally, and the model call
  runs on the Mac with tokens kept there, so the first slice fits the program today. The
  hosted web app does not. Once Cadence charges for accounts, the Mac feature may need
  OpenAI's approval too. Whether hosted context preparation makes the Mac app "remotely
  hosted" is unclear.
- **Risk level:** medium.
- **Owner decision or risk acceptance:** none on the terms question. Owner decision D25,
  November 7, 2026: signed-in Mac users first; hosted web plan usage and billing deferred.
  Under the 2026-11-04 rule, this entry holds nothing.
- **Status:** open.
- **Next action:** the owner submits OpenAI's interest form
  (`https://openai.com/form/sign-in-with-chatgpt-interest/`) for plan usage in a paid, hosted
  app. Recheck before any billing ticket.

## L-018: Sign in with ChatGPT DevKit licence

- **Question:** May Cadence, a product of Identity Scaffolding LLC, use OpenAI's Sign in with
  ChatGPT DevKit code or React components?
- **Affected:** Tickets 287, 289 and 291. Files: the spike script under `scripts/`, the Mac
  connection and the Settings card.
- **Provider, clause, source and check date:** OpenAI, the DevKit's licence, which is
  noncommercial. Read for the plan on November 7, 2026; not rechecked for this entry.
- **Current reading:** a noncommercial licence does not fit Cadence. Cadence writes its own
  client from the public docs (`https://developers.openai.com/siwc/llms-full.txt`) and does
  not copy, vendor or depend on DevKit code or components. The public docs themselves are
  read, not copied as code.
- **Risk level:** low, while no DevKit code is used.
- **Owner decision or risk acceptance:** owner decision D25, November 7, 2026, adopts the
  plan that excludes DevKit code. Under the 2026-11-04 rule, this entry holds nothing.
- **Status:** open.
- **Next action:** reviewers of Tickets 287, 289 and 291 confirm no DevKit package, file or
  component is present.

## L-019: OpenAI brand guidelines for the ChatGPT button

- **Question:** Do the "Continue with ChatGPT" button, the ChatGPT name and any OpenAI logo in
  the Mac app's Settings follow OpenAI's brand and UI guidelines?
- **Affected:** Ticket 291. Files: the planned Settings card in
  `apps/desktop/src/settings-screen.tsx`. Related messaging entry: P-031.
- **Provider, clause, source and check date:** OpenAI, Sign in with ChatGPT UI and UX
  guidelines and brand guidelines.
  `https://developers.openai.com/siwc/ui-ux-guidelines.md`. Not checked for this entry.
- **Current reading:** none. The guidelines govern the button's wording, shape and logo use.
  Cadence's own marks stay reserved; OpenAI's marks are used only as the guidelines allow.
- **Risk level:** low.
- **Owner decision or risk acceptance:** none.
- **Status:** open.
- **Next action:** Ticket 291 reads the guidelines before building the card and records the
  clauses it follows.
