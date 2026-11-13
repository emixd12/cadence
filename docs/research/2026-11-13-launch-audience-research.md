# Launch audience research

Date: November 13, 2026. Ticket 328. Status: desk research complete; recommendation
awaits the owner's decision; no interviews run.

This report answers the "Audience" question left open in `docs/NARRATIVE.md`. It tests
three candidates: the working hypothesis there (people who pay for Claude or ChatGPT and
have more recurring commitments than they can track unaided) and the owner's two
candidates (executives, and self-improvement communities).

## Recommendation

Launch the beta to **professionals who already use AI agents**, then widen in two steps.

1. **Beta, now (web, Mac, MCP):** agent-using professionals. Two neighbours share the
   same copy with one changed example each: time-pressed parents in professional jobs,
   and people who train to a plan in Hevy.
2. **After the iPhone app:** self-improvement practitioners. They are the largest group,
   they live on phones, and the incumbents there are strong.
3. **Not as a separate campaign:** executives. The evidence found does not support
   reaching them directly. Senior people in technology and finance are already inside
   the first group.

The evidence for step 1 is one large survey and is strong. The evidence against a direct
executive campaign is thin and should be read as "not supported", not "disproved".

## Method and limits

- Desk research on one day. Sources: one nationally representative survey read in full,
  ten competitor home pages read for their own positioning, one distribution guide read in
  full, vendor statements of user counts, and search-result excerpts where marked.
- No user interviews, no surveys of Cadence users, no paid data.
- Competitor quotes were extracted from each page by a query tool and not checked against
  a second rendering. Prices were not captured.
- Market-size figures from report vendors disagree by a factor of seven and are not used.
- Every figure below names its source. "My arithmetic" marks a number derived here.

## Findings

### 1. The people who pay for AI are busy professionals, and they already use agents

Source: Menlo Ventures, *2026: The State of Consumer AI*, survey of 5,067 U.S. adults with
Morning Consult, July 2026. Menlo is an investor in Anthropic and other companies it names;
the survey is self-reported.

- 64% of U.S. adults use AI. 55% of AI users pay for at least one AI product, "equivalent
  to roughly 90 million Americans".
- 41% of AI users have tried an AI agent and 24% use one regularly. 92% of agent users pay
  for AI. My arithmetic: 24% of about 164 million AI users is about 39 million regular
  agent users in the U.S.
- Agent users have given agents access to calendars (27%) and health apps (23%).
- The typical user paying $100 or more a month "is a Millennial parent with a post-grad
  degree working in technology or financial services. They tend to have more money than
  time."
- Claude users "are more likely to be tech or finance professionals with an advanced
  degree". 82% of them pay for AI and 48% run agents.
- Parents: 84% use AI and 40% use it daily, against 56% and 25% for non-parents and all
  adults. The report says power users are distinguished by "pressure on their time".
- In 2025, 18% of consumers used AI to manage to-do lists.

Reading: the group that will connect an MCP server to an assistant exists at scale, pays
for software, and is defined by lack of time. That matches the narrative's rule to name
the reader by situation.

### 2. Trust decides whether a specialised product gets used

Same source.

- AI users rank accuracy (45%), trustworthiness (40%) and security and privacy (36%) above
  ease of use (32%).
- Among people who use only general assistants, 27% hold back from specialised tools over
  "data privacy concerns with niche or lesser-known tools" and 21% do not know which tool
  to trust. Only 11% are unaware of them.
- "Consumers adopt what's useful, and they keep what they trust."

Reading: Cadence's open source, Trust page, confirmed writes and stated exclusions are
selling points for this audience, not footnotes. A scientific register supports the same
need.

### 3. "Works with your AI" is no longer unique

- Habitify documents an official MCP server that marks habits completed, skipped or failed
  and logs values (`api-docs.habitify.me/mcp`). A competitor's comparison page dates it to
  March 2026; not verified.
- Divitica positions as "Tasks · Habits · Journal · Works in ChatGPT & Claude" and says its
  MCP server lets Claude, ChatGPT and other tools "show your plan, add tasks, log habits
  and save journal entries".
- Todoist and TickTick are described as having official MCP servers (search excerpts; not
  verified).

Reading: claim 3 in the narrative gets Cadence into the comparison. It does not win it.
What the Cadence record contains is the difference: calendar context, leave times,
explicit decisions with Unresolved kept apart, adherence with a stated definition, and
completions from recorded activity. No reviewed competitor states that combination.
Limit: ten products reviewed.

### 4. How adjacent products position themselves

Quotes are from each product's home page on November 13, 2026.

