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
node scripts/test-device.mjs ax <device> locate AXButton 'Sync now'
node scripts/test-device.mjs click <device> <x> <y>
node scripts/test-device.mjs update-install <device>
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

- `locate` prints an element's screen frame and center as JSON, read directly from
  Cadence's process (no System Events). `click` posts one mouse click at screen
  coordinates (top-left origin, as `locate` prints). Both are small Swift helpers in
  `scripts/test-device-ax/`; the script compiles them on the device with `swiftc` and
  rebuilds only when their source changes.
- `update-install` installs a downloaded update and restarts Cadence. Open Settings ›
  App updates first, with "Cadence X is ready to install." showing. See "Restart after
  an update" below.

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
  still-running old process fail with -25211 while other apps still answer. See
  "Restart after an update".
- When System Events reports no Cadence window, the window is on another Space or
  closed.

## Restart after an update

Verified on October 24, 2026 on the test Mac with a stand-in app swapped the way
Tauri's updater does it:

| Step on disk | Accessibility to the running app | `codesign --verify <pid>` |
|---|---|---|
| Running bundle renamed | works | valid |
| New bundle placed beside it | works | valid |
| Old bundle deleted (the updater's last step) | refused, -25211 | fails |

The refusal is permanent for that process, even if the original bundle comes back.
System Events and direct `AXUIElementCreateApplication` calls both fail; other apps
keep working. On the 0.1.5 release, a read at 16:22:28Z still worked right after the
install and failed from 16:22:42Z, so do not rely on that window. A synthetic mouse
click posted over SSH still reaches the process.

`update-install` therefore:

1. Scrolls **Check for updates** into view and records its frame. In
   `apps/desktop/src/desktop-update-panel.tsx`, the installed state hides Check for
   updates (`canCheck`), so **Restart Cadence** becomes the only button, in that
   slot. The script refuses if the slot is off-screen.
2. Presses **Install update** and waits for the version on disk to change.
3. Clicks near the left edge of the recorded slot (the two labels differ in width)
   and confirms the restart by a new Cadence PID. It retries the click twice.

If the PID does not change, the click missed, or Cadence refused the restart for
pending writes or unsaved drafts. The owner then checks the window. The slot
assumption depends on the status line and release notes keeping their height; if
the panel layout changes, re-verify it. Never relaunch Cadence from the shell while
the old process runs.

## Removing access

Turn off `sshd-keygen-wrapper` in the device's Accessibility list, remove the
labelled key from `~/.ssh/authorized_keys`, and delete the inventory entry.
