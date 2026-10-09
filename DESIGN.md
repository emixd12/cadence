---
name: Cadence Tracker
description: A sparse, square, IBM Plex Sans-forward visual system for a public behavior tracker and BehaviorLog reference surface.
colors:
  primary: "#3572b3"
  background: "#FDFCFB"
  surface: "#F4F5F6"
  text: "#0A0B0C"
  muted-readable: "#626C75"
  accent: "#C84A31"
  timeline-row-hover: "#eef6ff"
  timeline-needs-decision-hover: "#e8f2ff"
  timeline-completed-hover: "#2f669f"
typography:
  display:
    fontFamily: "IBM Plex Sans"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0px"
  headline:
    fontFamily: "IBM Plex Sans"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0px"
  title:
    fontFamily: "IBM Plex Sans"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0px"
  body:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  label:
    fontFamily: "IBM Plex Sans"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "1px"
rounded:
  none: "0px"
spacing:
  sm: "8px"
  md: "24px"
  lg: "64px"
  xl: "120px"
  page-gutter: "clamp(20px, 4.5vw, 72px)"
  wide-page-gutter: "clamp(24px, 5vw, 80px)"
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    textDecoration: "underline"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.muted-readable}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    textDecoration: "underline"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    textDecoration: "underline"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  behavior-record:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "20px"
  timeline-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "24px"
  nav-active:
    backgroundColor: "{colors.timeline-row-hover}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "12px"
---

# Design System: Cadence Tracker

## 1. Overview

**Creative North Star: "The Quiet Ledger"**

The interface is a private field log and public reference surface: square, calm, legible, and exact. It uses IBM Plex Sans type, quiet rules, broad whitespace, black underlined primary actions, compact form controls, small heatmap cells, and flat product captures across the implemented auth shell, Behaviors screen, Timeline screen, Export screen, Settings screen, and Astro marketing site.

This is product UI, not a poster. The look can be distinctive, but every screen must still work quickly for marking occurrences, reading Needs decision, editing behaviors, checking basic analytics, and exporting records.

**Key Characteristics:**

- IBM Plex Sans-only typography.
- Bleached off-white background with quiet ash dividers.
- Muted blue used for selected recurrence presets, completed cells, and completed Timeline state.
- Pale timeline blue used for the current navigation route state.
- Rust red used for explicit Not Completed decisions and rare caution states.
- Square corners, no shadows, no blur, no rounded cards.
- Spacious desktop rhythm with compact, stackable mobile layouts.
- Shared page gutters should keep public pages from touching the viewport
  edge; wide marketing sections use the wider gutter token before max-width
  clamping.
- Behaviors, Export, and Settings may use the shared decorative page banner
  full width above route content.
- Public marketing pages keep the same square ledger vocabulary while making
  Cadence the first narrative position and treating BehaviorLog as the open
  portability layer behind Cadence exports.

## Ticket 132 review bench

Each timed event gets one marker at its start, or on the first visible day if it
started earlier. Later days retain duration segments without repeated markers.
Drawers fit their content with 16px padding and reserve only their rendered height.

All-day controls are absent when the day has no all-day events. Otherwise they
show “All day: {first event title}”, with “+N more” for additional visible events.
Dismissed events retain a Restore control. Hover, focus, click, and tap open the
same persistent preview. The preview has no repeated heading or divider. Each
event owns a View details button that opens only that event in the centered details
modal. Closing details returns focus to the original timeline control.


`app/design-system/DayProgressBench.tsx` compares current grouped rows with
proposed chronological rows using the actual OccurrenceRow component. It is
development-only synthetic evidence, excluded from product usage and interaction
counts. The revised candidate keeps timed Calendar context left of one continuous axis
and the ledger exclusively right. Restore action padding is 12px on narrow layouts and 16px on desktop. Day headers align
with the ledger while the axis continues through headers and days. Equal-time
peers keep visible actual-time labels without Behavior-facing ticks, nodes, or a
bracket. Desktop keeps Completed and Not Completed text visible by default and
hides it only when the measured title and actions do not fit. Mobile uses
icon-only actions with screen-reader labels, tooltips, and 44px targets. The
current grouped reference stays unchanged. There is no right-side All day
column. All Day Events sits beside the ledger-header day title and wraps on narrow
layouts. It uses
the same fixed bottom non-modal hover/focus preview drawer as timed Calendar events. The drawer reserves
matching viewport space, is at most `min(18rem, 40dvh)` (a maximum, never a fixed height), and scrolls internally. It persists until explicit
dismissal or replacement so a pointer can reach it. Each event’s View details action opens its own centered native details modal.
Close or Escape returns focus without reopening the preview. Dismiss and restore change local presentation
only. Use centered perpendicular stems without axis nodes for Calendar events;
group only identical original start instants in one event lane. Nearby starts remain separate. Timed-event hover/focus previews show actual
duration as a solid 1px magenta axis segment from the displayed original-day perpendicular-stem contact. It preserves mapped
length to the day body bottom. An overnight continuation starts at the next section top above its heading, continues to the event end without another marker or stem; details retain actual times. No
permanent duration bars appear. The current-time dot uses brand blue without a
row tint. No persistent overlap fill or edge appears. Hover/focus changes only overlapping Behavior borders to the owner-selected Poline facet `#DA3278`. Point
overlap uses `start <= activation < end`; estimated-duration overlap is half-open.
Completed and Not Completed fills remain unchanged. Preserve all other layout, colors, and
typography. `docs/qa/day-progress-layout.md` records
geometry and acceptance limits. The owner accepted the seventh-revision baseline
on 2026-09-16. Minor polish is deferred; production stacking stays unchanged
until Ticket 133 integration.

## 1.1 Surface Model

Cadence has one canonical design system with surface-scoped implementations.
The canonical system owns foundations, state semantics, accessibility
expectations, product language, and reusable component-family contracts. Each
surface may implement those contracts in its native runtime:

- **Authenticated web app:** Next.js/React live product components tracked by
  `design-system.manifest.json`, `design-system.usage.json`, and the local
  `/design-system` bench.
