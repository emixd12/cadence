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
| **Total known** | | **About US$54** | | | |

Fixed cost per user: about US$5.42 at 10 users, US$0.54 at 100 users and
US$0.05 at 1,000 users.

## Variable costs per user per month

### Summary

Figures use the efficient travel design described below, not the current code.

| Cost | Light | Typical | Heavy | Status |
| --- | --- | --- | --- | --- |
| Travel, walking/cycling/transit | US$0.23 | US$1.30 | US$3.45 | Disabled in production since 2026-09-25 |
| Travel, driving | US$0.37 | US$2.14 | US$5.73 | Disabled in production since 2026-09-25 |
| Daily Brief model | US$0.06 | US$0.13 | US$0.25 | Live |
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
before sending travel facts to the Daily Brief model.

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

### Current code, for comparison

The current code re-geocodes every location except home on every refresh. It
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

## Payment fees

Payment and subscription infrastructure is out of scope for v1. When it
arrives, fees reduce the US$5:

- A typical card processor charges about 2.9% plus US$0.30, about US$0.45 per
  US$5 charge (not verified).
- Mac App Store small-business commission is 15%, US$0.75 per US$5
  (not verified).

## Proposals awaiting owner decision

- Replace the lifetime travel budget with a renewable per-user monthly limit.
  A limit of 300 route calls and 100 place lookups covers a typical driver
  (about 265 calls) and caps travel at US$3.50 per user, even if every call
  bills at the Pro rate. After the limit, keep the day's
  plan visible, stop live updates and show the actual reset date.
- Keep an account-wide Google Cloud budget alert.
- Record Sequenzy's plan and per-email price.
- Record Daily Brief token usage per attempt to replace the assumptions.

## Change log

- 2026-10-16: Created. Added fixed costs, travel and Daily Brief estimates,
  and the Routes caching-terms finding.
