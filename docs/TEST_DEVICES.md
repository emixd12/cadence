# Test devices

Agents reach the owner's test devices over Tailscale SSH and drive the installed
Cadence app through the device's accessibility tree. This is the standing pathway
for installed acceptance that must not run on the owner's primary Mac, such as the
real-updater upgrade from the last published release (`docs/DESKTOP_RELEASE.md`,
"Release acceptance").

The owner approved this pathway on October 24, 2026, after the 0.1.5 release used
it. More devices will join; each follows the same setup.

## Inventory

The inventory names hosts and accounts, so it stays out of this public repository:

```text
~/Library/Application Support/Cadence Release/test-devices.json
```

That folder is Spotlight-excluded and owner-only. `CADENCE_TEST_DEVICES` can point
at another file. The format is in `docs/examples/test-devices.example.json`. Each
entry needs a `name`, the Tailscale `host` and an SSH `user`. Optional fields give
the app path, the process name System Events reports, and an absolute Node path
(non-interactive SSH does not load the shell profile).

## Commands

```bash
node scripts/test-device.mjs list
node scripts/test-device.mjs check <device>
node scripts/test-device.mjs exec <device> -- '<remote shell command>'
node scripts/test-device.mjs ax <device> read
node scripts/test-device.mjs ax <device> find '<regex>'
node scripts/test-device.mjs ax <device> press AXButton 'Sync now'
```

- `check` prints the macOS version and build, architecture, model, installed
  Cadence version, whether it runs, Node, and whether accessibility works.
- `exec` runs one shell command as the device user. Use it for read-only SQLite
  queries, the protect and check scripts in a retained release folder, and `open`
  for `cadence://` deep links. See `docs/DESKTOP_RELEASE.md`, "Agent-run installed
  acceptance", for the queries.
- `ax` copies the JXA helpers in `scripts/test-device-ax/` to the device and runs
  one against the Cadence window. `read` and `find` print visible text; filter out
  email addresses and calendar content before recording anything.

Copy files with `scp` to the same `user@host`. Recheck hashes on the device.

## Adding a device

Owner steps, once per device:

1. Join the device to the tailnet and confirm `tailscale status` lists it online.
2. System Settings › General › Sharing › Remote Login: on, for an account the agent
   may use. Some managed Macs allow only administrators.
3. Authorize the agent Mac's SSH key for that account, labelled
   `cadence-release-qa-from-<agent Mac>`, so it can be found and removed later.
4. Privacy & Security › Accessibility (macOS 27 names it **Device Control and Data
   Access**): add `/usr/libexec/sshd-keygen-wrapper` and turn it on. The agent can open
   the pane with
   `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`.
5. Run `node scripts/test-device.mjs check <device>`. The first accessibility call
   shows "sshd-keygen-wrapper wants access to control System Events"; choose
   **Allow**. Until then the call times out with -1712.

Then add the entry to the inventory and record the device's model and macOS version
in the release packet that first uses it.

## Rules

- The agent never changes TCC, Location Services, Gatekeeper or sharing settings,
  and never answers a permission or consent prompt. Those stay with the owner.
- Quit Cadence only with a normal quit event (`osascript -e 'tell application
  "Cadence" to quit'`), after reading that no writes are pending. Never force quit,
  and never launch a second copy while one runs.
- Sign-ins stay with the owner, except that the agent may pick the designated test
  account when Google's chooser already lists it.
- Keep test devices on their assigned release. Protect the app and database before
  any install, as the release guide describes.

## Known behavior

- After the updater replaces the app bundle, accessibility calls against the
  still-running old process fail with -25211 while other apps still answer. The
  owner clicks **Restart Cadence** (for example through Screen Sharing); do not
  relaunch from the shell.
- When System Events reports no Cadence window, the window is on another Space or
  closed.

## Removing access

Turn off `sshd-keygen-wrapper` in the device's Accessibility list, remove the
labelled key from `~/.ssh/authorized_keys`, and delete the inventory entry.
