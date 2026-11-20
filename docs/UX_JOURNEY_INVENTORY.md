# UX Journey Inventory

## Purpose

This document is Cadence's initial user-experience journey inventory. It turns
the current product specification, UI specification, route map, and implemented
surface model into a research-ready set of journeys.

For the canonical machine-readable index of implemented user interaction
intents, implementation references, confirmation gates, and test coverage, use
`interaction-registry.json` with `docs/INTERACTION_REGISTRY.md`.

Use this document to decide what to test, which persona lens to apply, and what
success looks like before proposing UX or implementation changes.

Source documents:

- `docs/PRODUCT_SPEC.md`
- `docs/USER_FLOWS.md`
- `docs/UI_SPEC.md`
- `docs/ROUTE_MAP.md`
- `docs/NOTIFICATION_SPEC.md`
- `docs/EXPORT_FORMATS.md`
- `docs/PUBLIC_PRODUCT_ARCHITECTURE.md`

## Product Boundaries

Cadence is a small public, open-source personal behavior tracker. The
authenticated web app supports many independent accounts, but every account is
single-player.

In this inventory, journeys must preserve these rules:

- The Timeline is the primary workspace.
- Behavior status changes happen only through explicit user action.
- Needs decision is a derived UI group, not a stored status.
- The UI uses `Completed`, `Not Completed`, and `Unresolved`.
- Prior unresolved occurrences are brought forward without punitive language.
- Marketing and product explanation live in the Astro site, not inside the
  authenticated tracker.
- Desktop, mobile native, billing, collaboration, AI coaching, social features,
  offline writes, and calendar sync are out of current v1 scope.

## Persona Set

These personas are testing lenses, not market segments. Each one exposes a
different risk in the product.

| Persona | Situation | Primary Goal | UX Risk To Watch |
|---|---|---|---|
| Maya, first-time private tracker | Wants a low-friction private place to track ordinary recurring patterns after hearing about Cadence. | Understand the product, sign in, create one behavior, and know what to do next. | Onboarding becomes too abstract, too technical, or too setup-heavy. |
| Jordan, fast daily checker | Opens the app during a busy day to record what happened and leave. | Mark today's occurrences and add a note when context matters. | Timeline actions are hard to scan, too small on mobile, or ambiguous after status changes. |
| Priya, reflective reviewer | Uses Cadence weekly to understand patterns without wanting a productivity dashboard. | Review adherence, inspect one behavior on one date, and correct a record. | Analytics feels punitive, dense, or disconnected from the actual record. |
| Sam, portability-focused adopter | Cares about BehaviorLog, open formats, and being able to leave with data intact. | Download usable exports, inspect a summary, and understand import/restore safety. | Export/import appears decorative, unsafe, or too opaque to trust. |
| Lina, reminder-dependent user | Relies on browser reminders, but expects the tracker to remain usable when reminders fail. | Enable reminders, understand blocked permission states, and configure behavior reminders. | Permission states or failed setup make the app feel broken. |
| Robin, privacy-conscious account owner | Wants confidence before storing personal records and needs a clear exit path. | Read trust/privacy, manage timezone/settings, export data, and delete account if needed. | Trust pages, deletion gates, or warning copy feel vague at the highest-risk moments. |
| Alex, keyboard and low-vision user | Uses keyboard navigation and larger text settings for routine web tasks. | Complete the same primary tasks without pointer-only interaction or color-only meaning. | Focus, touch targets, contrast, and status cues are not robust enough. |

## Journey Map