| Product | Says it is | Names as its user | Register |
| --- | --- | --- | --- |
| Sunsama | "The only task manager, calendar, and daily planner for modern professionals" | Modern professionals avoiding burnout | Calm, work-centred |
| Motion | "The AI Powered SuperApp for Work" | "Over 1 million top performers and teams" | Sensational, work-centred |
| Reclaim | "#1 AI calendar for work"; "AI Habits: AI-powered recurring events that flex and find time" | Teams and enterprise leaders | Efficiency, enterprise |
| Structured | "the day planner app that everyone is using"; 15M+ downloads, 500K+ pro users | Everyone | Friendly, mobile |
| Tiimo | "A visual AI planner built for real life"; "built by and for neurodivergent people" | People who struggle with focus and follow-through; "over half a million" users | Supportive |
| Atoms | "The official Atomic Habits app"; "the only app built on scientifically-backed laws of habit change" | Readers of the book | Popular science |
| Fabulous | "Backed by behavioral science ... an accountability partner in your pocket"; "Born at Duke University"; 37M people | Self-care audience | Popular science, coaching |
| Habitify | "Build Better Habits, Build a Better Life"; 2 to 3 million users (the page gives both) | General | Motivational |
| Divitica | Tasks, habits and journal inside ChatGPT and Claude | AI assistant users | Calm, new |
| Hevy | "Loved by 18+ million athletes" | Gym-goers | Community |

Observations:

- "Science" is already claimed, in a popular register, by Atoms and Fabulous. A claim of
  being scientific will not stand out. Showing the science will: stated definitions, cited
  mechanisms, no outcome promises. None of the ten does that on its home page.
- "Top performers" is Motion's phrase. The owner's instinct to avoid that register also
  avoids sounding like the loudest competitor.
- Planning products speak about work. Habit products speak about self-care. Cadence covers
  the recurring part of a whole day, which neither group claims.
- Nobody reviewed leads with adherence as a measured quantity.

### 5. The owner's candidates

**Self-improvement communities.** Large and real: Fabulous claims 37 million people,
Structured 15 million downloads, Habitify 2 to 3 million users. The category is sold
through app stores, by streaks and motivation, to phone users. Cadence has no iPhone app
yet and rejects streaks. Entering now means meeting the incumbents on their channel
without the product for it. After the iPhone app, the "no streaks, Unresolved is never
failure" position is a clear alternative for people the streak model has failed.

**Executives.** The material found for executives is vendor content about inbox triage,
briefings and meeting preparation, sold with enterprise security claims, and a survey of
executive assistants (206 respondents, excerpt only) reporting that 94% use AI. That
suggests an executive's schedule is often run by someone else and that the buying
criteria are corporate. No source found describes executives choosing a personal
behavior tool. The senior technology and finance professionals in finding 1 are reachable
without a separate executive campaign.

## Segments

| Segment | Evidence | Fit with live claims | Reach now | Verdict |
| --- | --- | --- | --- | --- |
| Agent-using professionals | Strong (finding 1) | C8, C1, C7 | MCP and AI directories, AI communities | Beta, primary |
| Time-pressed parents in professional jobs | Strong (finding 1) | C1, C2, C4 | Same channels as above; overlaps | Beta, same copy |
| Plan-based trainers (Hevy) | Size from vendor only; Hevy Pro share unknown | C5 | Hevy community; fitness forums | Beta, small test |
| Self-improvement practitioners | Size strong; channel is mobile | C4, C6 | App stores, after iPhone | Second wave |
| Protocol followers and self-trackers | r/Biohackers 923K, r/QuantifiedSelf 29K (Hive Index, May 2026) | C4, C6, C10 | Forums | Hold: health claims are outside launch copy (D30) |
| People who struggle with follow-through | Tiimo reports 500K+ users | C4 | Specialist incumbent | Note only; health-adjacent |
| Executives | Weak (finding 5) | None distinctive | Costly | No separate campaign |

Claim IDs refer to the "Claims" table in `docs/NARRATIVE.md`.

## Personas

These are hypotheses for interviews, not descriptions of real users.

### A. The agent-equipped professional (primary)

- **Situation:** works in technology or finance, often with a graduate degree. Pays for
  Claude or ChatGPT, sometimes both. Has given an agent access to a calendar. Has more
  money than time.
- **Today:** a calendar, a task manager with an MCP server, and recurring commitments held
  in memory or in a note.
- **Lead with:** claim 3, then claim 1. Show one request to an assistant and the confirmed
  change in Cadence.
- **Needs to see:** what the assistant can and cannot read, that writes need confirmation,
  the source code, the Trust page.
- **Would disprove it:** interviewees do not connect personal tools to their assistant, or
  already do this in Todoist or Habitify and see no gap.

### B. The time-pressed parent in a professional job (same campaign)

- **Situation:** the same person as A with a household to run. Uses AI daily for logistics.
- **Lead with:** claim 1. One screen with the day's commitments and when to leave.
- **Needs to see:** that it works across the family's calendars the person can read, and
  that reminders reach the phone.
- **Would disprove it:** the need is shared planning with a partner. Cadence is
  single-player by design.

### C. The plan-based trainer (small test)

- **Situation:** follows a training plan and logs every session in Hevy Pro.
- **Lead with:** claim 2. Log the workout once; the linked Behavior completes.
- **Would disprove it:** the Hevy Pro share is too small, or trainers do not track anything
  outside the gym.

### D. The practitioner the streak failed (second wave, after iPhone)