- **Astro marketing site:** static Astro templates and CSS that share Cadence
  tokens, section rhythm, marks, CTAs, and product-capture vocabulary without
  importing authenticated React components.
- **Desktop:** Tauri consumes shared foundations and product UI across all four
  screens. Native parity remains under verification; the operator bench is separate.
- **Mobile:** future local-first surface; implementation remains deferred.

`design-system.surfaces.json` is the machine-readable cross-surface catalog.
It groups tokens, primitives, navigation, layouts, patterns, and product
modules into canonical families, then maps each family to web, marketing,
desktop, and mobile implementations or planned notes. A surface may use a
different language or framework as long as it satisfies the shared contract.

Shared code should start at tokens and framework-light primitives. Do not
extract full product modules into `packages/ui` until another scheduled runtime
needs them and the extraction removes real duplication.

Ticket 109 moves canonical CSS variables to `packages/ui/tokens.css`, exported
as `@cadence/ui/tokens.css`. The web and marketing styles import that file.
The web retains its Tailwind directives and product classes; marketing keeps
its existing accent value, typography, layout tokens, and surface exceptions.
Token values and existing font loaders remain unchanged by extraction.

`@cadence/ui/fonts.css` supplies optional offline IBM Plex Sans through the
existing Fontsource 5.2.8 package. Its OFL notice ships as
`packages/ui/LICENSE.fonts.txt`. Desktop bundles and renders the font in actual
WKWebView. The web font loader remains unchanged. This package contains no visual
components, shells, or copied brand/audio assets. On 2026-08-31 the owner
authorized the six exact asset hashes for distribution inside Cadence; see
`docs/qa/2026-08-30-desktop-asset-provenance.md`. Third-party notices, MIT
exclusions, and reserved marks remain unchanged. Ticket 113's ad hoc preview is
in progress; original final-release acceptance remains deferred.

`@cadence/ui/runtime` supplies required refresh and link providers.
`WebRuntimeProvider` connects the web app and its bench to Next navigation.
Desktop `TimelineScreen` supplies local callbacks and reuses `TimelineGroup`,
`OccurrenceRow`, and `NeedsDecisionDialog`. `BehaviorsScreen` reuses the web
form, list, and review controls with a local review-link adapter. Desktop
reminder controls preserve dormant email intent without offering delivery.
`DesktopApp` retains the rail and mobile drawer structure; all four product screens
are wired. Its available-screen contract keeps unavailable screens disabled. The product entry connects these components to local services.
Native interaction and visual verification remain in progress.

`DesktopScreenFrame` preserves the existing page banner and content spacing.
Desktop Settings reuses `TimezonePanel` and adds native permission and readback
coverage controls. Complete, limited, and unverified states use factual text;
readback failure suppresses verified coverage claims. The desktop setup guide
reuses the existing checklist model and local dismissal preference. Settings
can reopen the guide without changing tracking data or requesting permission.

`ExportScreen` reuses the Export panel, range selector, Markdown actions, prompt
library, import panel, and restore panel. Runtime callbacks replace only option
submission, download transport, and import/restore actions. Web passes its
existing server actions explicitly. Notes and time tracking remain off by
default. File preparation, save cancellation, and errors use existing text
status patterns. Native save/cancel, privacy choices, merge/replay, and restore
workflows passed on the original 0.2 build. The 0.3 build also verifies native
archive saving, privacy defaults, explicit Note/time inclusion, and import
validation with loss warnings. Representative native keyboard
navigation, Escape dismissal, and launcher focus also passed. The interaction
registry and native QA records retain remaining lifecycle/release gates.
Current 0.3 integration evidence lives in
`docs/qa/2026-08-30-desktop-0.3-acceptance.md`.

## 2. Colors

The palette is almost monochrome: black ink, bleached paper, subtle gray, and one muted blue. Red is a rare warning signal.

### Primary

- **Monolith Blue**: `#3572b3`, used for selected states, hover fills on selected controls, completed Timeline rows, and completed heatmap cells.
- **Timeline Row Hover**: `#eef6ff`, used for unresolved and Not Completed Timeline occurrence row hover and the current navigation route state.
- **Needs Decision Hover**: `#e8f2ff`, used for prior unresolved Needs decision occurrence row hover.
- **Completed Row Hover**: `#2f669f`, used for Completed Timeline occurrence row hover.

### Secondary

- **Rust Signal**: Used for explicit Not Completed decisions and rare destructive or caution states. Keep the language factual so the color marks a recorded state, not a moral failure.

### Neutral

- **Bleached Newsprint**: Main app background.
- **Cold Surface**: Secondary panels, empty states, skeleton loaders, inline note areas, inactive heatmap cells, and inactive navigation hover.
- **Ink Black**: Main text, icons, and hard text hierarchy.
- **Ash Line**: The single border color for dividers, controls, panels, rows, inputs, and heatmap cells.
- **Readable Ash**: Essential secondary text where the lighter muted gray would not meet contrast.

### Named Rules

**The Four-Color Rule.** Most screens should read as black, background, blue, and surface gray. Rust appears for explicit Not Completed decisions and genuine caution.

**The Contrast Rule.** Use Ash Line for all borders and quiet separators. Use Readable Ash or Ink Black for text that the user must read.

## 3. Typography

**Display Font:** IBM Plex Sans
**Body Font:** IBM Plex Sans
**Label Font:** IBM Plex Sans

**Character:** The type should feel mechanical and logged, not nostalgic or cute. Use scale, spacing, color, borders, and layout to create hierarchy instead of introducing another font or heavier weights.

### Hierarchy

- **Display** (400, 30px, 1.2): Page titles and prominent dates on larger screens only.
- **Headline** (400, 24px, 1.25): Section titles such as Timeline, Behaviors, Export, and Settings.
- **Section** (400, 20px, 1.25): Major in-page panels and grouped content headings.
- **Title** (400, 18px, 1.25): Behavior titles, occurrence titles, card headings, and form section titles.
- **Body** (400, 14px, open leading): Notes, descriptions, recurrence summaries, and normal explanatory text. Keep prose to 65-75ch.
- **Label** (400, 12px, 1px tracking): Navigation labels, button labels, status pills, table labels, and compact metadata.