| ID | Journey | Primary Personas | Entry Point | Success Criteria |
|---|---|---|---|---|
| J01 | Public discovery | Maya, Sam, Robin | Marketing homepage or direct marketing route | User understands Cadence, BehaviorLog's role, and the next action without mistaking future scope for current scope. |
| J02 | Trust before sign-in | Maya, Robin | `/login`, `/terms`, `/privacy`, `/trust` | User can decide whether the product boundary, privacy model, reminders, export, and deletion posture are acceptable. |
| J03 | Sign-in | Maya, Robin | `/login` to Google, Apple or email sign-in and `/auth/callback`; `/settings#sign-in-methods` | User reaches `/timeline` after auth, or receives a recoverable error without exposing provider details, and can add or remove sign-in methods. |
| J04 | First-run activation | Maya, Lina | `/timeline` after first login | User sees the Timeline first, can use the setup pop-up, and can skip setup without losing the core workflow. |
| J05 | Create first behavior | Maya, Jordan | `/behaviors#create-behavior` | User creates a behavior with title, recurrence, and at least one schedule slot, then sees it represented in the app. |
| J06 | Maintain behaviors | Jordan, Priya | `/behaviors` | User edits recurrence/schedule/reminders, archives, restores, and understands active versus archived records. |
| J07 | Daily timeline use | Jordan, Alex | `/timeline` | User scans today, marks Completed or Not Completed, opens row details, saves a note, and sees resolved states clearly. |
| J08 | Future preview | Jordan | `/timeline?days=...` | User sees the next 7 days by default and can reveal more generated future days without treating future rows as tasks due now. |
| J09 | Needs decision | Jordan, Priya | Floating Needs decision control | User resolves prior-day unresolved occurrences without punitive language and can correct same-day accidental decisions. |
| J10 | Later correction | Priya | `/behaviors`, behavior heatmap/date review | User finds a behavior/date, reviews occurrences, changes a status, edits a note, and sees review metrics update. |
| J11 | Basic review | Priya | `/behaviors` | User interprets adherence, Completed/Not Completed counts, unresolved neutrality, category counts, and range options. |
| J12 | Browser reminders | Lina | `/settings#notifications`, behavior reminder controls | User understands permission, subscription, unavailable, denied, and behavior-specific reminder states. |
| J13 | Email reminders | Lina | Behavior create/edit reminder section | User enables email reminders per behavior only when intended and understands offset choices without provider detail. |
| J14 | Timezone management | Lina, Robin | `/settings#timezone` | User can detect, enter, and save an IANA timezone and understand that future unresolved occurrences are affected. |
| J15 | Export data | Sam, Robin | `/export` | User sets range/archive options and downloads JSONL, CSV, full JSON backup, BehaviorLog bundle, or Markdown summary. |
| J16 | Import BehaviorLog bundle | Sam | `/export#behaviorlog-import` | User uploads a bundle, reviews validation/conflict/privacy warnings, and applies only safe supported plans. |
| J17 | Restore backup | Sam, Robin | `/export`, restore panel | User understands destructive restore gates, stale-preview refusal, sensitivity acknowledgements, and non-restorable fields. |
| J18 | Legal and trust reference | Robin | Settings links or public routes | User can return to Terms, Privacy, and Trust from inside Settings without leaving the product boundary unclear. |
| J19 | Account deletion | Robin | `/settings` | User is reminded to export, acknowledges risk, types the required confirmation, and understands the outcome. |
| J20 | Empty and error states | Maya, Alex | All primary routes | User can recover from no behaviors, no occurrences, invalid import, auth failure, save failure, unsupported push, or blocked permission states. |
| J21 | Mobile navigation and task flow | Jordan, Alex | Protected routes under 1024px | User opens and closes the drawer, navigates, uses Timeline actions, and reaches settings without layout overlap. |
| J22 | Machine-readable public docs | Sam | Marketing `/docs`, `llms.txt`, Markdown mirrors | User or agent can find route manifests, examples, and machine-readable outputs without scraping the app shell. |
| J23 | Connect a calendar | Jordan, Alex | `/settings` calendar sections, `/timeline` | User connects Google, Outlook or iCloud Calendar, picks which calendars Cadence reads, refreshes or disconnects, and sees events as context on the Timeline. |
| J24 | Connect Hevy and count workouts | Alex | `/settings` Hevy section, `/behaviors`, `/timeline` | User connects Hevy, links a behavior so logged workouts complete it, counts an unlinked workout by hand, refreshes or disconnects. |
| J25 | Daily Brief and its moves | Jordan, Lina | `/timeline`, `/settings` Daily Brief and ChatGPT plan sections | User reads today's brief, answers or undoes its same-day moves, refreshes or reopens it, chooses what data it uses, and can run it on their own ChatGPT plan. |
| J26 | Travel and leave times | Jordan, Lina | `/settings#travel`, `/behaviors`, `/timeline` | User saves Home and usual travel, picks a behavior's Where, answers leave-time questions, corrects estimates, and turns travel estimates and leave reminders on or off. |
| J27 | Completion places | Priya, Robin | `/settings` completion places section, `/behaviors` | User turns completion places on or off, records or removes place markers, reviews Where suggestions, and deletes labels or markers. |
| J28 | Connect an AI app | Sam, Robin | `/oauth/consent`, `/settings#connected-apps` | User approves or denies an AI app's access, narrows its permissions, reviews its recent activity, and disconnects it. |

