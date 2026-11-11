# Connector Completion Implementation Plan

> **Execution:** Tickets 310–324 in `docs/TICKETS.md`, one per task, filed November 10,
> 2026. Each ticket runs on its own branch cut from `origin/main`. Ticket 310 is this
> plan's Task 1 and was completed by the change that filed the tickets.

**Goal:** Let a Behavior opt in to being marked Completed from activity recorded in a
connected service, starting with Hevy, through one write path that every later
connector reuses.

**Source of truth:** No separate specification exists. The governing inputs are the
owner's request in the sessions "Hevy connector scope planning" (November 7, 2026) and
"External service behavior linking" (November 10, 2026), `docs/INTEGRATION_PLAYBOOK.md`
and `docs/EXTERNAL_EVENT_CONTRACT.md`. Current docs forbid this feature. Task 1 changes
them. Where this plan and those documents conflict after Task 1, the documents govern.

**Architecture:** A provider adapter reads recorded activity. A pure resolver matches
activity to Unresolved Occurrences of opted-in Behaviors. One database function writes
the completion with connector provenance. A new connector adds an adapter and one
registry entry; the resolver, the write path, sync and the UI do not change.

**Tech stack:** Next.js App Router, TypeScript, Supabase Postgres with RLS,
`packages/core` resolvers with Temporal, Vitest, the Tauri desktop sync planner.

Written November 10, 2026 against `main` at `615f65c1`. Rechecked the same day against
`main` at `efac7e7d`; line numbers refer to that commit. Revised the same day for
several workouts in one day: D28.4, D28.8, and the invariants, data model and matching
rules in section 3. Drafts and the planning conversation numbered the decisions D1–D8.
They are D28.1–D28.8 here and in `docs/DECISIONS.md`, because the repository already
uses D1–D27.

---

## 1. Audit of the reviewed session

Reviewed: "External service behavior linking" (November 10), which refined "Hevy
connector scope planning" (November 7).

### Cause of most errors: a stale checkout

The reviewed session read files from the primary checkout. At that time the checkout
was on `horse-avatar-trial`, 302 commits behind `main` (merge base October 31). Its citations
match the stale tree, not `main`: it cites `docs/EXTERNAL_EVENT_CONTRACT.md:443`, and
on `main` that sentence is at line 445. The travel revamp (Tickets 260–285) and the
account sync contract work are missing from the tree it read.

**Rule for every task below:** branch from `main`, never from the primary checkout's
current branch.

### What the reviewed session got right

Each item was rechecked against `main` or the provider.

- Current docs forbid automatic completion: `AGENTS.md:259`,
  `docs/PRODUCT_SPEC.md:578` and `:957`, `docs/EXTERNAL_EVENT_CONTRACT.md:445`,
  `docs/DESKTOP_PARITY.md`.
- Hevy has no webhooks. Hevy's API document, fetched November 10, 2026, lists 14 paths
  and none is a webhook. (Documented support.)
- `GET /v1/workouts/events?since=` returns updated and deleted events, newest first.
  The document does not say whether creating a workout emits an event.
- Workouts carry `routine_id`. Routines have `id`, `title`, `folder_id` and timestamps,
  and no schedule field. Scheduling stays in Cadence; Cadence writes nothing to Hevy.
- The design direction is sound: opt-in for each Behavior, a pure matching resolver,
  same-day matching, never overriding a status the user set, storing raw timing facts
  and classifying them at read time.
- The October 19 live test and the open release gate (Ticket 241) are as stated.

### Findings