The active Tailwind text scale is shifted one step smaller than the framework default: `text-4xl` renders at 30px, `text-3xl` at 24px, `text-2xl` at 20px, `text-base` at 14px, and `text-sm` at 12px.
The active Tailwind font-weight scale is flattened for this no-bold experiment: `font-medium`, `font-semibold`, `font-bold`, and heavier utilities all render at 400.

### Named Rules

**The IBM Plex Sans Rule.** Do not introduce serif, display, script, or secondary sans fonts.

**The No-Cramped-Type Rule.** Letter spacing is never negative. The reference aesthetic comes from IBM Plex Sans letterforms and square layout, not squeezed letters.

**The Uppercase Limit Rule.** Headings, short labels, and buttons may use uppercase. Body copy, notes, descriptions, and helper text must use normal sentence case.

## 4. Elevation

This system is flat by default. Depth is created with borders, spacing, surface color, and full filled states, not shadows.

### Named Rules

**The No-Shadow Rule.** Do not use drop shadows, glass effects, blurred panels, or soft floating cards.

**The Quiet Divider Rule.** Prefer single 1px Ash Line dividers over full perimeter boxes. Inputs, select controls, compact chips, true dialogs, and dense data tables may still use enclosure when the boundary is functional. Hierarchy comes from fill, spacing, and typography rather than heavier border weight.

**The One-Line-Per-Boundary Rule.** Any boundary between two neighbors is drawn exactly once. Stacked page sections take a single divider between them (`divide-y` on the stack, or `border-t` on every section after the first), never per-section `border-y`, which doubles the line across the gap. A nested container never redraws its parent's boundary: a list inside a section uses inner `divide-y` only, with no outer border, and inline status text does not carry its own `border-t`.

**The Spacing Scale.** Vertical space encodes hierarchy on a fixed ladder, and parallel objects always share the same value:

| Boundary | Space | Owner |
|---|---|---|
| Page header rule → content; page-level siblings | 48px (`gap-12`) | the screen-frame stack |
| Section ↔ section | 16px + 1px rule + 16px (33px, rule centered) | the section stack: `divide-y` with `py-4` sections, `first:pt-0 last:pb-0` |
| Sub-block ↔ sub-block inside a section (fieldsets, Export subsections at 32px) | 24–32px | the section's own grid |
| Heading block → its content | 16px (`mt-4`) | the section |
| Sibling items (form controls, paragraphs) | 12px (`gap-3`) | the content grid |
| Tight groups (stat rows, dl pairs) | 8px (`gap-2`) | the group |
| Label → value | 4px (`gap-1`) | the item |

A boundary's space always exceeds every boundary one level below it; header rules echo in halves (page title→rule 24, rule→content 48; Export super-header desc→rule 16, rule→subsections 32). Title→description is 12px (`mt-3`) at every tier. Row density keeps three named tiers — 8px dense feed rows (Timeline), 12px ledger rows (settings links, setup rows), 16px airy rows (export downloads, behavior records) — chosen per surface, never mixed within one list. Overlay panels pad at 16px with 12px inner insets. Timeline is exempt at the top: its day headers are the page's first tier and keep their promoted 48px rhythm. Public account pages follow the same ladder one step airier (24px section padding, 33→49px section gaps).

**The Heading Ladder.** Page title `text-3xl sm:text-4xl` → super/promoted headers (Export's Export/Import, Timeline's today date) `text-2xl` → section headings `text-xl` → row titles `text-lg` and below. Headings never carry bold overrides; weight stays normal per the type experiment.

## 5. Components

### Buttons

- **Primitive:** Text on a transparent background with a thin underline. This is the default action/link vocabulary in the design-system harness and for lightweight product actions.
- **Primary:** Ink Black text, underline, Label typography, and no perimeter box.
- **Secondary:** Readable Ash text, underline, Label typography, and no perimeter box.
- **Danger:** Rust Signal text, underline, Label typography, and no perimeter box. Use for factual destructive or caution actions such as Archive behavior.
- **Reserved fills:** Use filled button surfaces only for selected controls, destructive confirmations, fixed high-priority actions such as Needs decision, and cases where the target needs a larger touch surface.
- **Hover / Focus:** Hover may add non-reflowing text emphasis or shift secondary actions to Ink Black. Focus must use a visible 2px outline with offset.

### Chips

- **Style:** Square, compact labels with 1px border.
- **State:** Selected chips use Monolith Blue fill with Bleached Newsprint text. Unselected chips stay background with Ink Black text.

### Cards / Containers

- **Corner Style:** Square corners (0px).
- **Background:** Bleached Newsprint for normal rows; Cold Surface for empty states, expanded details, and low-emphasis panels.
- **Shadow Strategy:** No shadows.
- **Border:** Prefer single Ash Line dividers and unboxed sections. Behavior records and Timeline occurrence rows are unboxed list rows. Use perimeter borders only where a real field, modal, table, or dense control needs an explicit boundary.
- **Internal Padding:** 16px for behavior rows (airy row tier), vertical 10-12px padding plus a compact horizontal inset for Timeline occurrence rows on both desktop and mobile. Page sections follow the Spacing Scale (16px section padding inside a divided stack) instead of large per-section padding.

### Inputs / Fields

- **Style:** Bleached Newsprint background, 1px Ash Line border, square corners, IBM Plex Sans body text, and 8px 12px padding.
- **Selects:** Native select controls use the shared select primitive: the same square field enclosure with the browser widget chrome removed (`appearance: none`) and a 16px Ink Black stroke chevron. The chevron sits at the field's standard 12px inset from the right border, mirroring the 12px left text inset, with right padding reserving 40px so text never runs under it.
- **Focus:** Keep the square geometry and add a visible outline.
- **Error / Disabled:** Errors use Rust Signal text. Disabled states use Cold Surface and Readable Ash.

### Behavior Management

