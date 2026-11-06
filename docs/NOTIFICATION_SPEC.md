# Notification Spec

## Notification model

The web app supports two reminder channels:

1. Browser push
2. Email through Sequenzy

Browser notifications default to on for every behavior.

Email reminders default to off and are enabled per behavior.

Public launch does not include marketing or product lifecycle emails. Reminder
emails remain transactional behavior reminders.

Leave reminders are a separate, opt-in reminder kind for travel. They have their
own records and rules; see "Leave reminders" at the end of this document. Nothing
else in this document applies to them unless that section says so.

## Automatic archive notice

Automatic end-date archival creates a durable in-app notice from the
Behavior's `auto_archived_at` marker. Timeline and Behaviors show the notice
after reconciliation. The notice does not depend on browser, email, or native
notification permission. It does not create a `reminder_deliveries` row.

Automatic archival cancels pending reminder deliveries for the Behavior before
the background reminder processor sends its batch. Desktop reminder
reconciliation removes the corresponding native requests after the same atomic
local Behavior update.

The reminder processor reads the recipient from `profiles.email`. Auth
creation and email-update triggers synchronize that value from
`auth.users.email`. Authenticated Data API clients cannot write the profile
email or display name; they may update only the profile timezone.

## Desktop native reminders

Tickets 108 and 112 add local macOS scheduling through a thin native adapter.
Hosted browser/email behavior below remains unchanged. Desktop email delivery
stays inactive, and native delivery uses BehaviorLog's existing extension
mechanism without a schema fork.

The owner accepted a clearly displayed OS-limited horizon on 2026-08-30:

- Target 30 days and schedule the nearest eligible reminders first.
- Read retained pending requests back from the OS. Compute coverage from the
  contiguous intended sequence; the first missing request ends coverage.
  A later retained request or successful callback cannot extend that proof.
- Show the actual scheduled-through date/time. Clearly disclose a shorter
  horizon or unavailable verification. Do not silently truncate coverage.
- Do not hardcode a universal request limit from one device's observed cap.
- Reconcile on launch, resume, local day change, and relevant mutations.
- Keep persisted request identities and cancellation/replacement idempotent
  across resolution, edits, archival, reconciliation, and restart.
- Preserve permission-denial behavior and activation to the intended
  Timeline Occurrence. Scheduling acceptance does not establish receipt.
- Preserve exact OS delivery evidence from presentation, activation, or
  delivered readback before retiring expired requests. Clicking can remove a
  notification from Notification Center; absence afterward must not overwrite
  observed delivery. Stale evidence for a replaced request must not mark its
  replacement delivered. User receipt and reading remain unverified.
- Verify sleep/resume, fully quit delivery, activation, and OS-limit behavior.
  A shorter verified horizon may pass; overstated or unverified coverage fails.
- Do not add a background helper. The horizon decision does not waive native
  activation proof before broad extraction or any other release requirement.

## Browser notifications

Requirements:
- User must grant notification permission.
- User must have an active push subscription.
- If browser push is denied or unavailable, the app still works.
- Settings should provide the control that triggers the browser notification
  permission prompt.
- Settings should show one user-facing current-device state for browser
  notifications: enabled on this device, not enabled on this device, blocked in
  this browser, or not supported on this device. Do not expose permission and
  push-subscription internals as separate user-facing statuses.
- Behavior create/edit should expose whether that behavior uses browser
  notifications. The behavior-level setting is not a second authorization
  flow; it uses devices that have notifications enabled in Settings.
- Clicking the Settings save control should retry the browser permission request
  while the browser still reports an undecided permission state. Browsers do
  not show the native prompt again after the origin is explicitly allowed or
  blocked; a blocked origin needs browser/site settings changed before Cadence
  can save a working subscription. The blocked-state recovery instruction and
  Refresh this device action remain visible after reload.
- If the initial current-subscription inspection fails, Settings must settle
  into a factual, retryable not-enabled state instead of remaining on Checking.
  First-run setup must treat the same failure as a missing current-device
  subscription so its Settings recovery link remains available.
