# Agent-scoped secrets (Ticket 254)

Agents read the keys meant for them through a 1Password service account. They
see no Touch ID prompt. Owner secrets stay behind Emi's approval: the service
account can read only the "Cadence Agents" vault. The "Cadence" vault and the
MCP signing key are untouched and still prompt.

## Capability check (2026-10-30)

- 1Password CLI 2.40.0; one account on `my.1password.com` (an Individual or
  Families account; the plan type was not read).
- `op service-account create --help` is available in this CLI. It accepts
  per-vault `read_items` access and an expiry, and it cannot grant access to
  Personal or Private vaults.
- 1Password's service-account rate-limit page lists limits for Individual and
  Families accounts: 1,000 reads per hour per token and 1,000 reads and writes per
  day per account. One acceptance run reads two items, so the limit is not a
  constraint.
- Vaults today: Automation, Cadence, Personal. No "Cadence Agents" vault yet.
- Not verified: actually creating a service account on this account. Emi's step 4
  below is the first real test. If it fails, the fallback is macOS Keychain items
  behind the same wrapper (not built).

## Emi's one-time setup

1. In the 1Password app, create a vault named **Cadence Agents**. Put only agent
   keys in it.
2. In the Anthropic Console, create an API key for agent acceptance runs, in a
   workspace with a monthly spend limit you choose. Save it in Cadence Agents as
   an **API Credential** item named `anthropic-api-key`, with the key in the
   **credential** field.
3. On the OpenAI platform, create a project for agent acceptance runs, with a
   monthly budget you choose, and a project API key. Save it in Cadence Agents as
   an **API Credential** item named `openai-api-key`, with the key in the
   **credential** field.
4. Create a service account that can read Cadence Agents and nothing else. Either
   use 1Password.com (Developer → service accounts; the exact menu path is not
   verified) with read access to Cadence Agents only, or run this in your own
   Terminal:

   ```bash
   op service-account create "Cadence agents" --vault "Cadence Agents:read_items" --expires-in 90d
   ```

   1Password shows the token (`ops_…`) once. Optionally keep a copy in your
   Personal vault, not in Cadence Agents.
5. Store the token in the macOS Keychain. In your own Terminal, run the command
   below and paste the token at each of its two prompts. The `-w` flag with no
   value makes `security` prompt, so the token never enters shell history:

   ```bash
   security add-generic-password -s cadence-agent-1password -a service-account-token -U -T /usr/bin/security -w
   ```

That is all. An agent then verifies the setup with the `--check` command below and
reports the result. Nothing else is asked of Emi.

## For agents

Run a command with keys in its environment:

```bash
npm run agent:secret -- --run .intent/acceptance/<run-id> --caller <agent-or-ticket> \
  --env ANTHROPIC_API_KEY=anthropic-api-key \
  --env OPENAI_API_KEY=openai-api-key \
  -- node scripts/acceptance/<runner>.mjs
```

Verify setup without reading any value (prints vault and item names only):

```bash
npm run agent:secret -- --check --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key
```

- Item references are `item`, `item/field` or `op://Cadence Agents/item/field`.
  The default field is `credential`. The wrapper refuses any other vault before it
  calls `op`. It also refuses reserved variable names such as `PATH`, `NODE_OPTIONS`
  and `OP_*`.
- The wrapper reads the token from the Keychain and runs `op read` with only that
  token in op's environment, so op never uses the desktop app or Emi's vaults.
  The child gets the values; the token and all other `OP_*` variables are removed.
- Each access appends one line to `<run-dir>/events.jsonl` (with `--run`), or
  else to `.intent/acceptance/secret-access.jsonl`. `--caller` defaults to the
  command's name. Fields:
  `type`, `at`, `caller`, `vault`, `item`, `field`, `env`, `outcome`
  (`ok`, `refused` or `failed`) and a fixed `reason` on failure. Never a value.
- The wrapper prints no value or token. op's error text is classified into a
  fixed reason and never relayed. What the child prints is the child's
  responsibility: runners must not log the keys they receive.
- `--check` fails if the service account can reach any vault other than Cadence
  Agents.
- Exit codes: the child's code; 2 usage; 3 refused; 4 no token in the Keychain;
  5 op could not read an item; 6 `--check` failed; 127 command not found.

## Security notes

- `-T /usr/bin/security` lets any process running as Emi read the token without a
  prompt. That is the point: agents need no Touch ID. The token reaches only
  Cadence Agents, which holds spend-limited API keys.
- To revoke: delete the service account on 1Password.com, then run
  `security delete-generic-password -s cadence-agent-1password -a service-account-token`.
  To rotate a key, replace the item's credential; nothing else changes.
- Tests (`tests/acceptance-agent-secret.test.mjs`) drive the wrapper with a fake
  `op` and a fake Keychain. They scan stdout, stderr, the ledger and every written
  file for the fake token and values.