- **Form layout:** Full-width page section without an extra outer card border or outer padding. Use stacked field groups, quiet inner dividers, and a two-column desktop rhythm that collapses to one column on mobile.
- **Scheduled time:** Show only the scheduled-time control in the Behavior form. Timezone is owned by Settings and should not appear as a separate create-form panel.
- **Recurrence section:** Render as an unframed form section with a plain section heading, segmented radio presets, and smaller muted subsection labels such as Every, On, and Day.
- **Recurrence presets:** Segmented radio labels use Monolith Blue fill only for the selected preset. Weekday choices use compact borderless labels with a visible native checkbox.
- **Reminder section:** Render as an unframed form section matching Recurrence, with a plain section heading, bordered checkbox controls, and smaller muted subsection labels such as Reminder offset.
- **Create behavior:** Keep the creation form available from the Behaviors page without making existing behavior records secondary. When records already exist, use a simple native disclosure; when no records exist, the disclosure may open by default.
- **Behavior records:** Active records are unboxed list rows separated by a single 1px Ash Line divider between adjacent records. They keep 16px padding (airy row tier), visible range-based adherence, Completed and Not Completed counts, and a per-behavior calendar sized to the row. Visible outcome stats use the same compact vertical rhythm as metadata inside Details and Settings. Lower-use behavior characteristics such as category, schedule, recurrence, reminders, and description live inside the row's Details and Settings disclosure with the edit form. Archive behavior appears at the end of that settings area and aligns to the opposite side of the Save/Cancel footer row on desktop. Create and edit forms use real field/control borders only; schedule slots use quiet row dividers instead of perimeter boxes.
- **Behavior date review:** Selecting a non-empty behavior calendar cell opens a quiet row-level review area for dated occurrence records. Date of behavior, Time of behavior, Status, and Note render as plain detail rows. Date and time are display-only. Status and Note correction controls stay hidden behind a per-occurrence Review disclosure.
- **Archived behaviors:** Archived records stay out of the active behavior feed and live behind a low-priority bottom disclosure with a count. Restore uses the primary text-action treatment.
- **Archive and restore actions:** Archive behavior uses a factual Rust Signal underlined action at the end of Details and Settings for active records. Archived records stay visible with a neutral square label and a factual Restore action using the primary text-action treatment.
- **Disclosure controls:** Native `summary` controls are the product's standard hide/show trigger button for disclosure sections and row detail drawers. Use the shared disclosure-trigger class for marker hiding, cursor, focus, and tap affordance. Use the shared indicator where a section needs an explicit opener, but omit a separate icon when the whole row is the trigger. Disclosure content spacing belongs to the disclosure pattern or the relevant row pattern, not one-off instance padding.

### Navigation

- **Desktop:** Fixed retractable sidebar with quiet dividers and compact labels. Expanded width is 256px and collapsed width is 64px. The main content uses matching large-breakpoint left padding. Header, navigation, and footer account rows share a fixed 64px icon/avatar column so collapsed and expanded icon positions match. The desktop sidebar header has no bottom divider. In the expanded rail, the Cadence mark and name link to `/timeline`, and the collapse control stays separate from the brand link. In the collapsed rail, the brand cell is an expand-only button with no navigation side effect; hovering it swaps the Cadence mark to the open-sidebar icon. Brand links use a 70% opacity state on hover and press. Active route uses Timeline Row Hover fill with Ink Black text. Inactive hover uses Cold Surface. Primary navigation rows do not have gaps between them. In collapsed state, active and hover fills apply only to the icon cell, not the full row.
- **Sidebar motion:** Width, brand label opacity, and nav label opacity transition over 200ms. Labels remain in the DOM, collapse visually to `w-0`, and stay `whitespace-nowrap` so text never wraps during rail transitions.
- **Mobile:** Do not use the collapsed rail under 1024px. Use a sticky 64px top header that opens a 60vw left drawer. The header has no bottom divider at the top of the page; a 1px Ash Line divider fades in over the first short scroll distance so separation appears only when content moves underneath the sticky bar. The Cadence mark and name in the sticky header and drawer header link to `/timeline`; the hamburger remains the drawer opener. Brand links use a 70% opacity state on hover and press. The drawer keeps the same square navigation vocabulary and its header has no bottom divider. The drawer traps focus while open, locks body scroll, closes from backdrop or Escape, supports edge swipe open from the first 20px of the viewport, and supports left swipe close. The drawer may use a narrow `shadow-lg` only to separate it from the faded backdrop.
- **Routes:** Use the documented primary app screens: Timeline, Behaviors, Export, Settings. `/analytics` is only a compatibility redirect to Behaviors. Do not copy placeholder labels from the reference screens.
- **Page banner:** Behaviors, Export, and Settings may start with the shared decorative page banner image as a full app-content-width banner with a tiny top inset and no bottom margin. Timeline keeps its own decorative image treatment and hides the visible page title below it.

Desktop signed-in footer uses the web account row geometry: 60px height,
64px icon column, square 32px initials, and a truncated display name. Collapsed
navigation retains the initials and account-name tooltip. Activation opens
Settings. Local mode keeps Local profile. Disconnect choices remain in Settings.

### First-Run Setup

- **Placement:** Timeline may render a dismissible fixed setup pop-up only while required public-launch setup items remain incomplete. It must not take space above the feed. Once the user dismisses it in the current browser, or behavior/notification/timezone setup is complete, the Timeline returns to the normal feed-first rule.
- **Structure:** Use a non-modal pop-up with a quiet header, Skip setup control, and divider-separated rows. Do not use an inline band, wizard, modal takeover, progress meter, reward language, or motivational copy.
- **Rows:** Create first behavior, Browser reminders, Timezone, and Import existing records. Each row uses a small icon, a factual status label, and an underlined text link into existing controls: `/behaviors#create-behavior`, `/settings#notifications`, `/settings#timezone`, and `/export#behaviorlog-import`.
- **State language:** Use direct labels such as Start here, Done, Not enabled, Blocked, Unavailable, Confirmed, Review, Started, and Optional. Import is optional and must not block setup completion.
- **Permission behavior:** The setup pop-up reads browser support and permission state, but it never requests notification permission on page load. Denied or blocked notification permission is a completed onboarding decision, not a reason to keep the setup pop-up open after the other required setup items are done.

