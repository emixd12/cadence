# Advisor avatar: base image, animation and tests

Date: November 21, 2026. Status: plan, owner review. Tickets 343–348
(`docs/TICKETS.md`). Decision record: `docs/DECISIONS.md`, 2026-11-21, "Advisor avatar
track".

This plan is not a source-of-truth document. The catalog is:
`packages/core/src/advisor-avatar/catalog.json`.

## Where things stand

- **The animations were built for the old drawing.** `app/design-system/HorseAvatarTrial.tsx`
  and `horse-avatar-trial.module.css` animate `public/brand/cadence-horse-avatar.png`, a
  side profile. Every mask, pivot and eyelid path is a fixed coordinate in that 400 × 400
  image. The trial never left the `/design-system` bench.
- **The product shows a different drawing.** Placement K (`DESIGN.md`, "Advisor
  placement") draws a three-quarter view from `public/brand/cadence-advisor-window-draft.webp`
  (512 × 512). It does not move. None of the trial's coordinates fit it.
- **The small avatar uses a second file.** Up to 72px, `AdvisorHorse` loads
  `cadence-advisor-window-draft-small.webp` (160 × 160). It is the same drawing with much
  heavier lines, made so it stays readable at 40px and 48px. At those sizes it reads as a
  different, darker horse than the 120px one in the panel.
- **The trial's states predate the advisor.** It has four states (idle, preparing, advice
  waiting, open) written for a single Daily Brief bubble. The advisor now also gives tips,
  asks schedule questions, runs two-week trials, applies moves and answers in Chat.
- **Two trial details conflict with placement K.** The trial shows a terracotta badge and
  orbiting dots. `DESIGN.md` says the advisor has no dot, so nothing is confused with the
  banner's dots.
- **Cadence records no interface usage.** There is no experiment or event code today.

## The three steps

The owner set the order on November 21, 2026. Each step ends with the owner's approval.

### Step 1: the base image (Ticket 343)

Goal: one approved master drawing. Every size on every surface is made from it.

- **Baseline:** the large drawing, `cadence-advisor-window-draft.webp`.
- **Review rounds.** Each round produces a comparison sheet at the real sizes (40, 48 and
  120 CSS pixels, at 1× and 2× screens) on the product background. The owner answers with
  notes or approval.
- **Round 1, November 21:** line weight only. Four candidates made from the large file:
  as is, ink ×1.5, ink ×2.0, ink ×1.6 with thicker lines; beside the current small file.
  Finding: the large drawing's fine hatching fades at 40px and 48px when it is only
  scaled. Some added weight is needed at small sizes. The question is how much.
  Sheet: `docs/design-exploration/advisor-avatar/round-1-line-weight.png`. Recommendation:
  C at 40px and 48px, A at 120px. Owner's answer (November 21): between A and B, "elegant
  and faint" with enough definition for the slightly realistic style.
- **Round 2, November 21:** style. The owner made the old side-profile drawing
  (`public/brand/cadence-horse-avatar.png`) the primary style reference and the other horse
  drawings (Timeline banner, login page, marketing hero) secondary, so every horse reads
  as one style. Three candidates from the image model (`gpt-image-2`, one request, the
  five drawings as references): the placement K pose redrawn with the profile's clean
  contours, open white areas and sparse hatching. Sheet:
  `docs/design-exploration/advisor-avatar/round-2-style.png`, with ink ×1.25 at 40px and
  48px. Candidates: `round-2-candidate-1.webp` to `-3.webp` beside it. Finding: with less
  hatching the candidates are fainter than the round 1 drawing at the same ink setting,
  and the eye and nostril carry most of the 40px reading. Owner's answer (November 22):
  candidate 1; try `gpt-image-2.6` at its highest setting; code may make the master.
- **Round 3, November 22:** the final master. Two versions of candidate 1, on
  `docs/design-exploration/advisor-avatar/round-3-master.png`:
  - `round-3-sunburst-max.webp`: one `gpt-image-2.6-sunburst` edit at quality `max`,
    2048 × 2048, transparent outside the horse. Sunburst is the 2.6 model OpenAI
    recommends for detail and edit accuracy; Flare is the faster one. The lines are
    crisper. The model also firmed the contour and added some hatching, so it is a little
    less faint than the pick. The horse's body is opaque white, not see-through.
  - `round-3-vector-3tone.svg`: a code trace of that render (`vtracer`) into three tone
    layers. A one-tone trace turned every faint stroke solid and lost the style, so three
    tones is the least that keeps it. It is 2.1 MB and its strokes are slightly blunter
    than the render's, but it scales to any size and each tone can be reweighted in code.
  Owner's answer (November 22): the vector trace is the master. Adapt the animations
  now; the updated avatar goes to production quickly.

