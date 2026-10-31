# Location permission checks in disposable macOS VMs

Status: feasibility spike done on the owner's Mac, October 27–29, 2026. The
prototype `scripts/location-vm.mjs` ran once per state against the published 0.1.6
DMG, and all three runs passed. This is a follow-up proposal, not a ticket
(`docs/FUTURE_UPDATES.md`, "Location permission VM images"). It changes no product
behavior.

Platform impact: desktop only (macOS test tooling). Web, marketing and future
mobile: not applicable, because these checks drive the installed Mac app.
Messaging impact: none.

## Approach

One Tart VM image per location state: `cadence-loc-never-asked`,
`cadence-loc-allowed` and `cadence-loc-denied`. The owner sets each image's state
by hand once. Each run clones an image, installs a given DMG over the previous
release, runs the checks, records the results and deletes the copy. The agent never
changes Location Services, TCC, Gatekeeper or other privacy settings, and never
answers a permission prompt.

## Feasibility answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the published DMG install and pass Gatekeeper in the guest? | Yes | A quarantined copy of 0.1.5 and of 0.1.6 (stand-in for a browser download): DMG and app `accepted, source=Notarized Developer ID`; `syspolicy_check distribution` passed; `codesign --verify --strict` passed after install. The guest kept Gatekeeper and SIP on. |
| Does the guest report location permission states? | Yes | 0.1.6 showed "not yet allowed", "allowed" and "blocked" in the matching images. Reads logged `prompt`, `cl_error_0` and `denied reason status_2`. |
| Does the first prompt appear? | Yes | `CoreLocationAgent … handle auth-prompt from locationd` within about one second of turning Travel on, and a visible prompt window with **Don't Allow** and **Allow**. |
| Can it get a position fix? | No | Allowed reads end `unavailable reason cl_error_0` (location unknown). Apple-silicon VMs have no Wi-Fi location source. A fix still needs real hardware. |
| Does a saved state survive cloning? | Yes | Allowed and denied copies reported their state at the first request, and locationd showed no prompt. |
| Does it survive upgrading Cadence? | Yes | Images hold published 0.1.5. Each run installs 0.1.6 over it; the grant and the denial both held. locationd keys the grant to the Developer ID requirement (`identifier "app.cadence.desktop" … subject.OU = HK26VT477G`), not to the bundle hash. |
| Can the agent drive the guest with the test Mac's helpers? | Yes | `scripts/test-device.mjs exec` and `ax read/find/press` worked over SSH after the owner granted Accessibility and System Events once in the base image. Grants carry into every clone. |

## Finding: a late answer to the first prompt is lost

`cadence_location_request` in `apps/desktop/src-tauri/native/location.m` gives up
after 12 seconds. `finish:` then clears the delegate, and the last reference to the
`CLLocationManager` that requested authorization goes away. In the VM:

- The owner chose **Allow** after the deadline. locationd logged
  `sending AuthPrompt response … response=1` but stored no authorization for
  Cadence; the next read was `prompt` again, and locationd showed a new prompt.
- The owner chose **Don't Allow** 2.5 seconds after the prompt appeared. locationd
  stored `Authorized => false`, and Cadence read `denied reason status_2`.

So the first prompt only works when it is answered within 12 seconds. This may
explain the Ticket 165 report that the first prompt did not appear in rc.3. The spike
did not change Cadence; the fix is a separate follow-up. The never-asked image
reproduces it on demand.

A second observation, not verified as a fault: right after Settings opens, 0.1.6
shows "Device location: not yet allowed." in the allowed and denied images too,
before the next read corrects it. It may be a loading default.

## Image setup (owner and agent)

The agent did all of this except the steps marked "owner".

1. Install Tart 2.41.1 from the GitHub release into
   `~/Library/Application Support/Cadence Release/tools/` and check its checksum.
   Download Apple's macOS 27.0 restore image (26A428, 26.6 GB) and check it against
   the published SHA-256. `curl -C -` resumes a dropped download.
2. `tart create cadence-loc-base --from-ipsw <file> --disk-size 50 --disk-format asif`.
   Do not use prebuilt images that disable Gatekeeper.
3. First boot with `--provisioning-opts=fullName=Cadence QA,username=admin,password=…,logsInAutomatically=true,enablesRemoteLogin=true`.
   The guest password lives in `location-vm/guest-password` (owner-only).
4. Create `location-vm/id_ed25519`, install its public key in the guest, and pin the
   guest host key in `location-vm/known_hosts` under the alias `cadence-loc-vm`.
   Compare it with the guest's `/etc/ssh/ssh_host_ed25519_key.pub`.
5. Owner: in the base guest, add `/usr/libexec/sshd-keygen-wrapper` to
   Privacy & Security › Device Control and Data Access, allow the System Events
   prompt, and turn on Location Services.
6. Install the previous published release from a quarantined DMG with
   `ditto --noqtn`, dismiss setup, save a Usual travel, keep Travel estimates off,
   quit Cadence normally and shut down.
7. Clone the base into the three state images.
8. Owner: in `cadence-loc-allowed` and `cadence-loc-denied`, the agent turns Travel
   on and the owner answers the prompt within 12 seconds. If an answer is lost, the
   owner sets Cadence in Privacy & Security › Location Services instead.

## Running

```bash
node scripts/location-vm.mjs images
node scripts/location-vm.mjs run allowed ~/path/Cadence_0.1.6_aarch64.dmg
```

Each run records the guest version, Gatekeeper results, the previous and installed
versions, the Device location line before and after a request, the **Check again**
and **Open Location Services** results, and Cadence and CoreLocationAgent log lines
with anything that looks like a coordinate removed. Results go to
`location-vm/runs/<copy>.json` (mode 600). `--keep` keeps a failed copy for
inspection; a passing copy is always deleted. One copy runs at a time.

The runner stages only the selected DMG in its read-only share, under a fixed
name. A failed copy, Gatekeeper assessment, mount, install, signature check or
accessibility action fails the run. Gatekeeper must report Notarized Developer
ID with assessments enabled, and the installed version must match the candidate.
The permission after the request and after **Check again** must match the chosen
image. Never-asked and denied images must show both recovery buttons; an allowed
image may omit them. When **Open Location Services** appears, it must bring
System Settings to the front. A cleanup failure also exits unsuccessfully and
records the remaining copy.

October 31 review added synthetic guest-sequence regression tests for these
failure paths. These tests do not establish a new installed macOS run; the
October 27–29 evidence above belongs to the original spike.

Use published, notarized DMGs in guests. Dev-signed builds go only to the owner's
Mac (`docs/DESKTOP_RELEASE.md`, "Dev-signed builds").

## Pitfalls seen

- ssh splits an unquoted `UserKnownHostsFile` at spaces; `test-device.mjs` quotes it.
- `find.js` matches `<role> <text>` with a space and prints `<role>: <text>`.
- `pgrep -x` sees process names cut to 15 characters; match the executable path.
- The web content loads after the window appears; wait for **Open navigation**.
- `hdiutil attach` prints a deprecation warning on stderr.
- `/usr/bin/python3` and `strings` in a guest without developer tools open the
  install dialog. Use `plutil` and `grep`.
- Deleting a running app's bundle stops accessibility for that process; quit
  Cadence normally before replacing it.

## Disk and time

The base image uses about 36 GB; clones share blocks. A run takes about four minutes.
The restore image can be deleted once the base exists, or kept to rebuild it.
