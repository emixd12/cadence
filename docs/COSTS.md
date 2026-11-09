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

These describe today's model. Owner decision D1 replaces the three-hour and focus rules
when Tickets 267 and 268 ship; see "Travel advisory revamp usage model" below. Ticket 267
puts the refresh plan in source; clients follow it once Ticket 268 ships. Released clients
keep the three-hour `timeline` scope until they update.

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

### Travel advisory revamp usage model, assumed

Tickets 267, 268 and 277 (owner decisions D1 and D3, `docs/DECISIONS.md`, 2026-11-04). All
figures are assumed, using the prices and profiles above. Ticket 284 replaces them with
measured figures. This is a plan, not a shipped cost, so the summary tables above stay on
today's model until the tickets ship.

| Per month | Light | Typical | Heavy |
| --- | --- | --- | --- |
| Today's model, route legs | 40 | 240 | 650 |
| Today's model, cost with lookups | US$0.23–0.37 | US$1.30–2.14 | US$3.45–5.73 |
| First open of the day, whole-day pass, legs | 16 | 60 | 130 |
| Open with a last estimate, legs | 0 | 0 | 0 |
| Source change, movement over 500 m or Refresh travel, legs | 4 | 20 | 52 |
| 3-hour and 30-minute trip refreshes, legs | 16–32 | 60–120 | 130–260 |
| Trip with no estimate, fallback, legs | 0 | 0 | 0 |
| Reminder job, legs | 24 | 120 | 312 |
| Tomorrow's first trip (Ticket 282), legs | 8 | 20 | 26 |
| **Proposed, route legs** | **68–84** | **280–340** | **650–780** |
| **Proposed, cost with lookups** | **US$0.37–0.74** | **US$1.50–2.99** | **US$3.45–6.83** |

Ticket 267 replaced the earlier draft rows with the refresh plan's counts, November 5,
2026. All rows stay assumed. Showing last estimates removes re-routing on opens, which
is 180 of the 240 typical legs today. The trip refreshes and reminders spend most of it
again. Decision D15's third reminder route (November 6, 2026) adds 8, 40 and 104 legs, one
per trip. Ticket 282 (November 6, 2026) adds tomorrow's first trip: one leg the evening before
each travel day, at US$0.005 to US$0.0085 a leg, so US$0.04–0.07, US$0.10–0.17 and
US$0.13–0.22 a month. The heavy upper bound, US$6.83, now passes both today's figure and the
US$5 ceiling. Automatic refreshes stop at US$4.00, 80% of the ceiling. So does the reminder update
route (decision D16, Ticket 277): from 80% the job closes the check without a call. The plan
and send routes continue until the ceiling, where the reservation refuses them and the
reminder fails with `budget_refused`. Spend therefore stays at or under US$5, but a heavy
driving user can lose updates from 80% and reminders near month end.

Measured with a fake clock through the real client hook and the real hosted service
(`tests/travel-refresh-day.dom.test.tsx`, Ticket 268, November 5, 2026; provider, database and
Calendar reads mocked, walking, so one provider call per leg):

| Day | Route requests | Legs |
| --- | --- | --- |
| Typical: Dentist 9–10 AM, Gym 1–2 PM, home; hourly focus, a remount and a reload | 6 | 8 |
| Heavy: four stops, focus every 15 minutes | 10 | 14 |
| Moving 1 km a minute for 45 minutes, Timeline focused, typical day | 5 | 7 |

The typical day is one whole-day pass of 3 legs, then 5 trip refreshes of 1 leg, inside the
typical row (3 legs for the first open, 3 to 6 for trip refreshes). The heavy day is 5 legs
plus 9 refreshes, under the plan's bound of 15. Movement over 500 m refreshes only the next
trip that leaves from the device, at most once every 10 minutes after the last request that
routed from the device: here the first open plus 4 one-leg refreshes. Before this fix the
same 45 minutes made 46 requests and 138 legs. A user moving all day with an outbound trip
ahead could add up to 6 legs an hour while the Timeline is focused; the assumption below of
0.5 to 2 legs per travel day for source changes, movement and Refresh travel describes a
mostly stationary user. Transit doubles each figure.

Calls per trigger, from `resolveTravelRefreshPlan` in
`packages/core/src/services/travel-refresh-policy.ts` and the hosted route. Transit makes
two provider calls per leg.

| Trigger | Request | Route legs |
| --- | --- | --- |
| First open of a local date, with or without the Daily Brief | whole day | every planned leg, at most eight |
| Open with a last estimate and no change | none | 0 |
| Source change | whole day | every planned leg |
| Device moved more than 500 m, Timeline focused, at most every 10 minutes (Ticket 268) | next trip from the device | 1 |
| Within 3 hours of a known leave time, once, Timeline visible and focused | that trip | 1 |
| Within 30 minutes of a known leave time, once, same condition | that trip | 1 |
| After 5 PM, or once today has no trip left, with a located stop tomorrow; once per first stop and its revision (Ticket 282) | tomorrow's first trip, from Home | 1 |
| Trip with no estimate, once its appearance time comes | that trip | 1 |
| Refresh travel | whole day | every planned leg |
| At 80% of the monthly ceiling | none, except Refresh travel | 0 |
| Trip home from a last stop at Home | not planned | 0 |
| Leg ready only after its destination ends | not routed | 0 |