## Journey Details

### J01 Public Discovery

Primary persona: Maya.

Steps:

1. Land on the Astro marketing homepage.
2. Identify Cadence as the product and BehaviorLog as the portability standard.
3. Open `/faq`, `/examples`, or `/docs` based on intent.
4. Choose Try Cadence, Log in, Read BehaviorLog, Download Example Bundle, or
   View on GitHub.

Success criteria:

- The product does not look like a social tracker, gamified habit app, or
  medical dosing system.
- BehaviorLog is explained as a data portability layer rather than a second app.
- Future desktop/mobile/AI/billing work is not presented as current product
  capability.

Likely failure points:

- A user may not understand why BehaviorLog matters before they have data.
- Technical docs and examples may feel more prominent than the first product
  action for non-technical users.

### J02 Trust Before Sign-In

Primary persona: Robin.

Steps:

1. Arrive at `/login`.
2. Read links to Terms, Privacy, and Trust.
3. Confirm Google sign-in is the only visible login path.
4. Start Google auth.

Success criteria:

- Privacy, portability, account deletion, and reminder boundaries are visible
  before the user commits.
- The app does not imply admin access, collaboration, or hidden data sharing.
- OAuth errors are recoverable and factual.

Likely failure points:

- Legal/trust links may be skipped if they are visually too quiet.
- Users may expect email/password login if provider-level settings still allow
  it even though the UI does not expose it.

### J03 Sign-In

Primary persona: Maya.

Steps:

1. Choose Google, Apple or email sign-in.
2. Complete provider account selection, or open the emailed sign-in link.
3. Return through `/auth/callback`.
4. Land on `/timeline`.
5. Later, add or remove a sign-in method in `/settings#sign-in-methods`.

Success criteria:

- Authenticated users reach the Timeline by default.
- Unauthenticated protected route visits redirect to `/login?next=...`.
- Error states do not leak secret values or raw provider responses.

Likely failure points:

- A failed OAuth return may leave the user unsure whether retrying is safe.
- Production and local auth allow-list differences can create test-only
  failures that look like product failures.
- Removing the last working sign-in method would lock the user out, so the
  last method cannot be removed.

### J04 First-Run Activation

Primary persona: Maya.

Steps:

1. First authenticated Timeline render.
2. See current-day feed plus optional fixed setup pop-up.
3. Use links to create behavior, notifications, timezone, or import.
4. Skip setup if desired.

Success criteria:

- The setup prompt never blocks the Timeline.
- Import remains optional.
- Denied notification permission counts as a completed onboarding decision.
- The prompt does not request notification permission on page load.

Likely failure points:

- A user with no behaviors may see too many setup decisions before understanding
  what a behavior record feels like.
- Dismissing setup is local to the browser, so a user may encounter it again in
  another browser.

### J05 Create First Behavior

Primary persona: Maya.

Steps:

1. Open the create behavior disclosure from `/behaviors#create-behavior`.
2. Enter title and optional description/category.
3. Choose recurrence.
4. Add one or more schedule slots.
5. Confirm browser reminder default and optional email reminder.
6. Save.

Success criteria:

- At least one schedule slot is required and clearly recoverable if missing.
- Browser reminders default to enabled without forcing notification permission.
- Email reminders remain opt-in.
- The resulting behavior appears in active behaviors and generates occurrences.

Likely failure points:

- Recurrence plus schedule slots can overwhelm first-time users if grouped poorly.
- Users may confuse behavior description with occurrence note.

### J06 Maintain Behaviors

Primary persona: Priya.

Steps:

1. Open an active behavior's details/settings.
2. Edit recurrence, schedule, description, category, and reminder settings.
3. Archive a behavior.
4. Restore an archived behavior from the low-priority archived section.

Success criteria:

- Past and resolved occurrence history is preserved.
- Future unresolved occurrences update after schedule changes.
- Archive is factual and low-drama.

Likely failure points:

