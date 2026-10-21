# Occurrence Note feedback

## Scope and cause

Visual-only correction. `OccurrenceNoteForm` forced foreground/accent colors,
bypassing the existing `--timeline-detail-strong` and `--timeline-detail-error`
roles. Its inline message also added a divider prohibited by DESIGN.md.
`OccurrenceRow` supplied bottom padding only from the small breakpoint.

The form now consumes those roles with foreground/accent fallbacks for standalone
usage. Feedback retains its status/alert semantics and aligns with Save note.
Expanded rows use matching side/bottom insets: 12px mobile, 16px desktop.
No data, actions, resolver behavior, exports, dependencies, or configuration changed.

## Platform coverage

- Web: shared `components/timeline/OccurrenceNoteForm.tsx` and `OccurrenceRow.tsx`;
  BehaviorList's standalone form retains the foreground/accent fallbacks.
- Desktop: consumes both shared components and imports `app/globals.css` through
  `apps/desktop/src/timeline.css`. No native-specific change.
- Marketing: not applicable; no interactive Occurrence Note form.
- Future mobile: not applicable; native mobile implementation remains deferred.
  Responsive web is covered below.

Existing catalog entries `composite.occurrence-note-form` and
`composite.occurrence-row` still own these components. Existing Note interaction
intents and side effects remain unchanged; no registry changes were needed.

## Verification

Browser QA used the existing synthetic design-system previews at
`http://127.0.0.1:4321`, at 390×844 and 1440×1000.

- Before: Completed feedback rendered dark, with 0px mobile bottom padding.
- After: Completed and Not Completed feedback use the white foreground token.
  Needs decision and standalone feedback remain dark.
- Expanded bottom padding measures 12px mobile and 16px desktop.
  Feedback has no top border. Rows have no horizontal overflow.
- Existing synthetic Save note actions rendered status feedback successfully.
- `/timeline` rendered the authenticated shell and Timeline. Account mutation
  checks used synthetic previews only.
- Existing success/conflict Note tests passed. Native iPhone and installed
  desktop runtime checks were not performed.

Checks: agents, interactions, resolvers, design-system, lint, web/desktop
TypeScript, tests, and web/desktop builds passed. The repository suite passed 2,538
tests initially; nine socket-blocked tests passed on authorized rerun of their
two files (27 tests). Total: 2,547 passing tests, 29 opt-in skips.
Lint and tests excluded `.claude/**` because the default commands also scanned
an unrelated nested worktree with another React copy. No check configuration changed.