- **Situation:** has tried two or more habit apps and left when a streak broke.
- **Lead with:** claim 2 and the Unresolved rule, then adherence over 7, 30 or 90 days.
- **Would disprove it:** this group wants motivation, not measurement.

## Channels

### AI directories, in order

From Left Hook, "You Built a Hosted MCP Server. Where Can You Actually List It?",
October 15, 2026, read in full. That guide's facts were not checked against each
directory.

1. Official MCP Registry: free, no review; other catalogues import from it.
2. Glama (claim by domain), then GitHub's MCP registry (manual onboarding; needs a public
   repository and licence, which Cadence has).
3. Smithery and Docker MCP Catalog.
4. `awesome-remote-mcp-servers` (needs a Glama badge and open sign-up).
5. Claude Connectors Directory: needs OAuth, tool titles and hints, a privacy policy and a
   reviewer test account.
6. ChatGPT Plugin Directory: needs publisher verification and public website, support,
   privacy and terms pages. The guide says custom GPTs retire on December 11, 2026.
7. Later: Raycast's registry extension, Meta's Muse (U.S. and Canada), Perplexity by email.

Items 5 and 6 are provider submissions. Open `docs/MESSAGING_CHANGES.md` entries gate them.

### Launch boards and software directories

From two launch-directory roundups and one curated list (search excerpts, not read in
full). Each board's rules and fees need checking before use.

- Beta: BetaList (pre-launch sign-ups), Show HN (the open-source and MCP angle).
- Public launch: Product Hunt, Uneed, Peerlist Launchpad.
- Standing listings: AlternativeTo (as an alternative to Habitify, Sunsama and Structured),
  SaaSHub, Productivity Directory, MacNative for the Mac app.
- AI tool directories such as There's An AI For That are paid and fit claim 3 only.

### Communities

Sizes are given where a source states them. Posting rules were not read. The working rule
is to take part as a member, not to advertise.

- AI clients: r/ClaudeAI, r/ChatGPTPro, r/mcp; r/claudecode had 33,147 active users in the
  month to November 11, 2026 (Syften).
- Routines: r/productivity, r/getdisciplined, r/selfimprovement (sizes not confirmed).
- Training: the Hevy community.
- Held for later: r/Biohackers (923K), r/QuantifiedSelf (29K).

### Stores

The App Store and Mac App Store pages wait for shipped apps (D30.5).

## What this changes in the narrative

- Keep the core sentence and the three claims.
- Reader line for marketing copy: people with more commitments than time. "More money than
  time" is Menlo's phrase and should not be copied.
- Put trust evidence beside claim 3 wherever it appears.
- Do not present AI access as unique. Present what the record contains.
- "Scientific" must be shown through definitions and citations. Two competitors already
  assert it.

## Not researched

- Newsletters, podcasts, YouTube and LinkedIn creators, X lists and press.
- Lists of named people. None is compiled here: this repository is public.
- Prices and conversion rates of competitors.
- Whether any competitor combines calendar context with adherence.
- Markets outside the United States.

## Validation plan

1. Ten interviews: four for persona A, two each for B, C and D. Recruit from the
   communities above and from the plan in `docs/UX_TESTING_PLAN.md`.
2. Ask what they connect to their assistant today, what recurring commitments they track
   and where, and what they would need to see before connecting Cadence.
3. Publish to the official MCP Registry and Glama first and read which listing wording
   draws connections.
4. Revisit this report after ten interviews or 30 days of beta, whichever comes first.

## Decisions for the owner

1. Accept agent-using professionals as the beta audience, with parents and Hevy trainers as
   variants.
2. Accept self-improvement practitioners as the second wave, after the iPhone app.
3. Drop a separate executive campaign.
4. Approve the interviews, and say who conducts them.

## Sources

All accessed November 13, 2026.

| Source | Used for | Reliability |
| --- | --- | --- |
| Menlo Ventures, *2026: The State of Consumer AI*, `menlovc.com/perspective/2026-the-state-of-consumer-ai/` | Findings 1 and 2 | Representative survey; investor-authored; read in full |
| Left Hook, "Where Can You Actually List It?", `lefthook.com/blog/where-to-list-your-mcp-server-2026` | AI directories | Vendor guide with linked sources; read in full |
| Home pages of Sunsama, Motion, Reclaim, Structured, Tiimo, Atoms, Fabulous, Habitify, Divitica | Finding 4 | Primary, extracted by query |
| `hevyapp.com` | Hevy user count | Vendor claim |
| `api-docs.habitify.me/mcp/` | Finding 3 | Primary, excerpt |
| `divitica.com/compare/*` | Finding 3 | Competitor's claims about others; excerpt |
| Hive Index, Syften | Community sizes | Third-party trackers |
| `smollaunch.com`, `bigideasdb.com`, `github.com/DirectorySurf/awesome-producthunt-alternatives` | Launch boards | Self-interested roundups; excerpts |
| Straits Research, Business Research Insights, Market Research Future | Market size | Not used: estimates for 2026 range from US$2.2 billion to US$15 billion |