- A user-triggered enable attempt that ends unsupported, blocked, dismissed, or
  otherwise unsuccessful is an alert. Passive availability information and a
  successful subscription save use status semantics.
- Public launch onboarding may also request notification permission after the
  user creates the first behavior, but only through a user-clicked control that
  routes to the existing Settings subscription action. The onboarding prompt
  must not call browser permission APIs on page load.
- When an authenticated user opens Cadence on a supported browser/device that
  does not have a current push subscription, first-run setup should continue to
  offer the Settings notification action even if another device was already
  enabled.
- Enabled on this device requires both the browser's current subscription and
  an exact active `push_subscriptions` row for the signed-in account, including
  matching endpoint and subscription keys. A browser subscription left by a
  different account must be unsubscribed before Cadence creates a fresh
  subscription for the current account. At most one account may have an active
  row for one endpoint.
- One account may have at most 20 active push subscriptions. Registering a
  device beyond that cap keeps the new device active and deactivates the least
  recently used active row. A per-owner database transaction lock makes the cap
  hold across concurrent registrations and direct owner-scoped writes.
- Authenticated registration attempts consume a separate account
  limit of six attempts per 60 seconds. A denied attempt returns 429 with a
  factual `Retry-After` value and does not write the subscription. Successful
  registration does not reset the separate unauthenticated failure limiter.
- If current-account ownership cannot be verified, Settings must not report the
  device as enabled. If saving a newly created browser subscription fails,
  Cadence must unsubscribe that new browser state and show a retryable setup
  failure. The retry remains the existing Enable notifications on this device
  or Refresh this device action; no privileged cross-account transfer or
  service-role write is allowed.
- Sign out reads the current PushManager subscription endpoint in the browser,
  including subscriptions created before this contract shipped. The server
  deactivates the departing account's matching active row before clearing the
  local session. No current browser subscription or no matching active row is
  a successful no-op. A deactivation failure leaves the session intact so the
  user can retry. This ordering frees a provider-reissued endpoint for a second
  account in the same browser.
- V1 does not need a test notification button.

Behavior fields:
- `browser_reminder_enabled`

Default:
- `true`

## Email reminders

Provider:
- Use Sequenzy.
- Use `docs/SEQUENZY_WORKFLOW.md` for CLI login, template inspection, test sends, and provider operations.
- Keep runtime sending in server-only services/adapters.
- Do not send from resolvers, UI components, or client-side code.
- Sequenzy may later handle other transactional product emails, but marketing
  or promotional email is not launch scope.

Behavior fields:
- `email_reminder_enabled`
- `reminder_offset_minutes`

Default:
- `email_reminder_enabled = false`
- `reminder_offset_minutes = 0`

Examples:
- `0` = at scheduled start
- `15` = 15 minutes before
- `60` = 1 hour before
- `1440` = 1 day before
- `4320` = 3 days before

## Reminder deliveries

Reminder deliveries are stored in `reminder_deliveries`.

Fields:
- occurrence_id
- channel
- scheduled_send_at
- sent_at
- processing_started_at (internal claim timestamp for idempotent processing)

Account synchronization retains an existing processing claim when a selected
reminder version omits it, including a reviewed cancellation. Both ordinary and
reviewed plans preserve this database invariant; the selected status still applies.

Account synchronization automatically retains a hosted Sent record over a local
Cancelled record from a Pending baseline when their identity, schedule,
provenance, and other non-delivery-state fields match. Require a valid hosted
send timestamp and compatible existing processing claims. Keep the hosted send
evidence while merging occurrence decisions independently. A cancellation that
reaches the account before sending still cancels the pending reminder. Other
reminder conflicts and conflicting user edits require review. See
`docs/DESKTOP_BUILD.md` for the precise reconciliation boundary.

- import_run_id (nullable provenance for explicitly promoted imported
  interventions)
- imported_intervention_id (nullable provenance for explicitly promoted
  imported interventions)
- status
- error

Statuses:
- pending
- sent
- failed
- cancelled

Authenticated owner-scoped clients may plan pending deliveries, cancel
pending deliveries, and reactivate unclaimed cancelled deliveries. They cannot
move a sent or failed delivery back to pending or clear a non-null processing
claim. The server-only `service_role` retains those maintenance capabilities.