### Timeline Rows

- **Timeline structure:** The current day is the first forward feed section and uses the strongest date treatment. Do not show a visible Timeline page title above the feed. The transparent Cadence horse-line-and-dot image may sit directly above the feed as a full app-content-width banner with no extra top or bottom margin; the first Timeline day section remains the current day. Day transitions use the date header plus a thin divider, not boxed day sections. Needs decision is reached from a fixed lower-right button on desktop and a full-width lower safe-area button on mobile; it opens a modal rather than appearing as an inline Timeline section.
- **Daily Brief:** The existing Timeline horse may carry one read-only text bubble on first opening. The square bubble overlaps the horse tail in normal document flow, uses a small square pointer, wraps and scrolls long text, and never covers occurrence status controls. It has a 44px Close action and no suggested-action control, modal, focus transfer, or decorative motion.
- **Mobile refresh:** At mobile widths, a downward pull from the top of Timeline uses a 72px threshold and the factual states Pull to refresh, Release to refresh, and Refreshing timeline. Render the temporary feedback as a small square, bordered surface below the sticky header with no shadow. Short, horizontal, cancelled, below-the-top, and control-started gestures retain their normal behavior. One qualifying release requests one route refresh and never mutates an Occurrence or adds offline behavior.
- **Collapsed unresolved:** Scheduled time as plain text, behavior title, Completed text-link action, and Not Completed text-link action. Rows are compact and unboxed, with collapsed time, title, and action text vertically centered within the row; do not draw a perimeter border around each behavior row. Row content keeps a compact horizontal inset on both desktop and mobile, and time, title, Completed, and Not Completed share one horizontal row when unresolved status actions are visible. Completed and Not Completed keep their minimum tap target and same-line labels; the time and title may compact and truncate before the status targets shrink. Primary status actions are visible for Needs decision rows and current-day unresolved rows. Preset time ranges show only their short label, such as Morning or Evening, in collapsed rows.
- **Timeline status actions:** Render Completed and Not Completed as inline underlined text-link controls with the check and x icons retained. Do not use boxed, filled, or outlined button chrome for these row-level status actions. Keep status action underlines consistently thin; do not use underline thickness to indicate that a row is already Not Completed. Mobile status and Save note actions should have at least a 44px tap target. Hover-capable devices and keyboard focus may add non-reflowing text emphasis as a targeted exception to the base no-bold type experiment, but should not change the action color or move adjacent actions.
- **Expanded details:** Native disclosure reveals description, category, schedule summary, and note directly on the row surface, without a grey panel, enclosing border, top divider, boxed card treatment, chevron, or separate disclosure icon. Opening a resolved row keeps Completed or Not Completed vertically centered in the summary-height line and horizontally parallel to the behavior title; detail height must not recenter the label farther down the row. The detail block uses a small left inset. Measure spacing optically between rendered text and field edges: the largest gap is the standardized 16px disclosure-row gap between the collapsed row content and the first detail label, the next-largest gap is between detail pairs, and the smallest gap is shared by detail label/value, Note label/textarea, and textarea/Save note relationships. While open, the whole occurrence row holds the same blue background used by that row's hover state. The Note textarea keeps its field border; Save note uses the same underlined text-action vocabulary as Completed and Not Completed.
- **Track time:** Active current-day and visible Needs decision occurrences expose one underlined Track Time action. Do not repeat it as a heading while idle or stopped. While a session runs, Track time becomes a static, non-underlined label above the tabular counter and timing actions. All timing text and actions inherit the occurrence row's contrast-aware text roles.
- **Resolved:** Keep resolved rows visible with distinct states. Completed rows hide primary status actions and use a full Monolith Blue fill instead of a separate status chip. Not Completed rows use the same resolved-row structure with Rust Signal fill, Bleached Newsprint text, and a collapsed Not Completed label; correction is available from the expanded row.
- **Completion feedback:** A successful user-initiated change into Completed may play one short chime. Use one actual media playback attempt for the confirmed transition; gesture preparation must not start a separate muted media element. Keep the Web Audio fallback prepared for browsers that reject delayed media. Treat the chime as state feedback, not a reward loop: no voice, no alarm tone, no repeat sound, and no sound for Not Completed or page load.
- **Needs decision:** The floating button shows the unresolved count to decide and uses Monolith Blue when the count is greater than zero. Keep the count and label on one continuous button surface without an internal divider. On mobile, the button spans the lower safe-area width and the modal becomes a full-height sheet with the same flat row vocabulary. On desktop, the modal uses a flat bordered panel. The open modal has no visible global Needs decision title, global count, Prior unresolved eyebrow, or reserved header row. Pin the close control over the top-right corner and let the first white date group start at the top of a scroll area with equal left and right modal gutters; only the date header text row may reserve space for the close control. Each date group shows the date with the per-date count left to decide underneath. Highlight prior unresolved rows with Cold Surface and thin structural lines, never red error styling. Rows decided from the modal can remain in their original prior-day group through the current local day; Completed retained rows use the full completed treatment, and Not Completed retained rows use the Rust Signal treatment with the same resolved-row structure. Do not write or imply a stored Needs decision status.

### Behavior Review Heatmaps