- The difference between inactive archived records and deleted records may need
  explicit support in test scripts.
- Users may expect category editing on the same screen, but v1 keeps category
  management limited.

### J07 Daily Timeline Use

Primary persona: Jordan.

Steps:

1. Open `/timeline`.
2. Scan current day from the top of the feed.
3. Mark an unresolved occurrence Completed or Not Completed.
4. Expand a row to add or edit a note.
5. Expand a resolved row to correct status if needed.

Success criteria:

- Status actions are visible for unresolved current-day rows.
- Completed and Not Completed resolved rows are distinct without moralizing.
- Notes are attached to occurrences, not behaviors.
- Mobile touch targets are at least 44px for status and note actions.

Likely failure points:

- Underlined text actions may be visually quiet for hurried users.
- Completion chime must not feel like gamification or play on page load.

### J08 Future Preview

Primary persona: Jordan.

Steps:

1. Review the next 7 days on Timeline.
2. Use Show more days.
3. Confirm empty days show "No behaviors on this day."

Success criteria:

- Future rows are visible as scheduled occurrences, not as overdue work.
- The show-more link respects generated horizon limits.

Likely failure points:

- Users may wonder whether future rows can be marked early and whether that is
  intended behavior.

### J09 Needs Decision

Primary persona: Priya.

Steps:

1. Open the floating Needs decision control.
2. Review prior unresolved occurrences grouped by local day.
3. Mark each occurrence Completed or Not Completed.
4. Correct same-day retained rows if needed.
5. Close the modal.

Success criteria:

- The count includes unresolved prior-day occurrences only.
- The modal starts with date groups, not a duplicate title or dashboard summary.
- Decided rows remain in their original day group through the current local day.
- Needs decision never appears as a stored status.

Likely failure points:

- A zero-count button that still opens retained decisions may confuse users.
- Modal scroll, close control, and date group gutters need mobile and keyboard
  scrutiny.

### J10 Later Correction

Primary persona: Priya.

Steps:

1. Open `/behaviors`.
2. Choose a date range.
3. Select a non-empty behavior heatmap cell.
4. Open a specific occurrence's Review disclosure.
5. Change status or save a note.

Success criteria:

- Later correction is deliberate and behavior-specific.
- Date and time are display-only.
- Counts, heatmaps, and rows refresh after correction.

Likely failure points:

- Users may not discover that heatmap cells are interactive.
- The overall heatmap is passive, while behavior heatmaps are actionable. This
  distinction needs testing.

### J11 Basic Review

Primary persona: Priya.

Steps:

1. Read Overall adherence.
2. Switch between 7, 30, and 90 day ranges.
3. Inspect behavior-level counts.
4. Check category counts if present.

Success criteria:

- Unresolved occurrences remain neutral and excluded from final adherence.
- The top Unresolved count matches Timeline Needs decision when nonzero.
- The screen avoids streaks, rewards, and dense productivity dashboard language.

Likely failure points:

- "Adherence" may read as clinical for some users.
- Heatmap colors must not be the only status cue.

### J12 Browser Reminders

Primary persona: Lina.

Steps:

1. Open `/settings#notifications`.
2. Read permission and browser push state.
3. Click the save/enable control.
4. Allow, deny, or encounter unsupported browser behavior.
5. Return to behavior reminder settings if needed.

Success criteria:

- Permission prompts are triggered only by user action.
- Denied, blocked, unavailable, and unconfigured states are factual.
- The app remains usable without browser push.

Likely failure points:

- Browser permission behavior varies by browser and can be hard to reproduce.
- Users may not understand that blocked permission must be changed in browser
  site settings.

### J13 Email Reminders

Primary persona: Lina.

Steps:

1. Open behavior create/edit.
2. Enable email reminders.
3. Choose offset.
4. Save behavior.

Success criteria:

- Email reminders are per behavior and opt-in.
- No Sequenzy secret, API key, or provider detail appears in client UI.
- Test plans do not send real emails without explicit approval.

Likely failure points:

- Users may expect a test-send button, but v1 intentionally does not include one.

### J14 Timezone Management

Primary persona: Robin.

Steps:

1. Open `/settings#timezone`.
2. Compare current and browser-detected timezone.
3. Use detected timezone or manually enter an IANA timezone.
4. Save.

Success criteria:

- Timezone detection uses browser/OS data, not geolocation.
- Saving updates profile, active behaviors, and future unresolved occurrences.
- Past and resolved occurrence history remains unchanged.

Likely failure points:

- IANA timezone entry is precise but not forgiving for users who do not know the
  exact name.

### J15 Export Data

Primary persona: Sam.

Steps:

1. Open `/export`.
2. Select range and archived behavior option.
3. Review current export counts.
4. Download JSONL, CSV, full JSON backup, BehaviorLog bundle.
5. Copy or download Markdown AI summary.

Success criteria:

- Every download reflects the same selected options.
- Export counts clarify what will be included.
- BehaviorLog bundle is positioned as the interoperability export.

Likely failure points:

- Users may not know which export format to choose.
- "AI summary" might be misread as an AI coaching feature if copy drifts.

### J16 Import BehaviorLog Bundle

Primary persona: Sam.

Steps:

1. Open `/export#behaviorlog-import`.
2. Upload `.behaviorlog.zip`.
3. Review validation errors, warnings, conflicts, privacy notes, note
   sensitivity, intervention preview, and merge actions.
4. Apply create-only or safe merge plan when valid.
5. Review recent import run status.

Success criteria:

- Unsafe or unsupported plans cannot be applied.
- High or restricted note sensitivity requires explicit acknowledgement.
- Imported interventions remain passive history.

Likely failure points:

- The preview can become dense because it carries real safety work.
- The user may confuse import with destructive restore.

### J17 Restore Backup

Primary persona: Robin.

Steps:

1. Upload a trusted backup for restore preview.
2. Review create, replace, archive, delete, keep, and skip decisions.
3. Review non-restorable fields.
4. Confirm fresh backup, type `RESTORE`, and acknowledge sensitivity when
   required.
5. Apply and inspect restore history.

Success criteria:

- Preview is read-only until explicit apply.
- Stale preview or stale local data blocks apply.
- Destructive scope is visible before confirmation.

Likely failure points:

- This is the highest-friction flow by design, so user comprehension matters
  more than speed.

### J18 Legal and Trust Reference

Primary persona: Robin.

Steps:

1. Open Settings.
2. Follow Terms, Privacy, or Trust rows.
3. Return to app or sign in/open settings as appropriate.

Success criteria:

- Public pages are factual and not marketing-heavy.
- They cover account isolation, manual statuses, portability, reminders, and
  deletion.

Likely failure points:

- Public account-information routes can be mistaken for marketing pages if
  visual vocabulary drifts.

### J19 Account Deletion

Primary persona: Robin.

Steps:

1. Open Settings.
2. Read export reminder.
3. Check acknowledgement.
4. Type the account email or `DELETE` when no email exists.
5. Submit deletion.

Success criteria:

- The action is irreversible enough to require explicit confirmation.
- The user understands hosted Cadence records are deleted and the account is
  signed out globally.
- The flow does not expose service-role details.

Likely failure points:

- Testers must use disposable accounts only.
- Users may expect account deletion to delete provider data or external provider
  state, which is outside Cadence's control.

### J20 Empty and Error States

Primary persona: Alex.

Steps:

1. Visit each primary route with a clean or sparse account.
2. Trigger common invalid states in safe test data.
3. Attempt recovery.

Success criteria:

- Empty states teach the next product action without motivational copy.
- Errors are factual, recoverable, and do not expose sensitive provider data.

Likely failure points:

- Sparse UI can become too quiet when a user needs recovery guidance.

### J21 Mobile Navigation and Task Flow

Primary persona: Jordan.

Steps:

1. Use a narrow viewport around 390px wide.
2. Open and close the drawer by button, backdrop, Escape, navigation click, and
   swipe gestures where test tooling allows.
3. Complete Timeline, Behavior, Export, and Settings tasks.

Success criteria:

- Drawer focus is trapped while open.
- Body scroll is locked while the drawer is open.
- Bottom Needs decision control does not cover critical row content.
- Text does not overflow controls or overlap adjacent content.

Likely failure points:

- Gesture behavior is hard to validate in headless tooling and needs manual
  device checks.

### J22 Machine-Readable Public Docs

Primary persona: Sam.

Steps:

1. Open marketing `/docs`.
2. Follow Markdown mirrors, `llms.txt`, `llms-full.txt`, route manifest,
   sitemap, robots, and example bundle links.