## BehaviorLog intervention import history

BehaviorLog `data/interventions.jsonl` records are passive import-history
records. They may describe exported reminders or related notification history,
but imported rows are not active Cadence reminder deliveries.

Rules:
- Preview may validate and summarize intervention rows by channel, delivery
  status, and linked behavior.
- Preview must show which intervention fields will be stored in passive
  `imported_interventions` rows and which sensitive transport fields will be
  dropped or redacted.
- Preview must warn about message bodies, raw endpoints, provider identifiers or
  secrets, subscription keys, recipient identifiers, and similar sensitive
  delivery payload.
- Accepted create-only or merge import runs may store passive
  `imported_interventions` rows and intervention provenance mappings.
- Imported intervention history must not write `reminder_deliveries`.
- Imported intervention history must not schedule, send, cancel, retry, or claim
  reminders.
- Imported intervention history must not call Sequenzy, Web Push, browser APIs,
  provider SDKs, or notification processing routes.

## Imported intervention promotion

Imported intervention promotion is a separate explicit opt-in workflow after
passive `imported_interventions` history exists. It is not part of BehaviorLog
preview, create-only apply, or user-approved merge apply.

Promotion rules:
- Require a non-empty selected imported-intervention id list.
- Require explicit confirmation for the selected group.
- Promote only future pending records whose `intervention_type` is `reminder`.
- Require a safely linked current behavior and occurrence owned by the same
  user.
- Require the occurrence to still be unresolved and the behavior to still be
  active.
- Require the imported channel to still be enabled on the behavior.
- Require the imported scheduled send time to match the current
  `resolveReminderDeliveries` output for that behavior, occurrence, channel,
  and reminder offset.
- Leave sent, failed, cancelled, dismissed, past, ambiguous, unresolved-parent,
  resolved-occurrence, inactive-behavior, disabled-channel, and mismatched
  current-setting records as passive history.
- Create or link `reminder_deliveries` idempotently through the normal
  `(occurrence_id, channel, scheduled_send_at)` key.
- Store `import_run_id` and `imported_intervention_id` on promoted operational
  deliveries for durable provenance.
- Do not call Sequenzy, Web Push, browser APIs, provider SDKs, or notification
  processing routes during promotion.

## Delivery generation

Reminder deliveries should be generated from:
- Behavior reminder settings
- Occurrence scheduled start
- Reminder offset

Behavior-level reminder settings apply to every occurrence generated from every
schedule in v1. Per-schedule reminder overrides are future scope unless a later
ticket explicitly adds them.

Operational delivery planning belongs on occurrence-generation write paths,
not ordinary page reads. Due end-date reconciliation is a lifecycle write that
runs before the read; it may cancel reminders but does not plan new ones.
Behavior create/edit/archive/restore, timezone changes,
approved import/restore apply work, and protected/background occurrence horizon
syncs may create missing pending deliveries or cancel pending deliveries for
inactive behavior occurrences. Timeline, Analytics, and Export read-route
freshness checks may repair occurrence rows when stale, but must not create or
cancel reminder deliveries while rendering a page. A read-only occurrence
repair must leave the account horizon stale until a write/background path also
completes reminder reconciliation; otherwise the protected planner could skip
an account whose occurrence rows are fresh but whose reminder rows are not.

Planning reconciles the expected delivery set against existing rows for the
same occurrences. It creates missing rows, cancels unclaimed pending rows that
no longer match the behavior's channels or offset, and returns a cancelled row
to pending when an unresolved occurrence becomes eligible again (for example,
after behavior restore). These repairs apply only when `scheduled_send_at` is
strictly after the planner's injected current instant. Missing or cancelled
past/due rows are not created or reactivated, and existing past/due pending rows
are left for due-delivery validation rather than reclassified by planning. Sent
deliveries remain historical records, and failed deliveries are not retried
automatically in v1.

