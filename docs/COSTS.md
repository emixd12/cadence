# Cost estimates

This file records what Cadence costs to run, per month and per user. It is a
planning ledger, not an invoice record. Every price lists its source and the
date someone checked it. Every usage figure is an assumption until a measured
value replaces it.

## Goal

The owner's aspirational price is US$5 per user per month for all functionality.
This is a goal, not a directive. Use this file to see whether a feature keeps a
typical user under that price, and which users exceed it.

## How to add or update a cost

1. Add a row to the fixed or variable table below. Name the provider, the
   billable unit, the list price, the source URL and the check date.
2. State the usage assumption for light, typical and heavy users. Mark it
   `assumed` or `measured`.
3. Recalculate the per-user totals.
4. Add a line to the change log at the bottom.

Add a row in the same change as any feature that adds a paid provider call.
Replace an assumption with a measured figure when billing or provider usage
data becomes available.

## User profiles

| Profile | Description |
| --- | --- |
| Light | Uses the Timeline most days. Travels to a located place about twice a week. |
| Typical | Daily use. About 20 travel days a month, two located places per travel day. |
| Heavy | Several devices. About 26 travel days a month, four located places per day. |

## Fixed monthly costs

These costs do not grow with each user.

| Item | List price | Monthly | Source | Checked | Notes |
| --- | --- | --- | --- | --- | --- |
| Vercel Pro | US$20 per developer seat; includes US$20 usage credit | US$20 | [Vercel pricing](https://vercel.com/pricing) | 2026-10-16 | One seat assumed. Usage beyond the credit is variable. |
| Supabase Pro | From US$25; includes US$10 compute credit, 100,000 MAU, 8 GB disk, 250 GB egress | US$25 | [Supabase pricing](https://supabase.com/pricing) | 2026-10-16 | Micro compute covered by the credit. |
| Apple Developer Program | US$99 per year | US$8.25 | Apple, not rechecked | — | Required for signed macOS builds. |
| Domain `cadence-me.com` | About US$10–11 per year | About US$0.90 | Cloudflare Registrar, not verified | — | Replace with the renewal invoice amount. |
| Sequenzy | Plan not recorded; public free allowance 2,500 emails per month | Unknown | [Sequenzy pricing](https://www.sequenzy.com/pricing) | 2026-08-01 | `docs/SEQUENZY_WORKFLOW.md` requires the owner to record the plan. |
| Open-Meteo API Standard (weather, Ticket 218) | US$29 per month for 1 million calls | US$0 while testing on the free API; US$29 before commercial use | [Open-Meteo pricing](https://open-meteo.com/en/pricing) | 2026-10-17 | Selected 2026-10-18. On 2026-10-22 the owner chose the free API for development and testing; API Standard is required before commercial use (`docs/LEGAL.md` L-008). Not subscribed. |
| **Total known** | | **About US$54 today; about US$83 with the paid weather plan** | | | |

Fixed cost per user: about US$5.42 at 10 users, US$0.54 at 100 users and
US$0.05 at 1,000 users. With the paid weather plan: about US$8.30, US$0.83 and US$0.08.

## Variable costs per user per month

### Summary

Figures use the efficient travel design described below. Tickets 213–214
implement most of it in source; it is not deployed yet.

| Cost | Light | Typical | Heavy | Status |
| --- | --- | --- | --- | --- |
| Travel, walking/cycling/transit | US$0.23 | US$1.30 | US$3.45 | Disabled in production since 2026-09-25 |
| Travel, driving | US$0.37 | US$2.14 | US$5.73 | Disabled in production since 2026-09-25 |
| Daily Brief model | US$0.06 | US$0.13 | US$0.25 | Live |
| Duration estimate model, incremental | US$0.015 | US$0.030 | US$0.060 | Opt-in recipe 1.1/1.2 candidates only; excluded from the production-default totals |
| Weather (Open-Meteo) | US$0 | US$0 | US$0 | Ticket 218 in source; free API for testing only. The paid fixed plan covers up to 1 million calls a month |
| Email reminders | Unknown | Unknown | Unknown | Live, optional per Behavior |
| Vercel and Supabase usage beyond included credit | Not measured | Not measured | Not measured | Live |
| Browser push, Google sign-in, Google Calendar API | US$0 | US$0 | US$0 | No per-call charge |

### Per-user total at 100 users

| | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Fixed share | US$0.54 | US$0.54 | US$0.54 |
| Travel (transit / driving) | US$0.23 / US$0.37 | US$1.30 / US$2.14 | US$3.45 / US$5.73 |
| Daily Brief | US$0.06 | US$0.13 | US$0.25 |
| **Total before payment fees** | **US$0.83–0.97** | **US$1.97–2.81** | **US$4.24–6.52** |

The paid weather plan adds US$0.29 per user at 100 users: totals become US$1.12–1.26
(light), US$2.26–3.10 (typical) and US$4.53–6.81 (heavy). The free testing API adds
nothing.

If the description-estimate candidate is promoted, the assumed extra model call
below adds US$0.015 / US$0.030 / US$0.060 respectively. Before planned weather and
payment fees, the corresponding scenario totals are about US$0.85–0.99,
US$2.00–2.84 and US$4.30–6.58. The production default remains recipe 1.0.

Typical users fit under US$5. Heavy drivers do not, unless a per-user travel
limit applies (see proposals). Payment processing would take more on top of
these totals (see payment fees).

### Google's free monthly allowance

Google applies a free allowance per billing account and SKU, shared by all
users: 10,000 Compute Routes Essentials calls, 5,000 Compute Routes Pro calls
and 10,000 geocodes. At list price that covers up to about US$150 of usage a
month. The per-user figures above ignore it, so early costs will be lower.

## Travel estimates

### Prices

Source: [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
and [Routes usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing),
checked 2026-10-16. Prices are per call, up to 100,000 calls a month.

| SKU | Price | When Cadence uses it |
| --- | --- | --- |
| Compute Routes Essentials | US$0.005 | Walking, cycling, transit (assumed; transit tier not confirmed) |
| Compute Routes Pro | US$0.010 | Driving, because the code sends `TRAFFIC_AWARE_OPTIMAL` |
| Geocoding | US$0.005 | Looking up a place from typed text |
| Compute Route Matrix | Same price per element | Not used; it saves round trips, not money |

### Caching terms constrain the design

Checked 2026-10-16 in the
[Maps Platform Terms](https://cloud.google.com/maps-platform/terms), section 3.2.3(b), and the
[Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms),
section 19.3:

- The general terms prohibit caching Google Maps content except where the
  Service Specific Terms expressly permit it.
- For the Routes API, those terms permit caching only latitude and longitude
  values, for up to 30 consecutive days.
- The [Routes policies](https://developers.google.com/maps/documentation/routes/policies)
  state that place IDs are exempt and may be stored indefinitely.

So Cadence may store place IDs and may keep coordinates for 30 days. It may not
keep route durations for hours and reuse them. A leg shown later in the day
needs a new route call. The current five-minute display window is a
conservative reading. Whether brief in-memory reuse during one viewing counts
as caching is a legal interpretation this file does not settle.

The general terms also prohibit using Google Maps content to train, test,
validate or fine-tune machine-learning models (section 3.2.3(c)(vii)). Review this
before sending travel facts to the Daily Brief model. On 2026-10-18 the owner
accepted the model-input risk under a conclusions-only regime (`docs/LEGAL.md` L-001).

### Efficient design assumptions

- Look up each place once and store its place ID. Typed Calendar locations are
  looked up once per new location.
- Route only legs that need travel. Skip Behaviors that can happen anywhere,
  remote events and consecutive stops at the same place.
- On a Timeline open with no current estimate, route only legs departing in
  the next three hours.
- Never route because of a status change, a Note edit or window focus.
- Route the whole day once when the Daily Brief is generated.
- Driving: use traffic-aware Pro routing only within about an hour of
  departure. Use Essentials for later legs. Make one call per leg; the current
  code makes two.

| Assumption | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Travel days per month | 8 | 20 | 26 |
| Timeline opens needing an estimate per travel day | 3 | 6 | 10 |
| Legs in the three-hour window per open | 1 | 1.5 | 2 |
| Legs routed for the Daily Brief per travel day | 2 | 3 | 5 |
| **Route legs per month** | **40** | **240** | **650** |
| New places looked up per month | 5 | 20 | 40 |

Cost per leg: US$0.005 for walking, cycling and transit. About US$0.0085 for
driving, assuming half the legs fall within an hour of departure and 10% of calls are retried.

### Ticket 214 implementation, in source 2026-10-18

Implemented: place IDs stored per typed text (`travel_place_cache`), only legs
leaving or arriving within three hours routed on a Timeline open, no refresh on
status, Note or focus changes, traffic-aware Pro routing only within about an hour
of departure, one call per leg, and skipped legs between consecutive stops at the
same place. A generated Daily Brief requests whole-day routing once within the
existing eight-leg bound. Foreground position checks run once per minute without
provider calls unless movement exceeds 500 m beyond both accuracy radii.
Measured calls per refresh and server duration need production use
after deployment; enable `CADENCE_PERF_LOG=1` to log `travel.place_lookups` and
`travel.route_legs` counts and durations.

### Pre-Ticket 214 code, for comparison

The pre-Ticket 214 code re-geocoded every location except home on every refresh. It
routes every leg and makes two Pro calls per driving leg. A status change
starts a refresh. On 2026-09-23 the owner account used 24 refreshes in one
day. At about 5–8 calls per refresh, a user with that pattern would cost
roughly US$15–35 a month. This is an estimate, not billed cost.

Production admissions stopped on 2026-09-25 when the nonrenewing 40-refresh
pilot budget ran out. Hosted ledger readback on 2026-10-16: 7, 24, 4 and 5
admissions on September 22–25.

## Daily Brief model

Provider: OpenAI `gpt-5.6-luna` (`lib/services/daily-brief-openai.ts`), with
`max_output_tokens: 2000` and low reasoning effort. Price: US$0.20 per million
input tokens and US$1.20 per million output tokens, recorded 2026-09-07 in
`docs/qa/2026-09-07-note-suggestion-provider-evaluation.md`.

| Assumption | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Briefs per month | 15 | 30 | 60 (two devices) |
| Input tokens per brief | 12,000 (assumed) | 12,000 (assumed) | 12,000 (assumed) |
| Output tokens per brief, including reasoning | 1,500 (assumed) | 1,500 (assumed) | 1,500 (assumed) |
| **Monthly cost** | **US$0.06** | **US$0.13** | **US$0.25** |

About US$0.004 per brief. The database allows one completed attempt per
installation per day. Token counts are not recorded yet; the workbench reports
usage as `unavailable`. Replace the assumptions with measured usage.

### Ticket 188 candidate duration estimates

Recipes 1.1 and 1.2 can opt into one additional model request before each brief.
`generateOpenAIDurationEstimates` uses the same model, transport and 2,000-token
output ceiling. It sends at most 20 Behavior titles and descriptions, with each
description capped at 1,000 characters. Recipe 1.2 also requests the `alongside`
classification. No estimate call runs for recipe 1.0, when the input is disabled,
or when no Behavior qualifies. The shared abort signal bounds both requests;
the estimate request adds no automatic retry.

For planning only, assume 2,000 input tokens and 500 output tokens per estimate
request, and 15 / 30 / 60 requests per month. Using the historical rates above
(recorded September 7; not rechecked in this review), that adds US$0.001 per
estimated brief, or US$0.015 / US$0.030 / US$0.060 monthly. Tokens and billed cost
remain unmeasured. Recheck provider rates and measure both calls before promoting
the candidate or treating these assumptions as a budget limit.

## QA-only acceptance model calls

The MCP acceptance runners (`npm run mcp:accept:clients`, Tickets 251 and 256)
call paid models on the owner's QA API keys. These are test costs, not product
usage. They are excluded from the per-user totals above. Prices checked
2026-10-31: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
and [OpenAI GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

| Client | Model and billing | List price per million tokens | Limits in `scripts/acceptance/clients.mjs` | Cost per scenario run |
| --- | --- | --- | --- | --- |
| `anthropic-api` | Anthropic `claude-opus-5-5`, Messages API with the MCP connector | US$4 input, US$20 output | At most 12 requests, each with `max_tokens` 4,096 | Output at most US$0.98. Input assumed at 15,000 tokens per request, about US$0.72. About US$1.70 at most (assumed) |
| `openai-api` | OpenAI `gpt-6-luna`, Responses API `mcp` tool | US$0.10 input, US$0.50 output | One request, `max_output_tokens` 4,096, `max_tool_calls` 12 | Input assumed at 30,000 tokens. About US$0.005 at most (assumed) |
| `claude-code` with `--claude-auth api-key` | Anthropic `claude-opus-5-5` through Claude Code | As above | `--max-budget-usd 1`, `--max-turns 12` | At most US$1 |
| `claude-code` on a subscription, `claude-ai`, `inspector`, web and guided runs | Owner's Claude or ChatGPT subscription, or no model | No API charge | — | US$0 |

Each runner run covers one scenario (`read-write`, `read-only` or `step-up`) per
client. Running all three scenarios on both API clients and `claude-code` with an
API key costs at most about US$8.10 (assumed). The runners record input tokens,
output tokens and Claude Code's reported cost in each run's evidence; none of
those measurements are copied here yet. Replace the input assumptions with measured
figures from a run's `evidence.json`.

## Weather

Provider: Open-Meteo, selected 2026-10-18 (Ticket 218). On 2026-10-22 the owner
chose the free API (no key) for development and testing. The free API is for
non-commercial use only; API Standard, US$29 per month for 1 million calls (checked
2026-10-17 on [Open-Meteo pricing](https://open-meteo.com/en/pricing)), is required
before commercial use. Not subscribed. Switching needs only server configuration:
`CADENCE_WEATHER_BASE_URL` and `CADENCE_WEATHER_API_KEY`. Weather stays off until
`CADENCE_WEATHER_PROVIDER_CLEARANCE=approved`.
The comparison is in `docs/plans/2026-10-17-weather-provider-comparison.md`.

Cadence requests one forecast per coarse area (0.1° grid) per clock hour and shares
it across users. Each forecast covers 48 hours. The cache lives in server memory, so
each running server instance fetches its own copy; multiply the figures below by the
typical number of warm instances. Only a travel refresh with at least one leg and a
usable device position requests weather. Requests per user before sharing, all
assumed:

| Assumption | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Daily Briefs × coarse areas per brief | 15 × 1.5 | 30 × 2 | 60 × 3 |
| Travel days × hours with a Timeline estimate × areas | 8 × 2 × 1 | 20 × 4 × 1.5 | 26 × 6 × 2 |
| **Requests per month** | **about 40** | **about 180** | **about 490** |

At 1,000 typical users that is about 180,000 requests a month; at 1,000 heavy
users, about 490,000. Both fit the 1 million call plan, so weather adds no
variable cost. The free tier allows 10,000 calls a day, 5,000 an hour and 300,000 a
month, for non-commercial use only (`docs/LEGAL.md` L-008); testing stays far below
that.

## Payment fees

Payment and subscription infrastructure is out of scope for v1. When it
arrives, fees reduce the US$5:

- A typical card processor charges about 2.9% plus US$0.30, about US$0.45 per
  US$5 charge (not verified).
- Mac App Store small-business commission is 15%, US$0.75 per US$5
  (not verified).

## Owner decisions

- 2026-10-17: travel spend has an absolute ceiling of US$5 per user per month
  at Google list price (Ticket 213). Implemented in source on 2026-10-18 as
  `reserve_travel_provider_spend`: each call reserves US$0.005 (geocode, Routes
  Essentials) or US$0.010 (Routes Pro, and transit until its SKU is confirmed)
  before it runs. A deployment-wide circuit breaker refuses reservations above
  US$10 per UTC day (assumed for a small user count; raise it as users grow). The ceiling is permissive. The target is
  the efficient design above, about US$1.30–2.14 for a typical user. Heavy
  drivers (about US$5.73 estimated) would reach the ceiling before month end.
  Confirmed by the owner on 2026-10-22: the ceiling applies per user per calendar
  month, in the user's timezone, and covers Google Maps calls only.
- 2026-10-18: Open-Meteo is the weather provider (Ticket 218). This file assumes
  the API Standard plan, US$29 per month; not subscribed.
- 2026-10-22: development and testing use the free Open-Meteo plan. The paid API
  Standard plan is required before commercial use (`docs/LEGAL.md` L-008, open until
  subscribed).

## Proposals awaiting owner decision

- Keep an account-wide Google Cloud budget alert.
- Record Sequenzy's plan and per-email price.
- Record Daily Brief token usage per attempt to replace the assumptions.

## Change log

- 2026-10-16: Created. Added fixed costs, travel and Daily Brief estimates,
  and the Routes caching-terms finding.
- 2026-10-17: Recorded the US$5 per-user monthly travel ceiling (Tickets
  213–219) and the pending weather provider.
- 2026-10-18: Tickets 213–214 in source: per-call reservations, the US$10 daily
  circuit breaker, place-ID storage and the three-hour routing window.
- 2026-10-18: Recorded Open-Meteo as the weather provider (planned US$29 fixed
  cost) and linked the model-input risk acceptance in `docs/LEGAL.md`.
- 2026-10-22: Ticket 218 in source. Weather uses the free API for testing, one
  48-hour forecast per area per hour per server instance, and costs nothing until the
  paid plan starts.
- 2026-10-22: Recorded the confirmed travel budget posture, the free Open-Meteo plan
  for development and testing, and backlog Ticket 243 for six-leg speed.
- 2026-10-24: Recorded Ticket 188's optional second model request and incremental
  candidate cost assumptions. Production-default totals remain unchanged.
- 2026-10-31: Recorded the QA-only Anthropic and OpenAI calls made by the MCP
  acceptance runners. They are excluded from the per-user totals.


October 18 local acceptance: a cold two-place fixture makes two geocodes; a warm
refresh makes zero geocodes. Each routed leg makes one Routes call, with at most
one reserved transient retry across the batch. Title-only Calendar revisions,
status, Note, focus and stationary position checks make no provider call. These
are automated fixture counts, not production measurements. The private workbench
shows the authenticated owner's month-to-date reserved list-price spend; no new
paid call supports that readback.

### Tickets 213–214 production measurements — October 18, 2026

Owner QA reserved US$0.115 under the approved US$0.50 cap. Cloud Monitoring
confirms seven geocodes and eight route calls, all 200. Initial Calendar text
used five geocodes and no routes; two temporary street-address corrections used
two geocodes and two routes. Each of three identical refreshes then used zero
geocodes and two routes. Calendar and saved-place records stayed unchanged.
Four successful two-leg requests measured server p50 3.3562 s and nearest-rank
p95 3.5984 s. Six-leg and multi-user loads were not measured; Ticket 243 tracks the
six-leg and before/after measurements. See
`docs/qa/travel-release.md` for sample counts, dates and baseline limits.

Final review-fix verification added two cached-place routes and zero geocodes.
Total reserved spend is US$0.135; Cloud Monitoring confirms seven geocodes and ten
routes, all 200. That final request completed in 4.159 s in the browser. Server
sampling was off, so it is excluded from the server percentiles above.