## What shipped on November 22, 2026 (Tickets 343 to 346)

- **Master:** `assets/advisor-avatar/master.svg` (three tone layers). `npm run avatar:build`
  (`scripts/build-advisor-avatar.mjs`) makes `public/brand/advisor/advisor-256.webp` for
  sizes up to 72px and `advisor-768.webp` above. Each file sets its own tone strengths:
  the small one is ×1.25 (between round 1's A and B), the large one turns the lightest
  tone down. `npm run avatar:check` fails when the files are stale. The draft files are gone.
- **Anchors:** the catalog's `art.anchors` holds the window, both eyes, the mane and its
  root, and both ears, in the master's coordinates.
- **Resolver:** `packages/core/src/resolvers/advisor-avatar.resolver.ts`, with
  `tests/advisor-avatar.resolver.test.ts`. `map:check` fails when an active catalog item
  is not in the resolver.
- **Component:** `components/advisor/AdvisorAvatar.tsx` and `advisor-avatar.module.css`,
  shared by web and the Mac. It uses the trial's technique on the new drawing: the still
  drawing, a masked mane that sways from its root (and ripples above 72px), masked ears,
  and eyelids over both eyes. The preparing arc stays. No dot or badge.
- **Wiring:** the Timeline avatar and the panel avatar read the state and gesture from
  `AdvisorProvider`. The Chat page shows a 48px avatar beside its links; it rests, and
  shows `state.replying` while a reply arrives.
- **Bench:** `/design-system?preview=advisor-avatar`.
- **No flag.** The plan called for `CADENCE_ADVISOR_AVATAR_MOTION`, off in production
  until acceptance. The owner asked for a quick production deployment instead, so the
  motion is on when this merges. Reverting the pull request turns it off.
- **Not done:**
  - A brief move in flight does not set `state.working`, and a brief move's result plays
    no gesture: the Daily Brief launcher owns that state and does not publish it yet.
  - The old `horse-avatar` trial bench and `public/brand/cadence-horse-avatar.png` stay;
    the PNG is the style reference.
  - The Mac gets all of this in its next release. Not checked on an installed Mac.
  - Browsers stop CSS animation in hidden tabs; no extra pause code was added.
- **How a master gets made.** Two routes, both allowed by the owner:
  - An image model, for changes to the drawing itself (pose, line style, a higher
    resolution master, a transparent background). The owner allowed the cloud session's
    OpenAI key for this on November 21, 2026.
  - Code, for everything derived from the master: sizes, line weight, crops and layers.
    Hand-written vector paths do not suit this style: it is hundreds of irregular strokes
    of varying weight, and paths written as numbers come out as a clean icon beside the
    other horse drawings. Tracing an approved drawing into vector paths is code that does
    fit, and is an option for the master if sharper small sizes are wanted.
- **What approval produces.**
  - A master of at least 1024 × 1024 with a transparent background, stored at
    `public/brand/advisor/`.
  - `scripts/build-advisor-avatar.mjs`, which makes each size from the master with the
    approved line weight. The files are committed. The catalog's `art` block lists them.
  - Anchor points in the catalog (`art.anchors`): eye outlines, ear bases, mane root, jaw
    and neck line, in the master's coordinates. Step 2 animates from these, so a later
    drawing change means new anchors, not new animation code.
  - `AdvisorHorse` reads its files from the catalog. The `-draft` files are removed.

### Step 2: the animation set on the new drawing (Tickets 344 and 345)

Goal: the trial's motion, rebuilt on the approved drawing and scoped to what the advisor
does today.

- **One catalog.** `packages/core/src/advisor-avatar/catalog.json` names every state and
  gesture, what triggers it, what it looks like moving and what it looks like still.
- **States** last as long as their condition. One shows at a time. The lowest `priority`
  number wins.

  | State | When | Adapted from the trial |
  | --- | --- | --- |
  | `state.working` | An answer was sent and its result has not come back | new |
  | `state.preparing` | The Daily Brief is loading or refreshing | Preparing |
  | `state.attending` | The panel is open | Open |
  | `state.trouble` | The brief shows a notice instead of advice | new |
  | `state.waiting` | Something waits: brief, question, check-in or tip | Advice waiting |
  | `state.resting` | Nothing waits | Idle |
  | `state.replying` | Chat is writing a reply | new; the advisor appears on the Chat page (owner, November 21) |

- **Gestures** play once and return to the state.

  | Gesture | When | Adapted from the trial |
  | --- | --- | --- |
  | `gesture.arrive` | First Timeline open of the local day | Entrance and wake |
  | `gesture.notice` | Something new arrives while the Timeline is open | Advice gust and double blink, once |
  | `gesture.acknowledge` | An answer was applied | new |
  | `gesture.refused` | An answer returned "Not changed." | new |

- **A pure resolver** (Ticket 344) turns what the advisor already knows (`hasNew`,
  `panelOpen`, `brief.kind`, pending answers) into one state, and turns changes into
  gestures. It lives in `packages/core/src/resolvers/advisor-avatar.resolver.ts`, is
  tested, and is the only place that decides. Components never choose a state.
- **The rig** (Ticket 345) is one shared component for web and the Mac. It keeps the
  trial's technique: the still drawing, masked layers for the mane and ears that move, and
  an eyelid drawn over the eye. Layers and pivots come from the catalog's anchors.
- **Rules the rig keeps.**
  - `prefers-reduced-motion` shows the still drawing in every state. State stays readable
    from the label and the text line, never from motion alone.
  - No dot, badge, ring or count on the avatar. The label carries "1 new".
  - Motion never moves layout and never covers the date or a row.
  - Looping motion stops when the tab or window is hidden.
  - At 40px and 48px only the motions that read at that size run (blink, mane, one
    gesture). The 120px panel avatar may show more.
- **Bench.** `/design-system?preview=advisor-avatar` shows every state and gesture at
  every size, with the still version beside it. It replaces the `horse-avatar` trial.
- **Shipping.** The animated avatar lands behind `CADENCE_ADVISOR_AVATAR_MOTION`, off in
  production until the owner accepts it on web and on the installed Mac (Ticket 346).

### Step 3: tests on real accounts (Tickets 347 and 348)

Goal: compare animation variants on real use and keep a record of each change.

- **Experiments are catalog entries.** Each names its subject (one state or gesture), its
  variants, the share of accounts in each, its dates and its measures. One variant is
  always `still`.
- **Assignment** is a pure function of the account id and the experiment id (a hash), so
  web and the Mac agree and nothing is stored to assign. The owner can force a variant on
  the bench.
- **What is recorded** (one hosted, user-owned table, `advisor_avatar_events`, with RLS):
  the local date, the surface (web or Mac), the experiment and variant, the state or
  gesture id, and what followed: panel opened, question answered, tip reacted to, or
  nothing within the session. Times are bucketed. No tip text, Behavior names, positions
  or device details.
- **Measures.** Primary: the share of `state.waiting` days on which the panel was opened.
  Secondary: answers given, by kind. Guardrails: "Not now" and "Don't suggest this again"
  rates, and panel closes within 3 seconds.
- **Who is left out.** Accounts with AI features off (they have no advisor), people who
  prefer reduced motion (they always see still), the Mac without an account, and the
  owner's and test accounts.
- **Readout** (Ticket 348) is a command, `npm run avatar:report`, run by the owner or an
  agent. It is not an admin dashboard. A variant that wins replaces the catalog entry and
  leaves a `previous` record, as notices do.
- **Limit to state plainly.** Before launch there are too few accounts for a test to
  separate variants. Until then the events describe use and the bench comparison decides.
  The assignment and recording are built so tests work once accounts exist.

## Repo navigation

| Question | Where |
| --- | --- |
| What can the avatar show, and why? | `packages/core/src/advisor-avatar/catalog.json` |
| How does it link to the rest of the product? | `npm run map -- avatar:` lists every state and gesture; `npm run map -- avatar:state.waiting` shows one |
| Which drawing files are current? | The catalog's `art` block |
| Where is it drawn? | `AdvisorHorse` in `components/advisor/AdvisorParts.tsx` |
| What did the trial do? | `app/design-system/HorseAvatarTrial.tsx` (kept until Ticket 345 replaces it) |
| What is decided and open? | `docs/DECISIONS.md`, 2026-11-21; this file, "Open owner decisions" |

The product map gains one item kind, `avatar` (`docs/PRODUCT_MAP_GUIDE.md`). Each state
and gesture belongs to the `advisor-tips` feature (the advisor on the Timeline) and links
to the interactions it follows. The avatar adds no interaction of its own, so it is not a
separate feature. `npm run map:check` validates the catalog.

## Owner decisions

Answered November 21, 2026:

- **Image model spend:** allowed on the cloud session's OpenAI key.
- **The preparing arc:** kept for now, on top of the eye and mane motion.
- **Chat:** the advisor appears on the Chat page. Its placement there is designed in
  Ticket 345 and wired in Ticket 346.
- **Recording interface use (step 3):** set aside. Tickets 347 and 348 are deferred until
  the owner returns to them; nothing else waits on them. The `AGENTS.md` rule against
  tracking scripts is unchanged.

Open: none for Tickets 343 to 346. Tickets 347 and 348 stay deferred.
