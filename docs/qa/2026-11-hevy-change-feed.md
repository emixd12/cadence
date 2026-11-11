# Hevy change feed and read strategy (Ticket 311)

Run on November 11, 2026, 17:38–17:42 UTC, against the owner's own Hevy Pro account
(vault item `hevy-owner`). The owner decided that Hevy testing uses that account and no
paid test account; `docs/DECISIONS.md`, 2026-11-11.

Method: a one-off script read the API with the key from `npm run agent:secret`. Output kept
only times, event types, counts and 8-character SHA-256 prefixes of IDs; no titles,
exercises, notes or key. The owner allowed additions only, so the script added two private
workouts titled "Cadence test (today)" and "Cadence test (back-dated)" with one Walking
exercise each (`POST /v1/workouts`, 201). It edited and deleted nothing. Hevy's website
cannot log workouts, so the additions went through the API. The account had 49 workouts
before and 51 after. The owner may delete the two test workouts.

Evidence labels: **observed** (seen in this run), **documented** (Hevy's API document,
`https://api.hevyapp.com/docs/swagger-ui-init.js`, read 2026-11-11), **not observed**.

## Answers to plan Task 2

1. **A new workout emits an `updated` event.** Observed: both test workouts appeared as
   `updated` events within seconds. Hevy has no separate "created" type.
2. **A back-dated workout emits one too; edits do; deletes are documented.**
   - Back-dated: observed. The workout that started November 10 appeared in
     `events?since=` November 11 17:39:32 UTC, because the feed keys on the update time.
   - Edit: observed on existing history. A workout that started October 19 and was edited
     November 2 is returned for `since` November 1 and not for `since` November 3.
   - Delete: not observed (no deletion permitted). Documented as a `deleted` event with
     `id` and `deleted_at`.
3. **`since` compares `updated_at` and is inclusive.** Observed: `since` equal to a
   workout's `updated_at` (`…46.948Z`) returns it; one millisecond later (`…46.949Z`)
   does not. Events come newest first by `updated_at` (also documented).
4. **`/v1/workouts` is ordered by `created_at`, newest first, not by start time.**
   Observed: the back-dated test workout (start November 10, created last) is listed
   first, ahead of the November 9 workout and of today's test workout. The October 19
   workout edited on November 2 kept its creation-order place. The order was the same
   across two reads.
5. **`routine_id` is present on routine workouts and null on free ones.** Observed: 19 of
   20 recent workouts carry one; a freely logged workout from September 27 and both test
   workouts (no routine) have `null`.
6. **No 429.** Observed: about 20 calls in four minutes, far above one per 15 minutes,
   all returned 200 or 201. No rate-limit or `Retry-After` headers were sent.
7. **A workout keeps its `routine_id` after its routine changes.** Observed for edits:
   each routine's `updated_at` moves whenever a workout is saved from it (for example
   `71d785c4`, updated November 10 01:03), and older workouts from the same routine still
   carry the same `routine_id`. Renaming or deleting a routine: not observed (no edits
   permitted).

## Strategy: A, events cursor

Record a cursor per account and read `GET /v1/workouts/events?since=<cursor>` page by page.

- Covers new, back-dated and edited workouts (observed) and deletions (documented).
- Cost: one page for a quiet account, regardless of history size, so it removes the
  500-workout limit (plan finding F6).
- The next cursor is the read's start time less a 5-minute margin for Hevy's clock, never
  earlier than the current cursor, so a quiet account still advances. `since` is
  inclusive, so the next read may return a workout again; matching is idempotent by
  activity reference. A run that defers writes keeps its cursor.
- Seed a new link with the 30-day window from `/v1/workouts`, which is ordered by
  `created_at`. A back-dated workout is created recently, so a creation-ordered early stop
  still sees it; an edit to an old workout is caught by the cursor afterwards.
- Rejected: B, newest-first early stop on `/v1/workouts`, misses edits because edits do
  not reorder the list. C, full scan, still costs every page for long histories.

Follow-up: Ticket 315 adds `GET /v1/workouts/events` to the allowlist (its acceptance
says so only if this ticket chose A), and Tickets 316 and 321 replace
`CONNECTOR_COMPLETION_READ_STRATEGY = "full_scan"` with the cursor.

## Not verified

- A `deleted` event, a routine rename or deletion, and a workout logged in the Hevy app
  rather than through the API.
- Behaviour above 500 workouts (the account has 51).
- Hevy's rate limit, if any, under sustained load.
