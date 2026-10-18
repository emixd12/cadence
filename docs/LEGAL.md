# Legal register

This file is the single place for Cadence's legal matters and questions: provider
terms, data licences, privacy obligations and the owner's risk decisions. Product
decisions that depend on an entry link to it from `docs/DECISIONS.md` or the ticket.

Readings here are the project's interpretation of public terms. They are not legal
advice. Earlier legal findings that predate this file stay in their tickets and plans
until someone moves them here.

## How to add or update an entry

1. Give a new entry the next ID (`L-013` is next). Never reuse an ID.
2. Fill in every field below. Quote the clause briefly and link the source.
3. When someone rechecks a source, update its check date and the reading.
4. Record an owner decision only from the owner's own words, with its date.
5. Link the entry ID from every ticket, plan or doc that depends on it.

Fields: question; affected tickets and files; provider, clause, source and check date;
current reading; risk level; owner decision or risk acceptance; status; next action.

Status values:

- **open**: unanswered. Work that depends on it waits or follows the conservative
  reading.
- **accepted risk**: the owner accepted the risk under stated limits. The question may
  still be asked.
- **resolved**: answered, or moot because the matter no longer applies. The entry says
  which.

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
| [L-003](#l-003-ticket-216-radius-comparison-against-google-coordinates) | Ticket 216 radius comparison against Google coordinates | open | high if built as written | 216 |
| [L-004](#l-004-google-weather-api-facts-in-model-input) | Google Weather API facts in model input | resolved (moot) | none | 218, 219 |
| [L-005](#l-005-google-weather-api-shared-one-hour-cache) | Google Weather API shared one-hour cache | resolved (moot) | none | 218 |
| [L-006](#l-006-weatherkit-shared-cache) | WeatherKit shared cache | resolved (moot) | none | 218 |
| [L-007](#l-007-weatherkit-facts-in-model-input) | WeatherKit facts in model input | resolved (moot) | none | 218, 219 |
| [L-008](#l-008-open-meteo-commercial-status-and-upstream-licences) | Open-Meteo commercial status and upstream licences | open | medium | 218, 219 |
| [L-009](#l-009-openweather-share-alike) | OpenWeather share-alike | resolved (moot) | none | 218, 219 |
| [L-010](#l-010-tomorrowio-contract-terms) | Tomorrow.io contract terms | resolved (moot) | none | 218 |
| [L-011](#l-011-weather-privacy-disclosure-and-attribution) | Weather privacy disclosure and attribution | open | medium | 218, 219 |
| [L-012](#l-012-google-maps-notices-in-cadences-terms-and-privacy-content) | Google Maps notices in Cadence's terms and privacy content | closed | low | 213, 214, 165 |

L-004 to L-011 came from the open questions in
`docs/plans/2026-10-17-weather-provider-comparison.md`. That plan's first question is
part of L-002.

## L-001: Google Maps content in Daily Brief model input

- **Question:** May Cadence send facts derived from Google Routes and Geocoding results
  to OpenAI as Daily Brief model input?
- **Affected:** Ticket 219 (model input), Ticket 218 (weather margin and mode rules),
  Ticket 216 (label counts, see L-003). Files: `TravelTimingModelProjection` in
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
- **Next action:** ask Google in writing whether the regime complies; this stays open.
  Ticket 219 must test that no duration-bearing value reaches model input. The private
  briefing workbench keeps synthetic travel facts, because example (vii) bars testing
  or validating models with Maps Content.

## L-002: Google coordinates sent to a non-Google provider

- **Question:** May Cadence send a coordinate obtained from Google Maps Platform,
  rounded to a coarse area or not, to a non-Google provider such as a weather API?
- **Affected:** Ticket 218 (weather area), Ticket 216 (see L-003). Files:
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
- **Risk level:** high if built as written.
- **Owner decision:** none. No design change yet.
- **Status:** open.
- **Next action:** resolve before Ticket 216 implementation. Options include asking
  Google, or comparing against coordinates that are not Google content.

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
- **Owner decision:** the owner selected Open-Meteo on 2026-10-18. The plan is not yet
  chosen; `docs/COSTS.md` assumes API Standard.
- **Status:** open.
- **Next action:** the owner confirms the plan before Ticket 218 implementation. Ask
  Open-Meteo about the UK Met Office share-alike only if Cadence will rely on that
  model.

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

- **Question:** What must the privacy content and the interface say once Cadence sends
  coarse areas to Open-Meteo and uses its forecasts?
- **Affected:** Tickets 218 and 219; privacy content, `docs/PRODUCT_SPEC.md`, the
  travel margin line and the Daily Brief.
- **Sources** (checked 2026-10-17):
  - [Open-Meteo terms](https://open-meteo.com/en/terms): logs may contain coordinates
    and are deleted after 90 days.
  - [Open-Meteo licence](https://open-meteo.com/en/licence): CC BY 4.0 credit, a
    licence link, a note of changes, and a link next to any displayed data.
  - Maps Platform Terms 4.4(c)(iii): notify users in advance about "the combination
    and use of End User's location with any other data provider's data".
- **Current reading:** the privacy content must name Open-Meteo as a recipient of
  coarse areas and its 90-day log retention. Weather-derived lines need Open-Meteo
  attribution nearby. The Google notice applies because travel already combines device
  position with Google routing.
- **Risk level:** medium until the disclosure ships.
- **Owner decision:** none.
- **Status:** open.
- **Next action:** draft the disclosure and attribution placement in Ticket 218 and
  Ticket 219's disclosure update.

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
- **Next action:** retain the verified notices with future releases; the deployment resolves
  this entry resolved. The Privacy statement that Cadence does not send behavior data
  to an AI provider is a separate conflict under Ticket 187.