- **Behavior review structure:** Overall adherence sits near the top of Behaviors with the active range selector directly above the overall calendar inside that same area. The overall adherence label and percentage share one adjacent, unbroken header line at desktop widths; the selected date range sits directly underneath in compact muted month-day wording. The range selector, calendar, and legend form one right-aligned desktop cluster. Review sections are unboxed report bands separated by single horizontal dividers where needed, not perimeter panel borders.
- **Calendar legend:** The overall calendar legend stays visible and vertically listed to the right of the calendar on desktop.
- **Top summary unresolved count:** When nonzero, match the Timeline Needs decision count by counting only active unresolved occurrences before the current local day, regardless of the selected Behaviors range. Hide the top summary Unresolved row when the count is zero. Current-day unresolved occurrences may still show in heatmap cells and behavior date review rows, but per-behavior and category count grids do not render an Unresolved row.
- **Completion-intensity cells:** Overall calendar cells mix Monolith Blue with Bleached Newsprint by completed share: 100% uses full Monolith Blue, 50% uses a half-strength blue, and lower shares keep fading toward the background.
- **Not completed cells:** Overall calendar cells with resolved occurrences but no completions use Rust Signal rather than the neutral completion-intensity scale.
- **Unresolved cells:** Cold Surface or background with a neutral border. Do not imply failure.
- **Grid:** Square cells, consistent gutters, no gradients, no rounded cells. Calendar cells show a compact date label on hover or keyboard focus while keeping the longer accessible label available.
- **Behavior rows:** Behavior counts use unboxed divider rows with title, adherence label, Completed and Not Completed label/value counts, MM-DD-YY tracking-since text, and a seven-column heatmap sized to the row. Values align left in the shared field column with equal vertical spacing. Category, schedule, recurrence, reminders, and description sit inside Details and Settings. Full completion is filled blue; partial states use factual diagonal marks; not completed states use Rust Signal without an added diagonal mark. The behavior tracking start date is marked with a dotted cell border when it falls inside the selected range. Non-empty behavior calendar cells open that behavior's Behavior date review area.
- **Behavior day review:** The selected day appears inside the selected behavior row as a quiet Cold Surface expansion headed by Behavior date. Do not use internal divider lines that compete with the behavior-row separators. Each occurrence uses plain text rows for Time of behavior, Status, and Note; empty notes display italic No note. Status and note correction controls stay hidden behind a Review disclosure by default. Inside the disclosure, Change status and the Completed / Not Completed actions sit on the same row when space allows, followed by accepted Note shortcut buttons and the inline Note form. Do not render an empty inspection panel when there are no occurrences on the selected behavior day.

### Export Panels

- **Export structure:** Options, downloads, and AI summary stack as separate sections. Keep range, selected-range scope counts, archived-behavior controls, and note controls at the top so every download reflects the same selected state. Export and Import are super-sections one tier below the page title: `text-2xl` headers, 48px apart, with 32px to their subsections; subsection headings are `text-xl` with 16px to their content, per the Spacing Scale and Heading Ladder.
- **Range controls:** Use underlined text-action choices for 7 days, 30 days, 90 days, and All time. Selected range uses Ink Black text. Inactive range choices use Readable Ash. The archived-behavior option uses a plain checkbox.
- **Download actions:** JSONL, CSV, full JSON backup, and BehaviorLog bundle use compact two-column label/action rows with the file extension next to the format name. Avoid explanatory card grids, icons, or restore/import promises in the UI.
- **AI summary:** Show a Markdown preview in a Cold Surface preformatted panel, with Copy summary and Download .md controls above it. The preview uses resolver-produced content; the UI does not calculate adherence or format export rows.
- **Prompt library:** Place Analysis prompts after the AI summary as unboxed native disclosure rows with inner `divide-y` separators at the 16px airy tier. Expanded prompts use a bordered Cold Surface preformatted panel matching the AI summary preview and an underlined Copy prompt text action.
- **BehaviorLog import:** Keep import preview sparse and ledger-like. Show privacy warnings, imported-note record counts, inline occurrence-note fill counts, and intervention preview counts before apply. High or restricted note sensitivity requires a separate checkbox acknowledgement. Do not add a generalized note browser here.

### Settings Panels

- **Page structure:** Settings is a single-column stack of unboxed sections separated by one 1px Ash Line divider between neighbors, following the One-Line-Per-Boundary Rule. Sections draw no perimeter or `border-y` of their own, and no side-by-side section grid. Section content keeps a readable measure: prose within roughly 65ch and form controls at a compact single-column width instead of multi-column desktop sprawl.
- **Daily Brief:** Settings uses two native checkboxes for explicit Daily Brief enablement and optional selected Calendar timing. The disclosure stays factual, links to provider retention terms, and states that the model cannot change Cadence or Calendar records.
- **Profile:** Quiet label/value rows only.
- **Timezone:** One native select of IANA timezones whose selected value is the saved timezone; the select is the single source for "current timezone", with no separate current or browser-detected value rows and no visible label repeating the section heading. When the browser-detected timezone differs from the saved one, show one quiet muted line, "Detected {timezone}", with an inline secondary Use detected timezone text action that updates the select; when they match or detection is unavailable, show nothing. Saving stays an explicit primary Save timezone action, with helper copy explaining the schedule impact. If the browser cannot enumerate timezones, fall back to a plain IANA text field.
- **Notification permission:** One section with a Browser notifications status value plus a single primary text action. Permission prompts must be triggered by the user, not on page load.
- **Unavailable states:** Use factual muted text for denied, unsupported, or unconfigured browser push. Rust Signal is only for an actual save error.
- **Inline results:** Save confirmations and errors are plain text lines under their form. They do not carry their own divider.
- **Trust and legal:** Link to Terms, Privacy, and Trust from Settings using quiet ledger rows separated by inner dividers only; the list draws no outer border. The list sizes to its content so row dividers span only the length of the text, not the full section width. Each row is a full-row link and hovers with the standard inactive-row treatment: Cold Surface fill across the row with the muted summary shifting to Ink Black; keyboard focus uses the global focus outline.
- **Account deletion:** Use a flat single-column Settings section with export reminder copy, a checkbox acknowledgement, typed confirmation, and a Rust Signal destructive text action, with no internal horizontal rules. This is the only destructive account action in the public-launch web app baseline.

### Public Account Information

- **Routes:** `/terms`, `/privacy`, and `/trust` use the same square, flat product vocabulary as the authenticated app.
- **Layout:** Keep public legal/trust pages narrow, text-first, and divided by quiet rules. Use plain navigation between the three pages and simple Sign in / Open settings actions. They follow the Spacing Scale one step airier: 24px section padding in the divided stack, the standard 24px title→rule and 12px title→description, and 16px heading→content.
- **Copy:** Keep legal/trust copy factual. Explain account isolation, manual statuses, portability, reminders, and deletion without marketing claims or motivational language.