Assumptions and limits:

- Travel days per month: 8, 20 and 26. Planned legs per travel day: 2, 3 and 5.
- Every planned trip with a known leave time gets one or two trip refreshes. A check
  already within 3 hours, or within 30 minutes, of leaving counts as that refresh, so
  a trip checked late gets fewer. The lower bound is one per trip. The upper bound
  assumes the Timeline is visible and focused at both times.
- Source changes, movement and Refresh travel together: 0.5, 1 and 2 legs per travel day.
- Fallback: none assumed, because the whole-day pass gives every trip an estimate. It
  routes only a trip that has none, once.
- Lookups: 5, 20 and 40 new places per month at US$0.005. Cost per leg US$0.005, and
  US$0.0085 for the driving upper bound.
- Not routing a trip home from Home, or a leg ready only after its destination ends,
  saves one call each, and two by transit. Not counted in the table.
- Reminder job: three route calls per trip, with every trip's account opted in: plan,
  send, and one after sending to check for the update (decision D15, Ticket 275, November
  6, 2026). Trips per month are the planned legs less the trip home, which gets no
  reminder: 8, 40 and 104. The third call is skipped when the named leave time has passed
  by its check, and from 80% of the monthly ceiling (decision D16), so this is close to an
  upper bound. The database refuses a fourth route per trip. The Mac's update makes no call
  of its own.
- Ticket 277's job lists an account's trips at most every 30 minutes with a request that
  names no planned trip, so the listing makes no route call. A place lookup it needs is the
  same one the Timeline makes, reserved first and kept for a year. The job routes only the
  trips due. Each visit also re-reads Calendar, which costs nothing per call.
- Tomorrow's first trip (Ticket 282): one request the evening before each travel day, so 8,
  20 and 26 legs a month. It routes one leg, from Home to tomorrow's first stop away from
  Home, and looks up at most two places: that stop and Home, both usually stored already, so
  the lookup row is unchanged. It makes no weather call and is automatic, so it stops at 80% of
  the monthly ceiling. It asks once per browser tab session and once per Mac app session, so a
  second tab or a linked Mac open the same evening makes another call. A changed first stop, or the same stop with a new time or place,
  asks again, one leg each. A failed request is tried once more after 5 minutes, the
  existing failure wait; a quota, clearance or sign-in failure is not. A failure usually makes
  no route call, so a retry adds at most one leg. Assumed: one per
  travel day. Measured by Ticket 284. Transit doubles each figure.
- Outlook and iCloud events (Ticket 283, November 6, 2026) route under the same plan as Google
  Calendar events, so the planned legs per travel day above already count them; the table does
  not change. A person whose located events are only in Outlook or iCloud moves from no travel
  days into the matching profile. Microsoft Graph and iCloud CalDAV reads cost nothing per
  call. Each route request reads each connected Calendar twice, at the start and in the final
  check.
- Ticket 264 adds two kinds of route call, both assumed and not in the table:
  - A late transit leg makes one more call, from the ready time, reserved first at
    US$0.010. Other modes make no extra call. Assumed: rare, at most a few a month.
  - A trip home or onward trip from an event under way now routes during that event, when
    it falls inside the routing window. Before, those legs stopped at the event's start.
    Assumed: one extra leg per routing open during an event, at the leg's usual rate.
    Not measured. Ticket 284 measures it.
- A heavy user can reach the US$5 ceiling near month end, especially by transit, which the
  code reserves at the higher US$0.010 rate until its SKU is confirmed.
- Automatic refreshes stop at 80% of the monthly ceiling. Refresh travel and reminder
  checks continue (Ticket 267).

### Ticket 284 production measurements, November 6, 2026

Measured on production with test account A, one walking day: a Behavior with a place at 2:30 PM,
a Calendar event at 5:30 PM, the trip home and tomorrow's first trip. Evidence and times are in
`docs/qa/travel-release.md`, "Ticket 284". Source: Cloud Monitoring request counts for the
production project and the account's reserved-spend ledger, which agreed to the cent.

| Measured | Value |
| --- | --- |
| Route calls, 12:20 PM to 6:30 PM | 91 (all HTTP 200) |
| Place lookups | 4 (Home, two Calendar places and one Behavior place) |
| Reserved spend | US$0.48, under the owner's US$5 cap for this test |
| Leave reminder job, per trip | 3 routes (plan, send, one update check), measured on both trips |
| Tomorrow's first trip | 1 route, the evening before |
| A new browser tab, first open of the day | a whole-day pass, every planned leg |

What this replaces in the assumed model above:

- Reminder job: three routes per trip is now measured, not assumed.
- Tomorrow's first trip: one route per evening is now measured. It is asked for once per tab
  session, as the assumption says.
- New tabs: each new tab or device user agent made its own whole-day pass. About 60 of the 91 calls
  came from the test's own emulated device tabs and mode checks, so a person who keeps one tab
  open spends far less. The "first open of the day" row assumes one tab per day; several tabs a day
  multiply it.