Behavior and approved import/restore graph writes are committed before this
derived repair. A repair failure must not report the already-committed product
write as failed. The account remains durably stale for protected/background
retry, and the service records a privacy-safe monitoring event. An import may
therefore plan future reminders for newly imported active behaviors through the
normal behavior/occurrence rules; passive imported intervention rows themselves
never become operational deliveries without the separate promotion workflow.
The protected processor selects from that durable sync-state ledger with stale
accounts first, then the earliest covered horizon, oldest update, and user id.
Successful repairs therefore rotate out of a bounded batch, while repeated
failures move behind older stale work instead of permanently starving later
accounts.

For exact-time occurrences, the scheduled start is the exact time. For range
occurrences, the scheduled start is the beginning of the preset range.

Browser notifications:
- Generate if `browser_reminder_enabled = true`
- Processing sends the due delivery to active `push_subscriptions` for the
  owning user through the server-only VAPID configuration.
- One delivery reads and sends to at most 20 active subscriptions. Provider
  calls run through a fixed four-worker pool, so fan-out concurrency is bounded.
- Send each payload with a 24-hour TTL. Under RFC 8030, the push service may
  retain it for that period or less and must stop delivery after expiry. This
  limit does not establish the browser vendor's operational-log retention.
- If a push service reports a subscription as gone or not found, mark that
  subscription inactive.
- If no active subscription exists, or browser push sending is not configured,
  mark the claimed browser delivery failed with a factual error.

Email reminders:
- Generate if `email_reminder_enabled = true`
- Use Sequenzy only at the service/provider boundary after a pending email delivery is due and still valid.

## Cancellation

When an occurrence changes from `unresolved` to:
- `completed`
- `not_completed`

Then pending reminder deliveries for that occurrence should be cancelled.

When Clear decision commits a correction back to `unresolved`, immediately
reconcile that owning behavior and occurrence using the action's injected
current instant. Only strictly future cancelled or missing deliveries become
pending again; due or past rows remain unchanged. This repair must not send a
provider notification. If it fails after the status transaction commits, keep
the successful status result, record a privacy-safe monitoring event, and mark
occurrence/reminder coverage stale for protected/background retry.

Do not cancel reminders that were already sent.

## Idempotence

Reminder processing must be idempotent.

Rules:
- Do not create duplicate pending deliveries for the same occurrence/channel/scheduled_send_at.
- Reconciliation must be retry-safe after a partial service failure. A repeated
  behavior or timezone save may repair occurrence and reminder coverage even
  when the profile or behavior already contains the requested value.
- Do not send the same reminder twice.
- Claim a due pending delivery before provider calls so overlapping process runs skip already-claimed work.
- A pending claim older than 15 minutes is reclaimable. Due selection and the
  conditional claim update use the same strict predicate, so only one worker
  can win an abandoned-claim retry. Reclaims emit a privacy-safe monitoring
  event and do not count as an earlier delivery failure.
- If a send fails, log the failure.
- Failed deliveries are not retried automatically in v1. Abandoned pending
  claim recovery is the only retry path.

## Processing

A scheduled backend process should periodically:
1. Find pending reminders whose scheduled_send_at is due.
2. Confirm the occurrence is still unresolved.
3. Send through the correct channel.
4. Mark as sent or failed.
5. Store error text for failed sends.

Email and browser-push processing are isolated and may run concurrently. The
processor constructs the Sequenzy sender only after it finds at least one due
email row. Missing Sequenzy configuration fails claimed due email rows through
the normal failure path without blocking browser push. An email or push
provider call receives a 10-second `AbortSignal.timeout` bound. A timeout also
uses the normal delivery-failure path, so it cannot leave a fresh claim waiting
forever.

After a provider reports success, the processor marks the delivery sent only
when its stored status is still `pending`. A zero-row sent update means the
occurrence was resolved and the delivery was cancelled during the provider
call. The processor records a privacy-safe monitoring event, leaves the row
cancelled, and increments the cancelled result count instead of sent.

The process route must be protected by `REMINDER_PROCESS_SECRET`,
`CRON_SECRET`, or an equivalent server-only mechanism. Repeated auth failures
are rate-limited, and manual `limit` query values are bounded so a valid secret
cannot request an unbounded batch.