3. Confirm route and metadata consistency.

Success criteria:

- Agents and developers can discover public content without authenticated app
  scraping.
- The example bundle downloads and validates through the pinned reference path.

Likely failure points:

- Machine-readable links can drift from generated outputs if marketing checks
  are not run after route changes.

### J23 Connect A Calendar

Primary persona: Jordan.

Steps:

1. Open the calendar section in `/settings`.
2. Connect Google, Outlook or iCloud Calendar.
3. Choose which calendars Cadence reads and whether they show on the Timeline.
4. Open `/timeline` and see events as context beside behaviors.
5. Refresh, reconnect or disconnect when needed.

Success criteria:

- Calendar events show as context, never as Cadence behaviors or tasks.
- Disconnecting removes stored calendar data and says so.
- A failed refresh keeps the last good context and says when it was fetched.

Likely failure points:

- An expired provider grant can look like an empty calendar.
- iCloud app-specific passwords are unfamiliar to many users.

### J24 Connect Hevy And Count Workouts

Primary persona: Alex.

Steps:

1. Connect Hevy in `/settings` with an API key.
2. Link a behavior to Hevy in `/behaviors`.
3. Log a workout in Hevy and see the linked occurrence complete on `/timeline`.
4. Count an unlinked workout by hand when it belongs to a behavior.
5. Refresh or disconnect Hevy.

Success criteria:

- Connector completions are marked as coming from Hevy.
- A manual status always wins over a later connector match.

Likely failure points:

- Workouts logged across midnight can land on an unexpected day.

### J25 Daily Brief And Its Moves

Primary persona: Jordan.

Steps:

1. Open `/timeline` and read today's Daily Brief.
2. Answer each suggested move for today: yes, no, or another time.
3. Accept all or undo all moves.
4. Refresh the brief later in the day, or reopen it after closing it.
5. Choose what data the brief uses in `/settings`, and optionally run it on
   the user's own ChatGPT plan.

Success criteria:

- Moves change today only; the base schedule stays the same.
- Every move can be undone.
- The brief names its sources and says when data is missing or stale.

Likely failure points:

- A failed model call must not leave half-applied moves.
- Usage limits can stop a refresh; the notice must say when it can run again.

### J26 Travel And Leave Times

Primary persona: Lina.

Steps:

1. Save Home and usual travel in `/settings#travel`.
2. Choose a behavior's Where in `/behaviors`.
3. See leave times on `/timeline` and answer the leave-time question.
4. Correct travel for one event, or edit learned travel habits.
5. Turn travel estimates or leave reminders on or off.

Success criteria:

- A missing estimate says what is needed next.
- Device location is read only when the user asks.

Likely failure points:

- macOS Location Services can be off without the user knowing.

### J27 Completion Places

Primary persona: Priya.

Steps:

1. Turn on completion places in `/settings`.
2. Record a place marker when completing a behavior.
3. Review or dismiss a Where suggestion in `/behaviors`.
4. Change label retention, or delete labels and markers.
5. Turn completion places off.

Success criteria:

- No location is recorded before the user turns the feature on.
- Deletion removes the stored labels or markers and says what was removed.

Likely failure points:

- Users may not understand the difference between labels and markers.

### J28 Connect An AI App

Primary persona: Sam.

Steps:

1. Start a connection from an AI app such as Claude or ChatGPT.
2. Review requested permissions on `/oauth/consent`, narrow them, then
   approve or deny.
3. Review the app's recent activity in `/settings#connected-apps`.
4. Disconnect the app.

Success criteria:

- The consent screen names the app and each permission in plain words.
- Disconnecting stops access at once.

Likely failure points:

- A denied or narrowed grant can make the AI app report confusing errors.

## Cross-Journey Acceptance Themes

Use these as global pass/fail criteria across the inventory:

- The user can always tell whether they are looking at marketing, public legal
  information, or the authenticated tracker.
- The user can always tell whether a status is unresolved, completed, or not
  completed.
- The app never implies that unresolved prior-day items became failures by
  system action.
- High-risk flows, import, restore, and account deletion, are explicit and
  auditable.
- Reminder failure does not block core tracking.
- Export and deletion paths reinforce portability and user control.
- Keyboard and mobile paths cover the same primary work as pointer desktop use.
