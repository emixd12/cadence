# Launch narrative

Status: accepted by the owner on November 13, 2026. Decision: `docs/DECISIONS.md`, 2026-11-13, D30.
Ticket 327.

This file is the one source for what Cadence says about itself in public. Every
public surface derives its copy from it: the marketing site, store and directory
listings, developer docs, the README, social posts and reviewer submissions.
Privacy, Terms and Trust state the limits of the same claims.

It does not change in-app copy. `PRODUCT.md` still governs the product voice.
It does not change what is built. A claim here is publishable only when its row
in "Claims" says the proof is live.

This repository is public, so this file is public. Pricing work and company
roadmap stay out of it.

## Positioning

Cadence is a **behavioral remodeling assistant**.

- **Behavioral remodeling** is the purpose: a person deliberately changes what
  they repeat.
- **Adherence** is the measure: the share of decided Occurrences marked
  Completed.
- **Assistant** is the role: Cadence arranges the day, keeps the record and
  reports on it. The person decides what to change.

Do not call Cadence a coach, a habit tracker, a task manager or a productivity
app. "Tracker" may describe one function, never the product.

The earlier positioning, "a record for changing what you repeat" with
BehaviorLog portability as the headline, is retired. Cadence still exports
BehaviorLog. The standard is now supporting evidence, not the product's purpose.

## Core sentence

Cadence puts your recurring behaviors and your calendar on one timeline, records
what you did, and makes that record available to the AI you already use.

## Three claims

1. **Plan the day on one screen.** Behaviors, calendar events and leave times
   appear together. The interface shows as much of the day as one view can carry
   and nothing that competes for attention.
2. **Record what happened with little effort.** Each Occurrence is Completed, Not
   Completed or Unresolved. Activity recorded in a connected service can complete
   a linked Behavior. Unresolved is never treated as failure.
3. **Give the record to your assistant and your agents.** Cadence writes a Daily
   Brief. Claude, ChatGPT and other MCP clients can read the record and, with the
   person's confirmation, change it. Exports remain complete.

The third claim replaces the earlier portability message. The record still
leaves Cadence whenever the person wants. The reason has changed: the record is
most useful when the tools the person already uses can read it.

## Register

Two registers exist. Do not mix them.

| Register | Where | Rule |
| --- | --- | --- |
| Product voice | In-app copy, user guide, notifications | `PRODUCT.md`, unchanged: clear, warm, brief, no promotion |
| Marketing voice | Marketing site, listings, social, press | Promotional copy is allowed. It is elegant, scientific and philosophically serious |

Marketing voice rules:

- **Describe mechanisms, and cite them.** Self-monitoring, cues, feedback and
  if-then planning have published evidence. Name the mechanism and the source.
- **Define every measure.** State how adherence is calculated wherever a number
  appears.
- **Promise no outcome.** Cadence measures adherence. It does not claim to raise
  it, form a habit in a fixed number of days or improve health.
- **State limits beside claims.** A claim about AI access names what is excluded.
- **Name the reader by situation, not status.** "More recurring commitments than
  attention to track them", not "high performers".
- **Keep the domain terms exact:** Behavior, Occurrence, Completed, Not
  Completed, Unresolved, Needs decision, Adherence.

Words to avoid: hyper-optimize, maximize, high-performing, peak, unlock,
supercharge, hack, crush, streak, coach, effortless, revolutionary, AI-powered.

Words that fit: adherence, remodeling, attention, cognitive load, deliberate,
evidence, record, practice, cadence, review.

Illustrations of the register, not approved copy:

- "Most of a day repeats. Cadence makes the repeating part visible, then
  measurable."
- "Attention is limited. Cadence carries the schedule so attention can go to the
  work."
- "A record your assistant can read is a record you can reason about."

`Behavioral Adherence Application Design Research.md` is the starting evidence
base. Its citation markers are broken. Find and read each source again before
citing it in public.

## AI and agents

Lead with MCP and the plugins. The person connects Claude, ChatGPT or another
MCP client, and that client works with the Cadence record on the person's own AI
plan.

- Say "assistant" for Cadence and "agent" or "AI client" for the outside tool.
- Do not imply an in-app conversation. None exists.
- Do not claim "use your ChatGPT plan" inside Cadence. That path is hidden
  (`docs/DECISIONS.md`, 2026-11-12).