Ticket 067 adds server-only launch circuit breakers for reminder batches,
Sequenzy email sends, and browser-push sends. Every breaker defaults to normal
behavior. A batch breaker returns before the service reads or claims due rows.
A channel breaker skips only that provider channel before due rows are read or
claimed, so pending delivery idempotency remains intact and the other channel
can continue. Breakers do not change reminder planning, stored status, RLS,
provider credentials, or user reminder preferences.

The only accepted reason codes are `abuse`, `application_regression`,
`cost_surge`, `operator_drill`, and `provider_incident`. Monitoring records the
breaker name, open state, reason code, and aggregate blocked invocation count.
It does not record account, occurrence, recipient, endpoint, or message data.

## Resolver contract

Reminder logic belongs in:

`/lib/resolvers/reminder.resolver.ts`

Function shape:

```ts
export function resolveReminderDeliveries(input: {
  occurrence: Occurrence;
  behavior: Behavior;
}): NewReminderDelivery[];
```

The resolver must not send reminders. It only returns delivery records that should exist.

Sending belongs in services/API routes.

## Required tests

- Browser delivery generated when browser reminders are enabled.
- Email delivery generated only when email reminders are enabled.
- Reminder offset is applied correctly.
- No delivery generated for resolved occurrence if resolver receives status information.
- Pending reminders are cancelled when occurrence is resolved.
- Duplicate delivery protection is handled by service/repository layer.
- Sequenzy provider errors are recorded as failed deliveries by the service layer.

## Hosted processing cadence (Ticket 091)

The web reminder processor runs every five minutes. Due reminders normally wait
up to about five minutes for the next processing run; provider and queue delays
can add latency. Existing offset choices remain available. Native desktop
reminders retain their OS scheduling and verified coverage behavior.

Send-time email and browser-push checks reject a Behavior whose end date has
arrived in its timezone, even when a bounded archive batch has not processed it.

## Leave reminders

Owner decisions D3, D12 and D15 (`docs/DECISIONS.md`). Ticket 275 sets these rules and the
schema. Ticket 276 adds the job's caller, Ticket 277 the job, Ticket 278 web push
delivery, Ticket 279 the setting and Ticket 280 the Mac app. Until those tickets
ship, nothing reads or writes the new tables.

### What gets a reminder

- A trip to a located destination: a Google Calendar event with a location, or a
  Behavior Occurrence whose Where routes (Home or a place). Outlook and iCloud events
  join when Ticket 283 routes them.
- Under D12, an event with no location is outside travel and gets no reminder. A
  located event is treated as in person; nothing asks about attendance.
- The trip home gets no reminder in this version. Getting ready applies to leaving
  for an event, not to leaving one.
- A trip needs a start. The web job starts from the previous stop, or from Home when
  no stop comes first. It never uses a device position, because none is stored. With
  neither, the trip gets no reminder; Ticket 279's readiness list shows the missing
  Home.

### Rules

- Off by default. One switch per account (Ticket 279). Leave reminders do not use
  the Behavior's `browser_reminder_enabled` or email settings.
- The reminder time is the leave time minus the get-ready time from Travel habits
  (`travel-habit-defaults@1`; 10 minutes when nothing is learned). A get-ready time
  of 0 fires at the leave time. There is no separate minutes setting.
- One reminder per trip. A trip is one destination on one local date at one start
  time. A moved event is a new trip, and the old trip is dropped.
- At most one update, and only if the leave time moves 10 minutes or more earlier
  after the reminder fired. Web and Mac both send it (decision D15): the web job from
  one route after sending, the Mac from its own later estimates (see below).
- If the reminder time has passed when Cadence first knows it, the reminder sends at
  once while the leave time is still ahead. After the leave time, no reminder sends.
- A trip is dropped, and nothing sends, when its event is cancelled, declined, moved
  or loses its location, when its Occurrence is resolved or its Behavior's Where stops
  routing, or when the user turns reminders off.
- No action buttons, snooze or email leave reminders in this version.
- Leave times never reach Daily Brief model input or MCP.

### Web: the hosted job

- The job runs every 5 minutes with a bounded batch. It treats work due within the
  next 5 minutes as due, so a reminder arrives up to 5 minutes early rather than late.
  Push service delays can add latency.