- Not measured: a typical month, Transit at scale, Ticket 264's extra legs during an event, and a
  second user. The per-profile totals stay assumed.

### Production readback, November 4, 2026

Read-only aggregate readback. No user IDs, places or event details were read.

- Reserved route spend: October US$0.17, of which US$0.135 was the October 18 QA. November
  so far US$0.03. Total US$0.20.
- Travel estimates are on for 1 of the 7 accounts with a travel settings row. That account
  has Home. Whether the others are test accounts: not checked.
- Active push subscriptions: 1 account.
- Vercel has `CADENCE_TRAVEL_PROVIDER_CLEARANCE`, `TRAVEL_CONCLUSIONS_SIGNING_SECRET`,
  `CADENCE_PERF_LOG` and `CADENCE_INTEGRATION_JWT_SIGNING_KEY`. It has no
  `CADENCE_WEATHER_PROVIDER_CLEARANCE`, so weather is still off. Values were not read.

This means the summary table's "Disabled in production since 2026-09-25" status and the
line "it is not deployed yet" above are out of date. They were not rewritten in this
change, and the cost figures they sit beside are unchanged.

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
installation per day. The token figures above stay assumed until someone measures
them.

Ticket 288 records usage per model call. The OpenAI adapter reads the Responses API
`usage` object (`input_tokens`, `input_tokens_details.cached_tokens`,
`output_tokens`, `output_tokens_details.reasoning_tokens`). It reports usage even
when Cadence then rejects the output, because the provider still billed the call.
Usage is never returned to the app.

How to measure now:

- Production: set `CADENCE_PERF_LOG=1`. Each `daily_brief.model` performance event
  then carries `usage_calls`, `input_tokens`, `cached_input_tokens`,
  `output_tokens` and `reasoning_tokens` in `counts`, on success and on failure. A
  failed event also carries `error_reason`, such as `validation_word_limit` or
  `provider_incomplete_max_output_tokens`, beside the public `error_code`. A count
  the provider did not report is omitted.
- Workbench: each comparison result and each saved run under
  `.local/briefing-bench/` carries `usage`, one entry per model call (`brief` or
  `duration_estimate`). The review packet prints usage per run. The sequence report
  prints totals across all attempts and counts failure reasons.

Multiply measured input and output tokens by the provider rates above. Cached input
tokens are part of `input_tokens`; this file does not yet record a cached-input
price, so treat them at the full input rate until someone checks it. Reasoning
tokens are part of `output_tokens`.

### Ticket 290 workbench candidate models

The development workbench can run a candidate on another model, another reasoning
effort or the consolidated prompt. Extra models come only from
`CADENCE_BRIEFING_BENCH_MODELS`; the source names no model other than
`DAILY_BRIEF_MODEL`. These choices are workbench-only. A candidate model may cost
more per call than `gpt-5.6-luna`, and a higher effort usually adds reasoning
tokens, which bill as output. Check the provider rate for a candidate model before a
long sequence, and read each run's recorded `usage`. The workbench call budget
(`CADENCE_BRIEFING_BENCH_CALL_LIMIT`) limits the number of calls, not their price.
The duration-estimate call keeps the production model and effort.

Nothing changes in production cost. The live Daily Brief still sends
`DAILY_BRIEF_MODEL` with low effort and the layered prompt; a test pins its request
body.

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
remain unmeasured. Workbench runs record the estimate call's usage separately as
`duration_estimate` (Ticket 288). Recheck provider rates and measure both calls
before promoting the candidate or treating these assumptions as a budget limit.

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
- Measure Daily Brief token usage from the `daily_brief.model` performance events or
  workbench runs (recorded since Ticket 288) and replace the assumptions.

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
- 2026-11-04: Recorded the assumed usage model for the travel advisory revamp (Tickets
  267, 268 and 277) and the November 4 production readback.
- 2026-11-06: Decision D15 gave web leave reminders the one update. The reminder job
  routes each trip up to three times, so its row rose from 16, 80 and 208 legs to 24, 120
  and 312, and the proposed totals to US$0.33–0.67, US$1.40–2.82 and US$3.32–6.61 a month
  (Ticket 275).
- 2026-11-06: Decision D16 stops the reminder update route at 80% of the monthly ceiling,
  like automatic refreshes (Ticket 277). The proposed totals are unchanged as upper bounds.
  The listing request makes no route call.
- 2026-11-06: Ticket 284 measured one production walking day: 91 route calls and 4 lookups,
  US$0.48 reserved, three routes per reminded trip, one route for tomorrow's first trip, and a
  whole-day pass for each new browser tab.
- 2026-11-07: Ticket 285 fix. A single named place found by its center, such as a park,
  now resolves. Each stored unresolved or ambiguous place text from before 11:00 UTC is
  looked up once more on its next refresh, at US$0.005 each, under the same spend
  reservation and the 80% automatic-refresh pause. The new row is then reused as before.
  Places that now resolve get routed, within the usage model above. Totals are unchanged.
- 2026-11-09: Ticket 288 records Daily Brief token usage per model call in the
  performance log and in workbench runs. Token figures stay assumed until measured.


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