### Astro Marketing Site

- **Routes:** The marketing site lives under `apps/marketing` and implements
  `/`, `/faq`, `/examples`, `/docs`, and `/about`. `/standard` and `/cadence`
  remain compatibility redirects to `/`.
- **Layout:** Use full-width page sections separated by 1px Ash Line rules.
  Keep hero text unboxed and leave the next section visible in the first
  viewport. Apply the shared marketing page-gutter tokens to section, header,
  and footer bodies before max-width clamping so desktop pages keep breathing
  room at viewport edges. The homepage hero may use a two-column copy/media
  composition when the media is a direct product capture, not a decorative
  card.
- **Heading scale:** Marketing H2 headings sit one step below the prior display
  scale so secondary sections do not compete with the homepage H1.
- **Brand relationship:** The homepage leads with Cadence as the product and
  site brand. BehaviorLog is explained as the open bundle standard and
  portability layer Cadence writes and reads. Keep the existing Cadence mark,
  and use only the Cadence logo and name in the marketing header. Do not use a
  combined BehaviorLog/Cadence lockup in top navigation. Header navigation
  links use the underlined text-action convention and no bottom divider. The
  launch header shows the Cadence brand link, a compact Download for Mac
  button to the disclosed preview release, and Log in. The logo keeps its square
  dimensions; narrow headers wrap the actions before compressing the brand. About and FAQ are
  footer-only, and Docs/Examples stay available by direct link and
  machine-readable outputs rather than top navigation.
- **Captures:** Product visuals are sanitized static captures of the Timeline
  and BehaviorLog bundle file set. They reuse real Cadence row language:
  scheduled time, behavior title, Completed, Not Completed, Needs decision,
  Note, and status-history authority. They do not render real account data.
  The homepage hero layers the trajectory-horse backplate with sanitized Timeline and behavior-row captures positioned in CSS. The composition must stay quiet, keep the captures readable, and fit the available lane without colliding with the headline or clipping offscreen at any viewport width.
- **CTAs:** The launch marketing site uses filled-button CTAs rather than the app's underlined text actions: a Monolith Blue filled primary (Try Cadence), a 1px-bordered secondary, and underlined ghost links for tertiary actions. The header uses a compact Monolith Blue Download for Mac button and keeps Log in as an underlined text action. This is a deliberate marketing-register exception; the authenticated app keeps its underlined text-action vocabulary.
- **Mobile marketing examples:** Below 620px, walkthrough form fields stack and
  Occurrence actions sit below the time and title. Chat example footers and file
  names wrap within their panels. The heatmap legend wraps when its panel is too
  narrow for both columns. The mobile hero stays inside its content lane.
- **Docs route:** `/docs` is agent-first and developer-familiar. It links to
  Markdown mirrors, `llms.txt`, `llms-full.txt`, `/data/route-manifest.json`,
  sitemap, robots, and the example bundle. Use tables for machine file indexes
  rather than decorative cards. On narrow screens, tables wrap inside the page
  width rather than causing document-level horizontal scroll. Future docs
  should grow toward Guides, Reference, Examples, Agent policy, and Schema
  history without dropping machine-readable mirrors.
- **SEO and agent readability:** Pages include canonical URLs, page-specific
  descriptions, Open Graph/Twitter metadata, JSON-LD, one H1, semantic
  landmarks, and Markdown alternate links.
- **Marketing boundaries:** No marketing cookies, analytics scripts,
  client-side tracking, mobile teaser, billing teaser, or AI coaching copy
  appears in the launch site. The header may link to the disclosed macOS
  preview release without implying notarization or broad compatibility.
- **Marketing register exceptions:** The marketing site shares the Cadence palette and IBM Plex Sans, and may additionally use: border radii (12px cards, 8px controls, pill chips), a sticky header with backdrop blur, font weights 400 to 600, a subtle two-hue page gradient, and IBM Plex Mono strictly for file names, file trees, and code samples. Decorative shadows remain banned on both surfaces. The square, flat, all-400, shadow-free rules elsewhere in this document bind the product app, not the marketing site.

## 6. Do's and Don'ts

### Do:

- **Do** use IBM Plex Sans everywhere.
- **Do** use 0px border radius throughout the app (the marketing site follows the Marketing register exceptions).
- **Do** prefer single quiet 1px Ash Line dividers over full perimeter boxes.
- **Do** keep the Timeline as the primary screen and `/timeline` as the default authenticated route.
- **Do** keep categories hidden from primary navigation and Timeline filtering.
- **Do** make mobile layouts stack vertically with comfortable 24px spacing.
- **Do** use Timeline Row Hover for active navigation, Monolith Blue for selected states and completed cells, Ink Black for primary actions, and Readable Ash for secondary actions.
- **Do** use Rust Signal for explicit Not Completed decisions and true caution states.

### Don't:

- **Don't** use dense dashboards.
- **Don't** use gamified streaks, rewards, badges, or scorekeeping.
- **Don't** use social habit-tracking language.
- **Don't** use motivational coaching copy.
- **Don't** use medical dose, supply, or refill tracking patterns.
- **Don't** use quantified-self analytics sprawl.
- **Don't** use multi-user SaaS administration patterns.
- **Don't** use calendar-sync or task-manager complexity.
- **Don't** add web offline or PWA mutation flows without a scoped ticket. Desktop local writes are active under Tickets 107–113.
- **Don't** add rounded cards, soft shadows, blurred panels, gradients, glass effects, or decorative stripes.
- **Don't** use missed, failed, or punitive language for Not Completed.
- **Don't** copy the reference screen content, sample habits, route labels, or flows.

Native notification activation reuses the Timeline row. Visible feed targets
expand in place; other stored targets appear in a quiet Opened reminder section.
Per-instance disclosure IDs avoid collisions with Needs decision. Explicit
primary navigation resets scroll; refresh and day review preserve it. Setup
anchors wait for asynchronous content. Native product click/focus passed: the
intended row expanded and received focus, and Tab reached its Track Time control.
Evidence: `docs/qa/2026-08-30-desktop-lifecycle-release.md#product-notification-click-passed`.

