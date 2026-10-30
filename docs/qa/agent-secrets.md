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
5. Store the token in the macOS Keychain. Copy the token, then run **one** of
   these in your own Terminal. Both read the token from the clipboard and pass it
   to `security -i` on stdin, so it never appears in a process argument list or
   in shell history. Both check that it looks like a token (`ops_`, then 246 to
   3,796 base64 characters, with no spaces or line breaks), store it under
   service `cadence-agent-1password` and account `service-account-token`, read
   it back and compare lengths. They print only lengths, never the token.

   Don't use `security add-generic-password … -w` with no value. Its password
   prompt keeps only the first 128 characters, and the token is much longer.

   From the Cadence checkout:

   ```bash
   pbpaste | npm run agent:secret -- --store-token
   ```

   Or from any directory, with no checkout (zsh or bash; `printf` is a shell
   builtin, so the token is never a process argument):

   ```bash
   t="$(pbpaste)"; if [[ $t == ops_* && ${#t} -ge 250 && ${#t} -le 3800 && $t != *[^A-Za-z0-9+/=._-]* ]]; then if printf 'add-generic-password -U -s cadence-agent-1password -a service-account-token -T /usr/bin/security -w %s\n' "$t" | security -i >/dev/null 2>&1; then n="$(security find-generic-password -s cadence-agent-1password -a service-account-token -w 2>/dev/null | tr -d '\n' | wc -c | tr -d ' ')"; if [[ $n == "${#t}" ]]; then echo "OK: stored ${#t} characters, read back $n"; else echo "NOT OK: read back $n characters, expected ${#t}"; fi; else echo "NOT OK: the Keychain write failed"; fi; else echo "NOT OK: the clipboard does not hold an ops_ token; nothing stored"; fi; unset t n
   ```

   Success looks like `OK: stored 900 characters, read back 900` (your numbers
   will differ, but the two must match). Then copy something else to clear the
   clipboard.

   **Redo after an older attempt.** An earlier version of this step used the
   `-w` password prompt, which stored only the first 128 characters. To check,
   run `security find-generic-password -s cadence-agent-1password -a
   service-account-token -w | tr -d '\n' | wc -c`; it prints a length only. If
   it prints 128, copy the token again (from your Personal vault copy, or create
   a new service account in step 4 and delete the old one) and run either
   command above. `-U` replaces the item. An agent then runs `--check`.

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
  5 op could not read an item; 6 `--check` failed; 7 `--store-token` input is not
  a plausible token; 8 `--store-token` write or read-back failed; 127 command not
  found.

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
