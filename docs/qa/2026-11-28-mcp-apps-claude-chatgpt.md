# MCP Apps on Claude web and ChatGPT web: first real-host run — November 28, 2026

Tickets 375 and 378. One manual run by an agent in the Cadence QA Chrome profile, on the
owner's Claude and ChatGPT accounts, in new `[Cadence QA]` chats only. The server was a
disposable local stack with `CADENCE_MCP_APPS=true` behind a `cloudflared` tunnel
(`docs/qa/2026-11-28-mcp-apps-gemini-tunnel.md`). The Cadence account was a local
test-login user with three daily Behaviors. Production was not touched, except the last
section.

Each step was checked against Cadence's own activity record on the local stack.

## Results

| Check | Claude web | ChatGPT web |
|---|---|---|
| Add the server as a custom connector | Pass. Claude detected OAuth and its published client identity. Consent named it "Claude", verified. | Pass, through Plugins → Add → "Add custom MCP server". Consent named it "ChatGPT", verified. |
| Tools listed | 31, with `show_day` under "Interactive tools" | Not read from the page |
| `show_day` from a chat prompt | Called, `success` | Called, `success`, without selecting the plugin in the composer |
| Approval prompt before `show_day` | None | None |
| View resource read | `read_view_resource`, `success` | `read_view_resource`, `success` |
| Day view rendered | Yes, in a `claudemcpcontent.com` frame, with an "Unverified" label on the card | Yes, in an `oaiusercontent.com` frame |
| Status change from the view | `set_occurrence_status` `success`; the view re-read the day | `set_occurrence_status` `success`; the view re-read the day |
| Approval prompt on a view write | None | None |
| Note saved from the view | `update_occurrence_note` `success` | Not run |
| Write after the grant lost its write scopes | `denied`, `insufficient_scope` (HTTP 403). The view re-read the day and switched to read-only with "Reconnect to allow changes". Claude opened no sign-in prompt. | `denied`, `insufficient_scope` (HTTP 403). ChatGPT ran discovery again and opened its "Continue to Cadence QA tunnel" sign-in dialog. The view kept its buttons and showed no notice. |

The model's text reply does not know the view rendered. Claude's reply said the connector
"sent the day back as raw data rather than its interactive view", under a rendered view.

## Answers to Ticket 375's three host questions

1. **Approval prompts on view-initiated writes:** neither host asked, under each account's
   current permission settings. ChatGPT's default was "Allow low-risk tools". Other
   settings were not tried.
2. **The 403 step-up on a view call:** Claude returns the error to the view and does
   nothing else. ChatGPT starts re-authorization itself. The scope loss was made by
   narrowing the grant in the disposable database, not by a real revoke.
3. **View caching:** not measured. Each host read the view resource once in its one chat.

## Not tested

Claude Desktop, Claude mobile, VS Code Copilot. A parent-slot write and a conflict on a
real host. A second chat or a second day. ChatGPT's view after re-authorization. The run
was not through `scripts/acceptance/web-client.mjs`, so it left no run ledger; Ticket 378's
harness work is still open.

## Cleanup

- The temporary "Cadence QA tunnel" connector was removed from Claude and the app deleted
  from ChatGPT. Each account's "Cadence QA" entry was confirmed still present.
- The ChatGPT test chat was archived from its own header menu. The Claude test chat was
  kept, as the privacy rule requires.
- The stack and the tunnel were stopped.
- **Privacy slip:** one screenshot of Claude's page included the sidebar with chat titles.
  It was deleted at once and later captures took only the app frame. No title was written
  to the repository or a run folder.

## Production: the claude.ai "Cadence QA" connector

Claude showed the connector as connected while Cadence had no active grant for it. The
agent disconnected it, connected it again and allowed consent as test account A. The
`mcp-clients` and `mcp-web` preflight then reported no owner steps.

## Later the same day: Claude Desktop, VS Code and Gemini

Same local stack and tunnel, a new test-login user with the same three Behaviors.

| Host | Result |
|---|---|
| Claude Desktop 7.37095.0 (macOS), chat mode | The tunnel connector added on the web appeared in the app. Two new chats each called `show_day` (`success`, no approval prompt). **Neither rendered the view**: the app showed a collapsed "Used Cadence QA tunnel: Show day" tool block and Cadence recorded no `read_view_resource`. Claude web rendered the view for the same account earlier that day. Driven with macOS UI scripting; the app refused a debugging port. |
| VS Code 1.148.0 | Installed for this run, isolated profile, server set in `.vscode/mcp.json`. The server stays at "Starting": VS Code's agent host reports "Not authenticated" until GitHub Copilot is signed in. Cadence saw one unauthenticated `POST /mcp` (401) and no discovery or registration. Blocked on the owner's GitHub sign-in. |
| Gemini against production | Pass for sign-in: with PR #442 deployed, Gemini reached consent (as "Google", unverified client), exchanged the token and listed 30 tools. Chat checks did not run: the free test account hit Gemini's usage limit ("Resets 5:37 AM") and answered every prompt as blank. |
| Claude mobile | Not run. No tool in this session drives a physical phone. |

By mistake the first Claude Desktop prompt went to a Code-mode session, which read test
account A's production data through the "Cadence QA" connector. It wrote nothing.
