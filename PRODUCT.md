# Product

## Register

product

## Users

One independent account holder who wants a private, low-friction way to track recurring behaviors across ordinary days. They are usually checking the app quickly: deciding what was completed, resolving prior-day items, adding a note when context matters, or reviewing a short history before exporting it.

The public product may serve many independent accounts, but each account remains single-player. The user needs the app to feel trustworthy and calm. Unresolved items should remain undecided until the user acts, and prior-day unresolved occurrences should be brought forward without judgment.

## Product Purpose

Cadence is a public, open-source personal behavior tracker for recurring life patterns. It lets the user create behaviors, generate scheduled occurrences, view them in a timeline, manually mark each occurrence as Completed or Not Completed, add notes, receive reminders, review basic analytics, and export their history.

Success means the user can open the Timeline, understand what needs attention, make a decision, and leave with confidence that the record reflects only explicit user input.

Cadence still exports the BehaviorLog Bundle standard, and export should stay practical. Since `docs/DECISIONS.md`, 2026-11-13 (D30), the standard supports the product story and is not the product's purpose.

The advisor (`docs/DECISIONS.md`, 2026-11-16, D32) helps the person keep to their plan. The Daily Brief plans today and can move an Unresolved Occurrence to another time today when the person says yes; the Behavior's schedule stays. The coach role gives short, counted advice and can propose a schedule change for the person to confirm. Chat lets the person ask about their record and make changes in plain words. The advisor plan wins over this file where they disagree.

Public positioning: Cadence is a behavioral remodeling assistant. `docs/NARRATIVE.md` holds the positioning, the public claims and the marketing register. This file governs the product itself and its in-app voice.

## Brand Personality

Sparse, calm, exact.

The product voice is matter-of-fact and quietly supportive. It should feel like a personal cockpit, not a productivity platform. Copy should name the state or action plainly, avoid motivational language, and never imply that an unresolved item has failed by default.

Voice: clear, warm and brief (owner direction, `docs/DECISIONS.md`, 2026-11-10: "prioritize clear and delightful language"). Warmth comes from plain, considerate wording, not from praise, exclamation or promotion. In practice:

- Short sentences and plain words. Say what happened and what to do next ("Google Calendar did not refresh. Try again."). No implementation terms such as "atomic snapshot", "provider responses", "runtime", "deployment" or "working copy".
- Active voice that names the actor: "Cadence checks the backup", "macOS kept fewer reminders".
- One name for one thing. "Connected sources" is the section for Google Calendar, Outlook Calendar, iCloud Calendar and Hevy, never "Connectors". Each Connect, Refresh and Disconnect action names its source in full ("Refresh Outlook Calendar").
- Places read as places: a timezone shows "New York", while the saved value stays `America/New_York`.
- Keep the domain terms exactly: Behavior, Occurrence, Completed, Not Completed, Unresolved, Needs decision.
- Still no motivational, celebratory or promotional copy in the product, and no mannered metaphors. Marketing surfaces use a separate register that allows promotional copy (`docs/NARRATIVE.md`, "Register").
- The horse character is called the "advisor" in the product. "Coach" is an internal name for its longer-term advice role; it does not appear in the UI. Cadence itself stays a "behavioral remodeling assistant" in public. Custom names for the advisor come later.
- The advisor speaks with counted facts from the person's own record and one plain action ("Reading got done 9 of 10 times before 9 am this month. Keep it there?"). No praise, no pep talk. Research claims come only from reviewed advice cards.
- Sentences that state what Cadence sends, stores or shares change only through the messaging track (`docs/MESSAGING_CHANGES.md`).

## Anti-references

No named visual anti-references are documented. The locked product anti-references are pattern-based:

- Dense productivity dashboards
- Gamified streaks, rewards, badges, or scorekeeping
- Social habit-tracking language
- Motivational or cheerleading copy, from Cadence or from the advisor
- Medical dose, supply, or refill tracking
- Quantified-self analytics sprawl
- Multi-user SaaS administration
- Calendar-sync or task-manager complexity
- Offline or PWA mutation flows in v1
- Public-product admin dashboards
- Audio speech features
- Advice without evidence: the advisor's research claims come only from reviewed advice cards, never from the model's general knowledge

## Design Principles

1. Timeline first: the Timeline is the primary workspace and should start with what needs attention now.
2. Manual truth: statuses change only through explicit user action or a linked completion source. The advisor proposes; a change it proposes applies only when the person says yes, and can be undone. Needs decision is a derived prompt, not a stored status.
3. Progressive detail: show scheduled time, behavior title, and action buttons first; reveal category, description, schedule details, and notes only when useful.
4. Quiet consistency: use familiar controls, sparse layouts, restrained color, and predictable states across Timeline, Behaviors, Analytics, Export, and Settings.
5. Small v1 surface: prefer direct workflows over settings depth, dashboards, modals, or speculative future features.
6. Portable by default: export and account-deletion paths should support the project's BehaviorLog portability posture.
7. Composable surfaces: web, marketing, desktop, and mobile should be treated as separate shells over shared product principles and core logic where useful.

## Accessibility & Inclusion

No project-specific accommodations are documented yet. Default to WCAG 2.2 AA expectations for product UI: readable contrast, visible focus states, keyboard-accessible controls, responsive mobile layouts, reduced-motion alternatives, and status indicators that do not rely on color alone.