Desktop Settings includes an optional App updates section. The local build
shows unavailable text until signed release configuration exists. Check,
install, and restart remain separate user actions. The unconfigured state
passed WKWebView QA; signed update installation remains pending.

Web Export reads counts first. Its AI summary section uses Generate summary
with pending and retry states, then the existing preview and copy/save actions.
Desktop retains the same section with a locally prepared summary.


## Category controls (Tickets 123–124)

CategoryPanel uses native inputs, a textarea, explicit deletion acknowledgement,
and Move up / Move down text actions. BehaviorList uses native Category and Sort
selects with matching counts and Clear filters. Hidden rows retain mounted drafts.


Archive note controls reuse the Behavior details textareas and underlined text
actions. Archived Behavior details display dated Archive history with Save note
and Remove note. The shared web/desktop component stacks entries vertically
and wraps actions on narrow screens. No token or navigation changes.

## Production day-progress presentation

`components/timeline/DayProgressTimeline.tsx` shares the accepted continuous axis
across web and desktop. `ExternalEventDetails` owns persistent preview and native
dialog presentation. `GoogleCalendarPanel` reuses SettingsPanel and native form
controls. Synthetic Calendar bench adapters perform no provider or account reads.

The production current-time dot updates on visible minute boundaries without an
SVG position transition. This avoids an animation continuing after minimization.


## Behavior planning fields

The shared Behavior form now uses native optional number/date inputs for default duration and scheduled archive. Existing tokens and field styling remain. Timeline and Behaviors reuse divider-led status text for automatic archive notifications. No new visual primitive or token was introduced.


## Calendar inspection and reload (Ticket 149)

The shared Timeline uses `--calendar-overlap: #DA3278`, the owner-selected Poline
facet. A transparent 1px row border changes color during Calendar preview without
a glow or layout shift. Manual status fills and keyboard focus remain distinct.
Google Calendar markers use the bundled official provider asset.
The non-modal preview keeps bottom placement and 16px padding. Its 44px close
control centers its icon on the first title line. Explicit View details opens a
centered native dialog, capped at 40rem with 16px viewport clearance and scrolling.
Healthy freshness has no permanent label. Timeline refresh gives temporary
completion or failure feedback after Cadence and connector reads.

## Marketing connector walkthrough

`HowItWorks.astro` has five divider-separated modules. The connector module
reuses the step typography, spacing, square frame, and mobile stack. Its static
Timeline illustration shows an event left of the axis, a behavior overlap in
`--calendar-overlap`, and event details beneath the ledger. The illustration uses
synthetic content and the bundled Google Calendar icon; it has no live controls.


## Calendar selection (Ticket 150)

The shared GoogleCalendarPanel uses a square native details field with wrapping
selected-name tags, a labeled search input, and a bounded checkbox list. Tags use
Timeline Row Hover. Controls retain 44px targets, explicit Save, and per-calendar
visibility. Escape restores summary focus. CalendarSettingsBench includes long
names and enough synthetic choices to exercise scrolling.


## Briefing workbench (Tickets 151–155)

`/design-system?preview=briefing-workbench` uses neutral bench controls and the real
horse bubble. Two columns stack on narrow screens. Voice, scope, reference, and
planner fieldsets use labeled native controls. Runs require an explicit action;
editing configuration preserves reviewed output and marks changed drafts. Inspectors expose effective
facts, omissions, planner constraints/rejections and versions. Draft storage and
exports contain configuration only. Local cases retain captured inputs, outputs and exact feedback for 30 days, with expiry enforced on access.
The Context source selector defaults to Synthetic. My account shows current access,
sign-in/Settings links, an access refresh action and authorized Behavior checkboxes.
Run comparison requires enabled briefing access. Calendar controls reflect separate
disclosure. Account mode disables save/export and clears private content and Behavior
selections on leaving the tab. Delivered comparisons remain inspectable after the
captured context's deadline, with an expired-snapshot notice. Window blur preserves
results; focus rechecks access and preserves unchanged results. Mode, account and
consent changes or failed access checks discard private output.
The shared bubble renders suggestions and trusted source links within its existing
scroll boundary. It exposes no Apply action or additional Settings controls.
The workbench header now precedes two closed native details sections: a searchable
contract glossary and preset/reference documents. Glossary entries expose stable
IDs, owning symbols and related terms. Document previews wrap and scroll within
the bench, with copyable file paths, VS Code links, downloads and original sources.
These controls use the existing neutral bench styles and never generate a comparison.


Tickets 182–183 add Days beside Compare and Saved reviews. Native date/time controls
open a no-model evidence grid. One selected day shows source limits; A/B retain
complete text below. Sequence planning displays the provider-call count before
generation. Diagnostic lane previews remain labeled and separate. Cancel preserves
completed results; storage failures show Not saved. Mobile stacks A above B.

## Recipe-scoped briefing workbench

Daily Brief is the only recipe. The development bench shows recipe/policy versions
and native checkboxes/selects for completion inputs and duration preference/fallback.
Finish timestamps remain disabled and visibly unavailable. Glossary links explain
source semantics. Configuration panels stack on narrow screens. Existing neutral
bench styles, product tokens and horse bubble geometry remain unchanged. The bubble
omits the generic partial-context caption; diagnostics live in the private inspector.

### Travel controls and occupancy (Tickets 162–165)

BehaviorForm adds an optional line-led location field. Travel Settings reuses the
divider-led SettingsPanel with native mode/navigation selects, optional base and
separate routing disclosure and foreground location permission. Calendar details
retain source location text and structured map links. Temporary travel spans use
the existing 1px magenta Timeline axis and overlap borders; markers remain at
scheduled starts. Known gaps remain unfilled. Unknown returns cannot claim full
availability. Live provider and installed native acceptance remain separate.

## Historical completion timing control

The briefing workbench reuses its native checkbox/Definition-link row for
Historical completion times. The control replaces the disabled timestamp row;
geometry, spacing, typography, square borders and responsive columns are unchanged.