- Always state: changes need the person's confirmation; Calendar events, travel
  data and Daily Brief content are not shared through MCP.

## Price

Public statement: "Cadence is free during the beta. It will not stay free."

Name no price, tier or usage limit in public until a billing decision is
recorded. This replaces "Cadence is currently available without charge."

## Platforms

The narrative is written for four surfaces: web, Mac, iPhone and AI clients. An
Android app is possible later.

- Web and the Mac download exist today.
- An iPhone app and a Mac App Store listing are intended near launch. Neither has
  tickets. Copy may be drafted for them now. No public claim, badge or store page
  goes out before the app ships.
- Write every claim so it reads correctly on a phone-sized listing as well as on
  the site.

## Outside launch copy

- Other company products and Cadence's place among them.
- Health, treatment and medication claims. Adherence stays general. Ticket 246
  decides the wording of "not a medical dosing app".
- "Use your ChatGPT plan".
- Any price.

## Audience

Not decided. Desk research is in `docs/research/2026-11-13-launch-audience-research.md`
(Ticket 328). It recommends agent-using professionals for the beta and self-improvement
practitioners after the iPhone app. The owner has not decided, and no interviews have run.

Working hypothesis to test: people who already pay for Claude or ChatGPT and
have more recurring commitments than they can track unaided. Candidate segments
from the owner's notes: executives and self-improvement communities.

## Surface roles

| Surface | Reader | Job | Leads with |
| --- | --- | --- | --- |
| Homepage | Prospective user | Persuade | Claims 1 and 2, then 3 |
| About | Curious reader | Explain the idea | Positioning and evidence |
| App Store listings (planned) | Someone browsing a store | Describe within store limits | Core sentence, claim 1 |
| Claude and ChatGPT directories, MCP registries | Someone browsing a directory | Describe within listing limits | Claim 3 |
| `/developers` | Builder | Enable | The MCP contract |
| README | Contributor, self-hoster | Orient | Open source and architecture |
| Privacy, Terms, Trust | Reviewer, cautious user | Disclose | The limits of each claim |
| Social | Stranger | Attract | One claim per post |
| In-app copy, user guide | User | Operate | Product voice, unchanged |

## Claims

A public claim needs a row here. "State" comes from repository records on
November 13, 2026. Nobody checked production for this table. Verify each row
before it is published.

| ID | Claim | Proof | State and limits |
| --- | --- | --- | --- |
| C1 | Behaviors and calendar events on one timeline | Read-only Google, Outlook and iCloud Calendar | Google live. Outlook passed on production November 11. iCloud acceptance is open (PR #250) |
| C2 | Leave times and leave reminders | Tickets 260–283 | Live on web; Mac in 0.1.9. Production setting of the reminder job not checked. Weather margin off |
| C3 | Works offline on the Mac | Cadence for Mac 0.1.10 | Published November 12. macOS 14 not tested |
| C4 | Each Occurrence takes an explicit decision; Unresolved is never failure | Status rules | Live |
| C5 | A recorded workout completes a linked Behavior | Connector completion (D28), Hevy | On in production since November 13. Needs Hevy Pro; opt-in per Behavior |
| C6 | Adherence over 7, 30 or 90 days | Behaviors review | Live |
| C7 | A Daily Brief | Tickets 146–148 | Live. Sends disclosed context to OpenAI |
| C8 | Claude, ChatGPT and other MCP clients read and change the record | MCP server, 16 tools | Live since October 29. Writes need confirmation. No deletes. Calendar, travel and Daily Brief content excluded |
| C9 | Cadence plugins for Claude and ChatGPT | `integrations/` | Packages built. Directory approval pending. Until approved, say "connect by URL" |
| C10 | Complete exports in five formats | Export | Live |
| C11 | Open source | MIT license | Live. Brand assets excluded |
| C12 | Free during the beta | No billing | True today |
| C13 | iPhone app | None | Not built. No claim |
| C14 | Mac App Store | None | Not evaluated. No claim |

## Next work

In order. Each needs its own ticket and owner go-ahead.

1. Persona and audience research.
2. Marketing site rewrite from this file, with the other public surfaces
   (Ticket 246 already owns the pre-launch pass over open messaging entries).
3. Store and directory listing copy.
4. Visual identity for the rollout.
5. Social content system and inbound channels.