| # | Session claim | What `main` shows | Consequence |
|---|---|---|---|
| F1 | Status history "already accepts `system_rule_declared` and `derived`", so use "the existing status service path". | The table's CHECK accepts those values. The only writer rejects them. `apply_occurrence_status_transition` raises unless semantics is `explicit_user_mark` or `explicit_user_correction`, capture method is `manual_tap` or `manual_text`, and confidence is `high` (`supabase/migrations/20260709203117_add_transactional_occurrence_status_change.sql`, patched by `20261018180000_integration_atomic_writes.sql:8-12`). `resolveStatusEvent` hard-codes `manual_tap` (`packages/core/src/resolvers/status.resolver.ts:25-33`). No code writes `system_rule_declared` today. | The existing path either fails or records a connector completion as a user tap. That false provenance would reach BehaviorLog, MCP history and briefing analysis. A new database function and resolver plan are required (Tasks 4 and 5). |
| F2 | Desktop "receives completions through existing sync"; the only desktop work is syncing match rows. | The sync planner converges two first marks only when both are `explicit_user_mark`, `manual_tap`, `high` (`packages/core/src/resolvers/account-sync.resolver.ts:659-660`). Any other pair is an incompatible branch, and those "fail before user review" (`docs/DESKTOP_BUILD.md`, "Snapshot and merge boundary"). | A connector completion on the server plus a manual mark on a Mac for the same Occurrence stops that Mac's sync with no resolution screen. Published Mac 0.1.9 has this rule. The planner needs a new rule, shipped in a Mac release before the hosted feature is enabled (Task 10). |
| F3 | "Each read covers 30 days, so a day you skip opening Cadence still gets completed on your next visit." | Every caller requests one local date, today: web (`lib/ui/connectors.ts:330`), desktop (`apps/desktop/src/calendar/connector-broker.ts:54`), Daily Brief (`lib/services/advisor-day-context.service.ts:571`). The service allows 31 days; no caller asks for them. | Missed days would stay Unresolved. Matching needs its own server-side read with its own window (Task 7). |
| F4 | Matching runs "whenever Cadence already reads Hevy: the Timeline, Daily Brief, and linked desktop". | The Timeline read is a `GET` that the client caches for five minutes. Daily Brief is specified as read-only. | A write must not ride on a cached `GET` or inside the briefing pipeline. Reconcile gets its own `POST` (Task 7). |
| F5 | "There is no background polling"; a cron job "is a bigger scope change". | `main` runs a five-minute job that acts as each user under RLS with a minted five-minute token on its own channel (Ticket 276, `lib/supabase/integration-token.ts`, `app/api/travel/leave-reminders/process/route.ts`). That job's caller already reads connector credentials (`lib/services/connector-credentials.ts:28`). | The job is an established pattern, not new infrastructure. It needs its own token channel and a cost entry (Task 12). |
| F6 | The events feed "can replace the 500-workout scan" (framed as an optimization). | Above 500 workouts the adapter returns `incomplete_pagination` without reading a page (`lib/services/hevy-provider.ts:140`). | Long-time Hevy users are the target users, and they exceed 500 workouts. Under the current read the feature never works for them. The live check (Task 2) decides the read strategy and gates Tasks 6, 7 and 12. |
| F7 | "The new tickets start at 292." | `main` ended at Ticket 300 on November 10, and another branch already held Tickets 301–309 (merged later as PR #205). | The tickets are 310–324, the first free numbers on November 10 after checking every branch. |
| F8 | "The opt-in is the 'explicit user action'." | The playbook sets a higher bar for any write phase: named operations, a distinct grant, preview, explicit human approval, stale-source revalidation, conflict handling, idempotency, audit history, revocation fencing and atomic apply (`docs/INTEGRATION_PLAYBOOK.md:133`). The November 7 session asked the owner this question. The reviewed session turned it into a default. | A standing grant with no approval per write is an exception to that rule. The owner decides it (D28.1), and Task 1 records it. |
| F9 | A `MESSAGING_CHANGES.md` entry covers the stored data. | Cadence stores no Hevy data on the server today. Snapshots live in client memory and a disposable desktop cache. | Link and match rows make workout times and routine identifiers durable hosted data. Disconnect, reconnect with another Hevy account, account deletion, export and sync each need a rule (section 3, "Lifecycle"). |
| F10 | Not considered. | `resolveCompletionTiming` treats `status_marked_at` as the user's marking time and feeds Daily Brief context (`lib/services/advisor-day-context.service.ts:424`). | A connector write at job time would be counted as a user habit. Task 13 excludes connector marks from marking patterns. |
| F11 | Not considered. | The snapshot's `localStartDate` uses the profile timezone. An Occurrence's `local_date` follows its Behavior's timezone. | The matcher compares instants against the Occurrence's local day in the Behavior's timezone (Task 4). |
| F12 | "No generic connector framework." | The playbook forbids "a connector SDK, generic provider registry, or common event envelope until a second accepted integration proves matching semantics" (`docs/INTEGRATION_PLAYBOOK.md:537`). The owner now asks for an architecture that makes new connectors easy. | The rule needs a narrow amendment, decided by the owner (D28.2). Section 3 defines the smallest structure that meets the request. |

Not found in either session: `docs/LEGAL.md` has no Hevy entry, and the playbook says
"Hevy terms review is not verified". Task 1 logs it. Provider-terms entries do not gate
development (`docs/DECISIONS.md`, 2026-11-04).

---

## 2. Owner decisions

The owner decided all eight on November 10, 2026. `docs/DECISIONS.md` records them as
D28. D28.4 and D28.8 come from a side discussion with the owner about several workouts
in one day; "D28.4 options" records the D28.4 choice.

| # | Decision | Recommendation |
|---|---|---|
| D28.1 | Does a connector completion happen without asking each time? | **Decided November 10, 2026: yes.** The per-Behavior link is a standing grant for one operation: Unresolved → Completed, same day, linked Behavior. Each completion is labeled and can be changed with the existing status buttons. Record it as an explicit exception to the playbook's approval-per-write rule. The owner's reason: this is the main idea of the feature. People use what they log in other applications and do not record the same Behavior twice. |
| D28.2 | Is "complete from a connected service" a Hevy feature, or a Cadence feature that Hevy uses first? | **Decided November 10, 2026: a Cadence feature, kept small, with calendar events and recorded activity as separate data types.** Build the link, the match record and the completion rules once, for any service. Each service supplies only its own reader. Still no plugin system, no connectors built outside this repository, and no single data model shared by calendars and recorded activity. See "D28.2 in product terms" below. |
| D28.3 | May Cadence keep Hevy routine identifiers? | **Decided November 10, 2026: yes,** as account-scoped SHA-256 digests only. Routine titles are read live for the picker and never stored. A Behavior can link to chosen routines or to "any workout". The link form leads with routines, the more precise choice; "any workout" is the fallback. The owner's reason: the stored link lets a Behavior be related later to what is logged in the external app, "connecting the databases". A digest supports that: it matches a Behavior to its routine whenever the source is connected. It does not keep the routine's name or contents. Storing those would be a separate decision. |
| D28.4 | Can one workout count for more than one Behavior? | **Decided November 10, 2026: option B.** A routine link and the any-workout link both count one workout, so "Leg day" (Legs routine) and "Gym" (any workout) both complete from one Legs workout. Two limits at save time stay: a routine belongs to one link, and one link per source accepts any workout. A workout therefore counts for at most two Behaviors. "D28.4 options" compares the three options considered. |
| D28.5 | Is the background job part of the first release? | **Decided November 10, 2026: yes, at the lowest cost that keeps reminders correct.** Each account is checked on its own schedule, not on a fixed interval: about 5 checks a day in place of 96. See "Background check schedule". |
| D28.6 | How far back does matching look? | **Decided November 10, 2026: today and the 30 prior local dates,** the connector's existing maximum. No notification announces a change to a past day. The owner's reason: these changes keep the adherence log faithful, so they should be safe to make unannounced. "What makes unannounced changes safe" lists the rules that requires. A workout still completes only an Occurrence on its own date. |
| D28.7 | Which provenance values mark a connector completion? | **Decided November 10, 2026:** `status_semantics = system_rule_declared`, `source_capture_method = derived`, `source_confidence = high`, `reason_code = connector:<source>`. Confidence is always `high`. The matcher therefore never guesses: when two links of the same kind accept one activity it writes nothing (matching rule 1, worded for D28.4). The BehaviorLog schema in `packages/core/src/behaviorlog.schema.json` lists the allowed values and defines none, so the standard does not constrain this choice. |
| D28.8 | What is the shortest activity that can count? | **Decided November 10, 2026: 5 minutes for Hevy,** set per source. The owner accepted the recommended value when asking for the tickets to be filed. A shorter activity is ignored: it completes nothing and attaches to nothing. An accidental start-and-finish log then cannot complete a Behavior or become its timing sample. The side discussion proposed attaching it without completing. The number is a guess with no data behind it. |

Defaults carried over from the earlier sessions, unchanged: on time means within ±30
minutes of an exact time or inside a time range; Hevy duration does not fill tracked
time; a connector never changes a status the user set.

### D28.2 in product terms

**The rule today.** `docs/INTEGRATION_PLAYBOOK.md:537` says to build each connector on
its own and to add shared connector structure only after a second service shows what
the shared part should be. The reason: structure designed from one example often fits
the second one badly.

**What D28.2 changes.** Two things become shared by every completion source:

- One fixed set of questions. Cadence asks each service "what did this person record,
  and when?" and "what can they choose to narrow the link?" For Hevy the second answer
  is routines.
- Records that name the service. "This Behavior is linked to X" and "this Occurrence
  was completed by activity Y from X" hold for any X.

**What stays forbidden.** A plugin system. Connectors built by anyone outside this
repository. One data model for calendars and recorded activity. Skipping the playbook
brief, the provider research or the privacy review for a new service.

**If the owner says yes.**

- The first release looks the same to users. They see Hevy only.
- A second service needs a connection screen, a reader for its data and its
  disclosures. The label, changing a completion back, never overriding the user's
  status, timing statistics, Mac sync and export come unchanged.
- "Never override what the user marked" is enforced in one place. A connector cannot
  break it, because connectors never write statuses.
- Cost: more design work now. Not measured.

**If the owner says no.** Hevy ships about the same. A second service later either
copies the Hevy rules, which can then drift apart, or reworks stored data, which needs
another Mac release.

**Limit.** The structure comes from one example. It fits services that record "an
activity happened at a time": workouts, runs, meditation sessions, focus sessions. It
does not fit step counts, water totals or thresholds such as "at least 10 minutes"
without an extension.

**Connector vocabulary.** A connector is one connection plus one or more capabilities.
Each capability has one data model, shared by every service that offers it.

| Capability | Meaning | Sources | Used for |
|---|---|---|---|
| Calendar context | A plan: an event scheduled for a time | Google, Outlook, iCloud | Timeline context, overlap cues, leave times |
| Recorded activity | A fact: something that happened at a time | Hevy | Timeline line, Daily Brief |
| Completion (new) | Recorded activity that may complete a linked Behavior | Hevy | Connector completion |

Outlook, iCloud and Hevy already share one connection layer. Google Calendar predates
it and keeps its own. Tickets 306 and 307, implemented November 10, 2026 (PR #205), unify what the user sees:
one Daily Brief choice for every connected source, and one Google Calendar connection.

**Alternative considered: one data model for every connector.** Every connector would
produce the same record: source, start, end, a kind (planned or recorded) and optional
fields. Benefits: one Timeline renderer and one cache; a new kind of service appears on
the Timeline with little work; features that span sources read one list. The owner
rejected it on November 10, 2026. The reasons:

1. Features depend on the difference between a plan and a fact. A calendar entry "Gym,
   6 PM" is not evidence of a workout. A past workout does not constrain the day and
   must not cause an overlap cue or a leave time. With one record type every feature
   must filter by kind, and one missed filter produces a wrong completion or a wrong
   reminder. With separate types the completion code cannot receive a calendar event.
2. The privacy rules differ. Calendar titles are shown. Workout titles are discarded
   before anything else sees them.
3. The calendar model is live in production and cached by installed Macs. Changing it
   needs a Mac release and renewed acceptance.

The useful part of the idea does not need the merge. A calendar connector can later
gain the completion capability, for example to suggest completing "Therapy" when its
event ends. A scheduled event is weaker evidence than a recorded workout, so that
should be a suggestion, and it needs its own decision. A combined view already exists
where a feature needs one: the Daily Brief day context lists every connector with its
kind.

### D28.4 options

Two example setups show the difference.

- **Nested:** "Leg day" is linked to the Legs routine. "Gym" is linked to any workout.
  One Legs workout is logged.
- **Duplicate:** "Gym AM" and "Gym PM" are two Behaviors, both linked to any workout.
  One workout is logged.

| Option | Rule | Nested | Duplicate |
|---|---|---|---|
| A. One Behavior per workout (the earlier recommendation) | A routine link outranks the any-workout link. A routine belongs to one link, and one link per source accepts any workout. | "Leg day" completes. "Gym" stays Unresolved. | Cannot be set up. |
| B. A routine link and the any-workout link both count (chosen) | Keep A's two limits at save time. Drop the ranking: the routine link and the any-workout link each count the workout. | Both complete. | Cannot be set up. The form says to use one Behavior with two times. |
| C. Every link independent (the side discussion's proposal) | No limits at save time. A workout counts for every Behavior whose link accepts it. The form notes overlaps. | Both complete. | Both complete from one workout. |

**Why B.** The owner chose unannounced changes in D28.6 because they keep the adherence log
faithful. An Unresolved item is visible, and the user can fix it. A wrong Completed is
not visible. Option A leaves "Gym" for manual marking in the nested case, which is the
step this feature removes. Option C can write a wrong Completed in the duplicate case
with no notice. Option B completes the nested case and cannot produce the duplicate
case. A workout then counts for at most two Behaviors, both set up by the user. The
owner's reason for D28.7, relayed from the session that recorded it, points the same way:
build it so "the user can trust that their decisions are being recorded properly".

**Effect on decided rules.** "When two Behaviors could claim one activity, nothing is
written" was option A's rule. The session that recorded D28.7 wrote it in as a consequence
of always-high confidence; the owner did not state it. With B it reads "two links of
the same kind never accept one activity; if they do, nothing is written". Invariant 11,
rule 5 of "What makes unannounced changes safe" and the D28.7 row carry that wording.

**What B changed in this plan.** Matching rule 1 evaluates the routine-linked Behavior
and the any-workout Behavior separately, with no ranking. A match is unique per
activity and Behavior. Tasks 4, 5, 7, 8 and 14 build and test that.

**Option C, not chosen,** would also remove the one-any-link index, the rule that a
routine belongs to one link, invariant 11 and rule 5.

---

## 3. Architecture

### Terms

Use these names in code, docs and UI text. Task 1 adds them to the domain language.

- **Completion source:** a connected service whose recorded activity can complete
  Occurrences. Hevy is the first.
- **Source link:** one Behavior's opt-in to one completion source.
- **Source match:** the stored record that ties one recorded activity to one Occurrence.
- **Connector completion:** the status change written from a source match.
- **Reconcile:** one run of read, match and apply for one account and one source.

### Layers

```
Provider adapter          lib/services/<provider>-provider.ts
  provider I/O, fixed request allowlist, field minimization
        │  RecordedActivitySnapshot 1.1 (source-neutral, packages/core)
Completion-source port    lib/services/completion-sources.ts
  one entry per provider: readEvidence, listSelectors
        │
Match resolver            packages/core/src/resolvers/activity-match.resolver.ts
  pure: links + Occurrences + evidence + prior matches → plan
        │  plan: complete[], attach[], remove[], skip[]
Reconcile service         lib/services/connector-completion.service.ts
  fences, throttle, per-run cap, calls the functions below
        │
Database functions        apply_connector_completion, attach_source_activity,
                          remove_source_match
  one transaction each, as the user under RLS
```

Two triggers call the same reconcile service: a foreground `POST` and a background
job. A later webhook-based source would call it too, with evidence it received instead
of evidence it read.

### Safety invariants

Each is enforced where stated and has a test in the task that owns it.

1. A connector changes an Occurrence only when its status is Unresolved. (Database function.)
2. An activity is matched at most once per Behavior, ever. A connector completes an Occurrence at
   most once while that completion stands: after the user clears a connector completion,
   no activity completes that Occurrence again. (Unique keys on the match table.)
3. Connector status events always carry connector provenance, and the manual path can
   never carry it. The function fixes the values; callers cannot pass them. (Database function.)
4. A status reverts only when the Occurrence's last active match is removed and its
   latest status event is still the connector's own event. A match is removed only on a
   complete read or an explicit deletion event. (Resolver and function.)
5. Writes require a connected source and a link bound to the current provider account.
   Disconnect and reconnect with another account stop writes at once. (Database function.)
6. All tracking writes run as the user under RLS. The service role selects due
   accounts only. Job tokens last five minutes or less and are never logged.
7. Provider calls stay on a fixed `GET` allowlist. (Adapter, with rejection tests.)
8. One reconcile writes at most 100 matches, completions and attachments combined. The
   rest wait for the next run. The 30-day window can fill 31 Occurrences of one daily
   Behavior on the first run. (Service.)
9. The environment flag `CADENCE_CONNECTOR_COMPLETION` turns reconcile off without a
   code change. Default: off until release acceptance. (Service and job.)
10. Logs and telemetry carry counts and stable codes only: no titles, provider
    identifiers, credentials or note text.
11. Two links of the same kind never accept one activity: a routine belongs to one link,
    and one link per source accepts any workout. If two do, nothing is written. (Link
    service and resolver.)
12. The job checks one account at most 24 times a day. (Job.)
13. Attaching an activity never changes a status, a status timestamp, a status event or
    a reminder. (Database function.)

### Data model (hosted)

Three tables, all with `user_id`, RLS and cascade on account deletion.

`behavior_source_links`: `id`, `user_id`, `behavior_id`, `source`,
`selector_kind` (`any` or `provider_keys`), `selector_keys text[]` (digests, at most
32), `account_digest`, `enabled`, timestamps. Unique on
`(user_id, behavior_id, source)`. A partial unique index allows one enabled `any` link
per `(user_id, source)`, one of the two save-time limits D28.4 keeps. The owner writes it
through RLS.

`occurrence_source_matches`: `id`, `user_id`, `occurrence_id`, `behavior_id`,
`link_id`, `source`, `activity_ref`, `activity_start_at`, `activity_end_at`,
`activity_revision`, `scheduled_start_at`, `scheduled_end_at` (null for an exact
time), `role` (`completion` or `attached`), `state` (`active` or `removed`),
`applied_event_id` (set on a `completion` match only), `reverted_event_id`, timestamps.
Unique on `(user_id, source, activity_ref, behavior_id)`. A partial unique index allows
one `completion` match with a null `reverted_event_id` per Occurrence. The owner can read
it. Only the three functions write it.

`connector_completion_state`: primary key `(user_id, source)`, `next_check_at`,
`last_reconciled_at`, `read_cursor`, `consecutive_failures`. The job's service-role
selection reads `user_id` and `next_check_at` only, as the leave reminder job does.

Field rules:

- `activity_ref` is the contract's opaque account-scoped activity ID, not the raw
  provider ID.
- A selector digest is `sha256` over a version label, the source, the account digest
  and the provider key. The adapter computes it. Raw routine IDs are not stored.
- The link binds to `account_digest`, not to the connection generation. Reconnecting
  the same Hevy account resumes links. Another account leaves them fenced until the
  user saves the link again.
- A `completion` match is the activity that caused the status change. An `attached`
  match is further evidence on an Occurrence that is already Completed, by the user or
  by a connector. An Occurrence can hold several matches.
- A connector completion stands while its `completion` match has a null
  `reverted_event_id`. It keeps standing after the user changes the status. That stops
  a second activity from completing an Occurrence the user cleared.
- Whether the user overrode a connector completion is derived at read time: the
  Occurrence's latest status event differs from the `completion` match's
  `applied_event_id`. No trigger.
- One selector key belongs to one enabled link per source. The link service refuses a
  routine already chosen on another Behavior, so one workout maps to at most one
  routine-linked Behavior. The any-workout Behavior counts it as well (D28.4).

Status write values for a connector completion: `completed_at` is the activity end;
`status_marked_at` and `recorded_at` are the injected current instant;
`effective_at` equals `completed_at`. These satisfy the timestamp rules the manual
function already enforces. `completed_at` comes from the completing activity and does
not change when another activity attaches. Every match on an Occurrence falls on the
Occurrence's own date, so analysis by date does not depend on which activity a run saw
first.

### Matching rules (resolver)

Which Occurrence an activity belongs to depends only on the activity, the links and the
schedule that day. It never depends on a status or on which activities a run processed
first. Only the effect depends on status.

1. **Behaviors.** Evaluate, each on its own, every Behavior with an enabled link to the
   activity's source whose selector accepts it and that has an Occurrence on the
   activity's local date, in the Behavior's timezone (D28.4). The save-time limits mean at
   most two qualify: one through a routine link and one through the any-workout link.
   If two links of the same kind accept the activity, skip it for both and write
   nothing (D28.7).
2. **Occurrence.** Within each such Behavior, take the Occurrence on that date with the
   nearest scheduled start, then the earlier scheduled start, then Occurrence ID.
3. **Effect.**
   - The Occurrence is Unresolved, no connector completion stands on it, and the
     activity meets the source's minimum duration (D28.8): complete it.
   - The Occurrence is Completed, by the user or by a connector, and the activity meets
     the minimum: attach it. The status does not change.
   - Anything else writes nothing: a Not Completed Occurrence, an Unresolved one whose
     connector completion the user cleared, or an activity under the minimum. A later
     run evaluates the activity again while it is inside the D28.6 window.
4. An activity with an existing match for a Behavior is skipped for that Behavior,
   except for the timing refresh in rule 7.
5. An activity counts as evidence whether or not the read was complete. A seen workout
   exists.
6. **Removal.** A match is removed only when its activity is absent from a complete read
   covering its date, or is named by a deletion event. The status reverts only when the
   Occurrence has no active match left and the connector's completion event is still its
   latest status event.
7. **Edits.** A time edit that keeps the same Occurrence under rules 1 and 2 refreshes
   the match's timing facts. An edit that changes the Occurrence removes the match under
   rule 6 and does not match the activity to that Behavior again. First-slice limit;
   document it.
8. **Run order.** Plan removals first. Then process activities by start instant, then
   activity ref.
9. **Timing.** An Occurrence's timing comes from its active match whose activity start
   is nearest the scheduled start, chosen at read time.
10. An activity with no Behavior under rule 1 causes no write and stays a
    recorded-activity line.

Example: one Occurrence at 6 PM, workouts at 7 AM and 6 PM. Both belong to it. Whichever
a run sees first completes it, and the other attaches. Timing reads the 6 PM workout
either way: on time. Before this revision the first workout seen completed the
Occurrence, the second was discarded, and timing could read "11 hours early".

Example: "Leg day" is linked to the Legs routine and "Gym" to any workout. Both have an
Occurrence today. One Legs workout completes both, through one match each.

### Background check schedule (D28.5)

Hevy charges nothing per request. One check takes under a second of server time when the
read is cheap. Money is therefore not the limit. The limits are the number of requests
sent to Hevy, which publishes no rate limit, and how many accounts one job run can visit
in its 60 seconds.

A background check is useful only when nobody is looking. Opening Cadence on the web or
the Mac runs its own check. So the job checks an account at three kinds of moment, not on
a fixed interval.

| Moment | Check | Purpose |
|---|---|---|
| Before a reminder | Once, at the last job run before the reminder time of an Unresolved linked Occurrence | Cancel the reminder when the workout is already logged |
| After the scheduled start | Every 30 minutes for 3 hours, then hourly until local midnight. Stops when the Occurrence is resolved. | Complete it soon after the workout is logged |
| Nightly | Once after local midnight | Late and back-dated workouts, edits and deletions across the 30-day window |

The job route runs every 15 minutes, at minutes 7, 22, 37 and 52. Each run visits the
accounts whose `next_check_at` has passed. A pure function computes `next_check_at` from
the account's linked Occurrences, their reminder times and the injected current time.

Checks per linked account per day: about 5 on a workout day, about 12 when the workout
is skipped, 1 when nothing is scheduled. An account with four scheduled days a week
averages about 5. A fixed 15-minute interval makes 96 and cancels reminders no better,
because one check just before the reminder does that job.

Requests to Hevy per linked account per day, by the read strategy Task 2 selects:

| Schedule | Cheap read (strategy A or B) | Full scan, 44 workouts | Full scan, 500 workouts |
|---|---|---|---|
| This schedule | about 5 | about 35 | about 260 |
| Fixed, every 60 minutes | 24 | 168 | 1,248 |
| Fixed, every 15 minutes | 96 | 672 | 4,992 |

Guards:

- At most 24 background checks per account per day.
- After a failed check the wait doubles, up to 6 hours. `reconnect_required` stops checks
  until the user reconnects.
- If Task 2 finds no cheap read (strategy C), keep only the check before a reminder and
  the nightly check.

Capacity: at the leave reminder job's default of 20 accounts per run, 96 runs a day
visit 1,920 accounts. At 5 checks per account that covers about 380 linked accounts.
Raise the batch size before then; its ceiling in that job is 100.

Limit that no schedule fixes: a Mac schedules its Behavior reminders locally and learns
of a connector completion only when it syncs. A Mac reminder can still fire for a logged
workout while Cadence for Mac is closed.

### What makes unannounced changes safe (D28.6, D28.7)

The owner chose no notification for changes to past days and a fixed `high` confidence.
Both choices depend on these rules. Treat them as requirements.

1. A connector only fills an Unresolved Occurrence. It never changes a status the user set.
2. A change the user makes to a connector completion is final. No activity completes
   that Occurrence again. (Tightened from "the same activity" when an Occurrence became
   able to hold several activities; otherwise a second workout that day would undo the
   user's change.)
3. The record keeps two times: when the workout ended (`completed_at`, `effective_at`)
   and when Cadence recorded it (`recorded_at`). Analysis by date uses the workout's
   time, so a late recording does not distort the log.
4. Every connector completion is labeled on the Timeline and in status history, with the
   workout time it came from. Further workouts attached to the Occurrence are listed
   with their times.
5. Two links of the same kind never accept one activity. If two do, nothing is written.
   A routine link and the any-workout link each count the workout, because the user set
   up both (D28.4).
6. A failed or stopped check is visible. Settings shows the last successful check time
   beside the existing connection state. Without it, a silent failure looks the same as
   "no workouts".
7. History older than the 30-day window never changes.

### Lifecycle

| Transition | Rule |
|---|---|
| Turn a link on | Saves the link against the current account digest. The next reconcile fills Unresolved Occurrences on workout days inside the 30-day window. Nothing older changes. |
| Turn a link off | Stops new matches for that Behavior. Past connector completions stay. |
| Disconnect the source | Stops reconcile at once. Links stay stored and fenced. Past completions and match rows stay; they are Cadence history. |
| Reconnect, same provider account | Links resume. |
| Reconnect, other provider account | Links stay fenced and are shown as needing review. |
| Account deletion | All three tables cascade. |
| Archive or delete a Behavior | Its links cascade with it. |
| Export and BehaviorLog | Status events export with their provenance. Match timing facts export only if Task 13 adds them. Credentials and titles never export. |
| Desktop sync | Status events sync today. Links and matches sync from Task 11 at a new account sync contract. |

### What a new completion source costs after this work

1. An integration brief from `docs/INTEGRATION_PLAYBOOK.md`.
2. A provider adapter with its allowlist and fixtures.
3. The provider literal in the existing lifecycle: `connector_connections`,
   `ConnectorProvider`, the credential shape and the revocation instruction.
4. One implementation of the completion-source port, added to the constant map with its
   minimum duration.
5. The source literal in the recorded-activity contract and the table CHECKs: one migration.
6. A Settings panel, link picker labels, a disclosure and messaging entries.

Unchanged for a new source: the match resolver, the database functions, the reconcile
service, the sync merge rule, the Timeline label, analytics, export and MCP.

The structure is proven only when a second source lands. `docs/FUTURE_UPDATES.md`
already names Focus Keeper as an unverified candidate.

---

## 4. Tasks

Each task is one ticket in `docs/TICKETS.md`: Task n is Ticket 309 + n. The ticket holds
the status. This section holds the detail. Every ticket states platform and messaging
impact as `AGENTS.md` requires.

### Task 1 (Ticket 310): Decision record and document changes

**Objective:** Make the feature permitted and specified before any code.

**Files:**
- Modify: `docs/DECISIONS.md`, `AGENTS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/EXTERNAL_EVENT_CONTRACT.md`, `docs/INTEGRATION_PLAYBOOK.md`,
  `docs/DESKTOP_PARITY.md`, `docs/FUTURE_UPDATES.md`, `docs/MESSAGING_CHANGES.md`,
  `docs/LEGAL.md`, `docs/TICKETS.md`, `STATUS.md`

**Decisions:**
- Record D28.1–D28.8 as answered by the owner, with the owner's reasons for D28.1, D28.3, D28.6 and D28.7
  as section 2 gives them.
- `AGENTS.md`: move "automatic Behavior completion from recorded activity" from out of
  scope to in scope, limited to source links. Amend "Manual statuses" and the status
  rules to name connector completion as the one non-manual writer. Add the five terms.
- `docs/INTEGRATION_PLAYBOOK.md`: amend line 537 per D28.2 and add the capability table
  from "D28.2 in product terms". Update the Hevy brief: write
  authority becomes "Cadence status through a source link; none at the provider".
- Log messaging entries for: stored workout timing, stored routine digests, routine
  titles shown in the picker, and the new product claim. Do not edit Privacy, Terms or
  marketing text.
- Add a `docs/LEGAL.md` entry for Hevy API terms covering polling and stored derived data.

**Verification:** `npm run agents:check` passes.

### Task 2 (Ticket 311): Live Hevy check

**Objective:** Decide the read strategy with live evidence.

**Files:**
- Create: `docs/qa/2026-11-hevy-change-feed.md`

**Decisions:** Run `npm run qa:preflight -- --suite connectors` first. The owner's own
Hevy Pro key is the vault item `hevy-owner` (`docs/DECISIONS.md`, 2026-11-11); the owner
is asked only if the preflight lists it as missing. Use a local stack as on October 19. Read-only calls only, except creating, editing and
deleting test workouts in the Hevy app by hand. Answer:

1. Does creating a workout emit an `updated` event in `/v1/workouts/events`?
2. Does a back-dated workout emit one? Do an edit and a delete?
3. Is `since` inclusive, and which timestamp does it compare?
4. Is `/v1/workouts` ordered newest first, and is the order stable?
5. Is `routine_id` present for a routine workout and absent for an empty one? The link
   form leads with routines, so a workout without a `routine_id` would match only an
   any-workout link.
6. Does any call return 429 at one request per 15 minutes?
7. Does a workout keep its `routine_id` after its routine is renamed, edited or deleted?

Also read Hevy's terms of service and any developer terms, and update `docs/LEGAL.md`
L-023. That entry gates nothing.

**Outcome:** One of three strategies, recorded with evidence labels. A: events cursor.
B: newest-first early stop, which needs the contract revision the playbook requires.
C: full scan, limited to accounts with 500 or fewer workouts and disclosed.

### Task 3 (Ticket 312): Recorded-activity contract 1.1

**Objective:** Make the contract source-neutral and able to carry selector keys.

**Files:**
- Modify: `packages/core/src/types/recorded-activity.ts`,
  `packages/core/src/services/recorded-activity-validation.ts`
- Create: `packages/core/src/recorded-activity-1.1.schema.json`,
  `tests/fixtures/recorded-activity-snapshot.1.1.valid.json`
- Test: `tests/recorded-activity-contract.test.ts`

**Decisions:** Follow the calendar precedent from Ticket 234. `1.0.0` keeps its exact
bytes and stays the display contract. `1.1.0` adds a `source` union, a
source-to-adapter-version map, and `activities[].selectorKeys: string[]`. Selector keys
are present only when the read asked for them, as location is under Ticket 283.

**Tests:** `1.0.0` validator rejects `1.1.0`. `1.1.0` rejects an unknown source, a
mismatched adapter version, a non-digest selector key, and more than 32 keys.

**Verification:** `npx vitest run tests/recorded-activity-contract.test.ts` passes.

### Task 4 (Ticket 313): Match resolver and connector status plan

**Objective:** Decide matches and plan connector status events in pure code.

**Files:**
- Create: `packages/core/src/resolvers/activity-match.resolver.ts`
- Modify: `packages/core/src/resolvers/status.resolver.ts`, `docs/AGENT_RESOLVERS.md`
- Test: `tests/activity-match.resolver.test.ts`, `tests/status.resolver.test.ts`

**Decisions:** `now` is injected. Each source's minimum duration (D28.8) is an input. The
resolver implements the matching rules in section 3 and returns `complete`, `attach`,
`remove` and `skip` entries with a reason code each. Add
`resolveConnectorStatusEvent`, separate from `resolveStatusEvent`, so the manual plan
type stays unable to express connector provenance. Add a pure timing classifier: on
time within ±30 minutes of an exact time or inside a range. It reads the active match
nearest the scheduled start.

**Tests:**
- Assignment: two Occurrences on one day pick the nearest. One activity completes a
  routine-linked Behavior and the any-workout Behavior, with one match each. Two links
  of the same kind that accept one activity produce a skip for both.
  A workout at 23:30 in the profile timezone matches by the Behavior's timezone. A DST
  day. A workout 30 days back matches; one 31 days back does not.
- Several activities: two activities on one Occurrence produce one `complete` and one
  `attach`, in start order. The same two in either input order give the same timing.
- User marks: an activity attaches to an Occurrence the user marked Completed. A Not
  Completed Occurrence gets nothing. After the user clears a connector completion, a
  second activity that day is skipped.
- Minimum: an activity under the minimum is skipped.
- Removal: an incomplete read plans no removal. Removing one of two activities plans no
  revert. Removing the last one plans a revert. An edit that changes the Occurrence
  plans a removal only.

**Verification:** `npm run resolvers:check` and the two test files pass.

### Task 5 (Ticket 314): Migration and the database functions

**Objective:** Add the three tables and the only write path for connector completions.

**Files:**
- Create: `supabase/migrations/<timestamp>_connector_completion.sql`,
  `tests/sql/ticket-<n>-connector-completion-smoke.sql`
- Modify: `docs/DATA_MODEL.md`, `lib/db/database.types.ts` (generated)
- Create: `lib/db/sourceLinks.repo.ts`, `lib/db/sourceMatches.repo.ts`

**Decisions:**
- Three functions write connector data. Each runs as the caller with `auth.uid()` and
  locks the Occurrence. `apply_connector_completion` and `attach_source_activity` share
  these checks: the link is enabled, owned, for the same Behavior and source; the
  source is `connected` with the link's account digest; the activity ended at or before
  the recorded instant; the activity start is within 48 hours of `scheduled_for`.
- `apply_connector_completion` also requires: status is Unresolved; the latest status
  event equals the expected one; no match exists for the activity and this Behavior; no
  connector completion stands on the Occurrence. It updates the Occurrence, inserts one status
  event with the D28.7 values, inserts a `completion` match and cancels pending reminders,
  in one transaction.
- `attach_source_activity` also requires: status is Completed. It inserts an `attached`
  match. If an active match already exists for the same activity on the same
  Occurrence and the activity's revision is newer, it refreshes that match's timing
  facts and nothing else. It changes no status, status timestamp, status event or
  reminder.
- `remove_source_match` marks one match `removed`. If the Occurrence then has no active
  match, a connector completion stands on it, and that completion's `applied_event_id`
  is the Occurrence's latest status event, it writes an Unresolved event that revises
  it and sets `reverted_event_id`. Otherwise it changes no status.
- A failed precondition returns a stable reason and writes nothing. It is not an error.
- Stale-plan errors use a non-retryable SQLSTATE, never `40001`, as the manual function does.
- Do not alter `apply_occurrence_status_transition`.

**Tests (SQL smoke):** A user-marked Occurrence is not completed. A second call for the
same activity and Behavior is refused. The same activity completes an Occurrence of a
second Behavior. After the user clears a connector completion, a completion
from another activity is refused. An attach on an Unresolved or Not Completed
Occurrence is refused. An attach changes no Occurrence column and no reminder. Removing
one of two active matches keeps the status. Removing the last one reverts it. Removing
the last one after a user correction changes no status. A disconnected source is
refused. Another account's rows are invisible and unwritable. The manual function still
rejects `derived`.

**Verification:** `npm run supabase -- db reset` applies every migration. The smoke
file passes. The hosted `db push` can run under the standing approval for additive
migrations (`docs/DECISIONS.md`, 2026-11-10) when its five conditions hold. An explicit
grant to `service_role` is outside that approval and needs the owner's yes.

### Task 6 (Ticket 315): Hevy adapter extension

**Objective:** Read what matching needs and nothing more.

**Files:**
- Modify: `lib/services/hevy-provider.ts`, `lib/services/hevy.service.ts`
- Test: `tests/hevy-provider.test.ts`, `tests/hevy.service.test.ts`, `tests/fixtures/hevy/`

**Decisions:** Add `GET /v1/routines` to the allowlist. Add `GET /v1/workouts/events`
only if Task 2 chose strategy A. A match read keeps workout identity, timing and the
routine selector digest. Display reads keep discarding `routine_id`. Routine titles are
returned to the picker and never stored or logged. Hevy returns routines 10 per page.
Read at most 20 pages, the bound the calendar lists use. Past that, return the first 200
and mark the list incomplete.

**Tests:** Every non-allowlisted method and path is refused before the key is attached.
A display read contains no selector key. A selector digest differs across accounts. A
21st routine page is not read and the list is marked incomplete.

**Verification:** Both test files pass.

### Task 7 (Ticket 316): Completion-source port, reconcile service and routes

**Objective:** Run reconcile on request, through one service.

**Files:**
- Create: `lib/services/completion-sources.ts`,
  `lib/services/connector-completion.service.ts`,
  `app/api/connectors/completions/reconcile/route.ts`,
  `app/api/connectors/links/route.ts`
- Modify: `docs/ROUTE_MAP.md`, `docs/OPERATIONS.md`
- Test: `tests/connector-completion.service.test.ts`

**Decisions:** The port has two methods: `readEvidence(caller, range, deadline)` and
`listSelectors(caller)`. The map has one entry, `hevy`, with its minimum duration (D28.8).
The value is defined in `packages/core` beside the recorded-activity contract, and the
resolver receives it as input. Reconcile is a `POST`. It reads
evidence on the server and never accepts evidence from a client. It reads the D28.6
window, skips when the last run was under five minutes ago, writes at most 100
matches, repairs reminder coverage after a revert as the manual clear does, and
revalidates `/timeline`. It returns counts and stable codes. It does nothing when
`CADENCE_CONNECTOR_COMPLETION` is not `on`.

**Tests:** A provider failure writes nothing. A connection that changes during the run
discards the result. A 101st planned match is left for the next run. The flag off
returns without a provider call. Saving a link with a routine already chosen on another
Behavior is refused. A second any-workout link for one source is refused.

**Verification:** `npm run resolvers:check` and the test file pass.

### Task 8 (Ticket 317): Web UI for links and the completion label

**Objective:** Let the user turn a link on and see what a connector completed.

**Files:**
- Modify: `components/behaviors/BehaviorForm.tsx`, `components/settings/HevyPanel.tsx`,
  `components/timeline/OccurrenceRow.tsx`, `components/timeline/DayProgressTimeline.tsx`,
  `interaction-registry.json`, `docs/INTERACTION_REGISTRY.md`, `docs/UI_SPEC.md`,
  `docs/USER_FLOWS.md`, `DESIGN.md`

**Decisions:** Run the impeccable workflow and the design-system-bench skill first. The
Behavior form shows "Complete from Hevy" only when Hevy is connected, off by default.
It leads with the routine picker; "Any workout" is the fallback. When another Behavior
is linked to any workout, the form says that a workout from a linked routine also
counts for that Behavior. It refuses a routine already linked to another Behavior and a
second any-workout link, and names the Behavior that holds it. When the routine list
was read completely and a stored digest is missing from it, the form says how many
linked routines are no longer in Hevy, for example "1 linked routine is no longer in
Hevy". Cadence stores digests only, so it cannot name the routine. When the list is
incomplete the form shows no such count. A connector-completed row shows a "From Hevy"
label while the connector's event is the latest one. Any row with attached workouts
lists each workout's start and end time, with a count when there are several, for
example "From Hevy · 2 workouts". A row the user marked shows the workouts without the
"From Hevy" label. The existing status buttons change
it; add no new control. The Timeline calls reconcile after its connector refresh, then
refreshes rows when the count is above zero. No new route, modal or settings page.
The Hevy panel shows the last successful check time beside the existing connection
state. No notification announces a connector completion (D28.6).

**Tests:** DOM tests for the routine-first link control, the note that a routine workout
also counts for the any-workout Behavior, both refusals, the stale-routine count and its
absence on an incomplete list, the fenced state after an account change, the label, its
removal after a manual change, and the workout list with one and with two workouts.
Mobile width.

**Verification:** `npm run interactions:check`; preview check at desktop and 390 px.

### Task 9 (Ticket 318): Timing statistics on Behaviors

**Objective:** Show whether linked Behaviors happen when scheduled.

**Files:**
- Modify: `packages/core/src/resolvers/analytics.resolver.ts`,
  `lib/services/analytics.service.ts`, `components/behaviors/BehaviorList.tsx`
- Test: `tests/analytics.resolver.test.ts`, `tests/analytics.service.test.ts`

**Decisions:** Input is match rows. Only Occurrences that are Completed now count,
including ones the user marked that have an attached activity. Each Occurrence
contributes its active match nearest the scheduled start. Output per Behavior: matched
count, on-time count and median offset in minutes. Text follows "On schedule 6 of 9.
Usually 40 min later." No streaks, scores or charts. Adherence calculations are
unchanged.

**Verification:** The test file and `npm run resolvers:check` pass.

### Task 10 (Ticket 319): Desktop sync merge rule and label

**Objective:** Keep Mac sync working when a connector and the user mark the same Occurrence.

**Files:**
- Modify: `packages/core/src/resolvers/account-sync.resolver.ts`,
  `apps/desktop/src/timeline-screen.tsx`, `apps/desktop/src/calendar/use-connectors.ts`,
  `docs/DESKTOP_BUILD.md`, `docs/DESKTOP_PARITY.md`
- Test: `tests/account-sync.resolver.test.ts`

**Decisions:** Read `docs/plans/2026-10-27-sync-compatibility.md` first. After an
Unresolved baseline, a connector root mark on one side and a manual root mark on the
other converge. Both events are kept unchanged. Same status: existing latest-event
ordering picks display timestamps. Different status: the manual mark's status wins.
This is a provenance rule, not timestamp arbitration; state that in
`docs/DESKTOP_BUILD.md`. The desktop label reads the synced status event's
`reason_code`, so it needs no new synced entity. Until Task 11 the Mac shows the label
without workout times or a count, because matches do not sync yet. The linked desktop
calls reconcile through the hosted broker after its Hevy refresh, then syncs.

**Tests:** Connector Completed plus manual Completed converges. Connector Completed
plus manual Not Completed converges to Not Completed. Two connector marks for one
Occurrence still fail. Existing manual-mark tests are unchanged.

**Verification:** The test file passes. Installed acceptance on a dev-signed build per
the `desktop-acceptance` skill, including one forced collision.

### Task 11 (Ticket 320): Sync links and matches to desktop (follow-up)

**Objective:** Show link state and timing on the Mac offline.

**Decisions:** Add both tables as new entity kinds at the next account sync contract.
Older Macs keep receiving the projection they know. Needs a SQLite migration and
installed acceptance. Not required for the first release.

### Task 12 (Ticket 321): Background job

**Objective:** Complete Occurrences and cancel reminders without Cadence being opened.

**Files:**
- Create: `app/api/connectors/completions/process/route.ts`,
  `lib/services/connector-completion-job.service.ts`,
  `packages/core/src/resolvers/completion-check-schedule.resolver.ts`
- Modify: `lib/supabase/integration-token.ts`, `vercel.json`, `docs/COSTS.md`,
  `docs/NOTIFICATION_SPEC.md`, `docs/VERCEL_WORKFLOW.md`, `docs/AGENT_RESOLVERS.md`
- Test: `tests/connector-completion-job.service.test.ts`,
  `tests/completion-check-schedule.resolver.test.ts`

**Decisions:** Model it on Tickets 276 and 277. Add a `connector_completion` token
channel; do not reuse `mcp` or `leave_reminder`. The service role selects due accounts
from `connector_completion_state` and reads nothing else. Every other read and write
uses the minted client. The route runs at `7,22,37,52 * * * *`, off the top of the hour
because Hevy asks pollers to avoid it. Each account follows "Background check schedule"
in section 3, computed by the pure schedule resolver with `now` injected. Apply the three
guards listed there. Record measured Vercel usage for the job in `docs/COSTS.md`, which
lists that usage as not measured today.

**Tests:** The job's client reads only its own account. A failed account does not stop
the batch. No token appears in logs. Schedule resolver: one check at the last run before
a reminder; 30-minute then hourly checks after the scheduled start; none once the
Occurrence is resolved; one nightly check; the 24-a-day ceiling; doubling after failures.

**Verification:** The test file passes; a local-stack run completes one seeded match.

### Task 13 (Ticket 322): Read surfaces

**Objective:** Make connector provenance correct wherever status history is read.

**Files:**
- Modify: `packages/core/src/resolvers/completion-timing.resolver.ts`,
  `packages/core/src/resolvers/export.resolver.ts`, `docs/EXPORT_FORMATS.md`,
  `docs/MCP_CONTRACT.md`

**Decisions:** Marking patterns exclude Occurrences whose current status came from a
connector. Confirm BehaviorLog and JSON exports emit the D28.7 values and `reason_code`
unchanged. MCP `get_occurrence` already returns status history; document the new
values. Daily Brief gets timing facts only under the one Daily Brief choice for
connected sources (Ticket 306), in a later ticket.

**Verification:** Export and completion-timing tests pass with a connector-completed fixture.

### Task 14 (Ticket 323): Release acceptance

**Objective:** Prove the feature live before turning it on.

**Decisions:** The hosted connectors run on production since October 23, 2026
(`AGENTS.md`). Ticket 241's release steps 6–7 and installed connector acceptance remain
open, and this task depends on them.
Evidence classes stay separate per the playbook: live provider, deployed web, installed
Mac. The acceptance matrix covers: complete, clear, no re-complete; one workout
completing a routine-linked Behavior and the any-workout Behavior; two workouts on one
day; a workout attached to an Occurrence the user marked; a workout under the minimum;
workout deleted in Hevy, with and without another workout that day; link off;
disconnect; reconnect with another account; a forced Mac collision; the flag off. Turn
`CADENCE_CONNECTOR_COMPLETION` on only after the Mac build with Task 10 is published.

### Task 15 (Ticket 324): Count an unlinked workout by hand (after the first release)

**Objective:** Let the user count a logged workout that no link accepted.

**Decisions:** When a workout that day matches no link, the Occurrence row offers "Count
the 6:05 PM Hevy workout". It records the user's own mark through the existing manual
path and attaches the workout for timing. This is a new operation and a new
interaction. It needs its own ticket, an interaction registry entry, and a rule for a
match that has no link. Not part of the first release.

---

## 5. Order and gates

```
Task 1 ─┬─ Task 3 ── Task 4 ── Task 5 ─┬─ Task 7 ─┬─ Task 8 ── Task 9
        └─ Task 2 ────────── Task 6 ───┘          ├─ Task 12
                                                  └─ Task 13
Task 10 can start after Task 4.  Task 11 follows Task 10.  Task 14 closes the first
release.  Task 15 comes after it.
```

- Task 2 starts with the `connectors` preflight, which supplies test account A's Hevy key.
- Task 5's hosted push runs under the standing approval for additive migrations when its
  conditions hold.
- Task 10 must be in a published Mac build before Task 14 turns the feature on.
- Run the `AGENTS.md` checks before each push.

## 6. Platform and messaging impact

| Platform | Impact |
|---|---|
| Web | Tasks 5–9, 12, 13. |
| Desktop | Linked mode only: Task 10, then Task 11. Local mode: not applicable, it has no connectors. |
| Marketing | No runtime. Messaging entries from Task 1; text changes run in the messaging track. |
| Future mobile | Deferred. The hosted functions and contract 1.1 are reusable. |

## 7. Not in scope

Writing to Hevy or any provider. Filling tracked time from activity duration.
Completing an Occurrence on a different day from the activity. Marking Not Completed
automatically. Apple Health and Google Fit. A second completion source. Webhook intake.
Exercise, set or weight data. Timing facts in Daily Brief. Notifications about
connector completions. Counting an unlinked workout by hand; Task 15 covers it after the
first release.

## 8. Not verified

- Whether a new Hevy workout emits a change-feed event, and whether `/v1/workouts` is
  ordered. Task 2 answers both.
- Whether an agent can create, edit and delete workouts for the Hevy test identity. If
  not, those three actions in Task 2 are owner steps.
- Whether the hosted side records which sync contract each linked Mac last used. Task
  10 checks this before deciding on a per-account gate.
- Hevy's API terms. Logged in Task 1; not gating development.
- What the background job costs in Vercel usage. `docs/COSTS.md` lists Vercel usage
  beyond the included credit as not measured. Task 12 measures it.
- Whether a reminder a Mac has already scheduled can be withdrawn before that Mac next
  syncs. Read from `docs/DESKTOP_BUILD.md`, not tested.
- The check counts in "Background check schedule" are estimates from the schedule's
  rules, not measurements.
- The 5-minute minimum duration (D28.8). No data supports the number.
- Whether a workout started without a routine carries a `routine_id`, and whether a
  workout keeps it after its routine changes. Task 2 answers both.
- No code was run for this plan. Every claim about `main` comes from reading source.
