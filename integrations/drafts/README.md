# Unpublished plugin drafts

Files here are drafts. No plugin package contains them, no directory lists them and
no AI client loads them. `scripts/package-plugins.mjs` builds each ZIP from the fixed
file list in `scripts/check-plugins.mjs` (`packageFiles`), which names files inside
`integrations/claude-plugin/` and `integrations/chatgpt-plugin/` only.
`tests/plugin-skill-drafts.test.ts` fails if a draft path reaches that list or a ZIP.

| Draft | Replaces | Waits on |
|---|---|---|
| `skills/daily-check-in/SKILL.md` | `integrations/skills/daily-check-in/SKILL.md` and its copy in each plugin | `P-100` in `docs/MESSAGING_CHANGES.md`; the marketing site overhaul (`P-048`, Ticket 246); the owner's instruction |

## The `daily-check-in` draft (Ticket 380, D36)

It names `show_day`, the tool that opens the "Cadence day" view in an AI client:

- When the client can display the view, call `show_day` for today. Otherwise, and
  for every other question, call `get_timeline`.
- The user's clicks in the view are the user's confirmation. The model writes
  nothing for them and does not ask again.
- A connector completion is never described as the user's mark.

The rest is the published text. Not run with a real client yet: the acceptance
scenario `skill-check-in-view-unconfirmed` (`scripts/acceptance/client-prompts.mjs`)
sends this draft to a client, and its first run belongs to Ticket 378.

## Publishing a draft

Publishing is listing work. It is on the owner's checklist in
`docs/qa/mcp-directory-submission.md`, "Deferred owner steps for MCP Apps". Do not
publish from a development ticket. When the owner says so:

1. Copy the draft over `integrations/skills/<name>/SKILL.md` and over the copy in
   each plugin. `node scripts/check-plugins.mjs` fails until all three are equal.
2. `tests/plugins.test.ts` accepts registry tools only. While `show_day` is a
   transport tool outside the registry (`docs/MCP_CONTRACT.md`, "MCP Apps trial"),
   that test must also accept `SHOW_DAY_TOOL_NAME` from
   `lib/mcp/apps/config.ts`, as the draft's test does.
3. Delete the draft and its row above, and move its rule tests to the published
   skill's tests.
4. Raise the plugin version in both manifests. A changed skill needs a new ZIP for
   ChatGPT.