- The job routes each trip at most three times (decision D15), and each route
  reserves spend first:
  1. The plan route runs at the first visit that sees the trip on its local date. It
     sets the trip's next check time to the reminder time.
  2. The send route runs at that check. The notification uses its estimate, read in
     memory, and sends at once, even if the new reminder time is a little later. If
     the leave time it named is still ahead, the send sets one more check, 5 minutes
     later, for the update.
  3. The update route runs at that check, while the leave time the reminder named is
     still ahead. If its estimate moves the leave time 10 minutes or more earlier, the
     job sends the one update at once. Otherwise the check closes and nothing more
     sends. The job never routes a trip a fourth time.
  If the plan route finds the reminder already due, it is also the send route, and
  the update route is the second. The update route adds up to half the job's route
  legs (`docs/COSTS.md`). Leave times stay in memory; only the check time is stored.
- The job re-reads Calendar at least every 30 minutes for an account with pending
  trips, and again at send time. It reads the event title only at send time, in
  memory, and never stores it.
- A budget refusal fails that reminder with `budget_refused`. Automatic refreshes stop
  at 80% of the monthly ceiling, but reminder checks continue (Ticket 267).
- The text names the start (Home or the previous stop) and the leave time, as D3
  requires. An update names the new, earlier leave time. Ticket 278 owns the
  wording, which waits for the owner's approval (D7).
- Delivery goes to the account's active push subscriptions through the existing
  sender, at high urgency, and expires when the trip has started (Ticket 278).
  Behavior reminders keep their 24-hour lifetime. With no active subscription, the
  reminder fails with `no_subscription`.
- The job claims a reminder before routing or sending, as Behavior reminder
  processing does. A claim older than 15 minutes can be reclaimed. A sent reminder
  is final and its update is recorded once, so overlapping runs cannot send either
  twice.
- A server flag keeps the job off until it is set. The rollback is to unset it.

### Mac: native notifications

- The Mac app schedules a native notification from its last estimate, so it fires
  with Cadence quit. The text names the estimate time, because a quit app cannot
  re-route. It adds no background helper and makes no route call of its own.
- Reconcile on launch, resume, local day change and each travel update. A new
  estimate before the reminder fires replaces the scheduled notification; that is
  not an update.
- After a reminder fires, if a later estimate from the app's own refreshes moves
  the leave time 10 minutes or more earlier, and the leave time is still ahead, the
  app posts one update. It posts no second update.
- Leave reminders stay out of the Behavior reminder coverage calculation and use
  their own identifier (Ticket 280).
- The Mac reads the hosted preference on a linked account. An unlinked Mac has no
  hosted travel and no leave reminders.

### Storage

Migration `20261106040000_travel_leave_reminders.sql` adds two hosted-only tables.
`docs/DATA_MODEL.md` has the columns.

- `travel_leave_reminder_settings`: the switch, when it was turned on, and the job's
  next visit to the account.
- `travel_leave_reminders`: one row per trip with the owner, trip digest, local date,
  status, next check time, route count, claim time, sent time, update sent time and
  an error code. Statuses are `pending`, `sent`, `failed` and `cancelled`, as for
  Behavior reminders. A dropped trip is `cancelled`, and may return to `pending` if it
  comes back. `sent` and `failed` are final. A `sent` row may keep one next check,
  set when it sends, for the update route; dropping the trip after sending clears it.
  The database refuses a fourth route, a third route before sending, a second update,
  a pending row while reminders are off, and a second row for one trip.
- Neither table holds a title, place, position, route duration, leave time or
  provider result. Error values are short codes such as `budget_refused`.
- Account sync never reads either table. The synced profile contract is unchanged,
  so released Mac builds keep syncing.
- Turning reminders off deletes the account's reminder rows. While reminders are on,
  the job deletes rows dated before the account's previous local date. Account
  deletion removes both tables' rows. Because off deletes the record, turning
  reminders off and on again the same day can send a trip's reminder a second time.
- `docs/LEGAL.md` L-015 and L-016 log the provider-terms questions. P-016 and P-017
  in `docs/MESSAGING_CHANGES.md` log the text changes.
