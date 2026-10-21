# Cadence desktop development build

The default entry opens local tracking. Timeline, Behaviors, Export & Import,
and Settings use SQLite services. Export includes all five formats, validated
BehaviorLog merge, and confirmed destructive restore.
Tracking parity and Ticket 113's unnotarized preview/updater acceptance are
complete. Ticket 115 owns Apple-trusted distribution acceptance and is in progress.

The `?bench=native` entry retains the separate Ticket 108 Tauri, SQLite, and
UserNotifications operator bench. It is not a tracking or parity fixture.
See `docs/DESKTOP_BUILD.md` and `docs/DESKTOP_PARITY.md` at the repository root.

Use Node 24 and the Rust/macOS command-line toolchain. From the repository root:

```bash
npm ci
npm run desktop:dev:web
npm run desktop:dev
npm run desktop:native:test
npm run desktop:native:build
```

Run one development command at a time. The launcher selects the first available
loopback port from 4321 through 4330 and fails if none is available. Browser
preview deliberately disables native controls. `desktop:dev` supports SQLite
development; macOS notification tests require the packaged application.

The packaging command first builds the frontend, then produces
`src-tauri/target/debug/bundle/macos/Cadence.app`. Open that bundle
for WKWebView and notification verification. The bundle targets Apple Silicon
and macOS 14 or newer. The local build config uses ad hoc signing (`-`) to bind
the bundle identity and resources for macOS notification tests. It provides
no Developer ID, notarization, Gatekeeper, or updater assurance. Do not use
the local signing config for final release builds. The owner-authorized ad hoc
preview has separate completed evidence in `docs/DESKTOP_RELEASE.md`. macOS 14
is the declared and compiled minimum. Its runtime acceptance is deferred, so
the minimum does not establish compatibility.

The final application identifier is `app.cadence.desktop`. On first launch,
the app can adopt the earlier `app.cadence.desktop-spike/cadence.sqlite3`
database without removing or overwriting it. The native bench keeps its
synthetic values in a separate `native-boundary-spike.sqlite3` file within the
application-data directory. Never use that bench file as a Behavior database.
The native bench does not read web accounts.

## Native acceptance procedure

1. Commit a synthetic test value. Change the input, verify atomic rollback,
   then quit and reopen. The committed value and revision must survive.
2. Request notification permission explicitly. Record denial and allowed
   outcomes separately. A denied request must leave SQLite tracking usable.
3. Schedule one notification with a short delay. Observe presentation and
   activation. Repeat after fully quitting the application.
4. Use a long delay for capacity checks. Read every requested ID back. Any
   missing ID or scheduling error fails coverage. The 4096-item input ceiling
   is a probe safety bound, not a claim about the OS limit.
   **Verify limited coverage** uses the count field, replaces prior synthetic
   requests, and starts in 24 hours with one-minute spacing. It reads actual
   acceptance, retries the nearest retained count once, and shows the verified
   horizon against all requested reminders. Unknown readback or native errors
   cannot produce a successful result. This tests the owner's accepted
   OS-limited horizon; it is not the product reminder scheduler.
5. Read delivered notifications separately. A retained notification proves OS
   delivery, not visible presentation or activation; an empty list is inconclusive.
   Cancel test notifications and read back empty pending and delivered lists.
   Repeat cancellation. Rescheduling the same IDs must replace, not duplicate them.
6. Observe wake/resume and restart behavior. Record the exact tested macOS
   version and build. macOS 14 runtime verification is deferred.

Cancel every pending and delivered test notification before ending an authorized notification
test. Capacity tests must never use short delays or be left unattended. No
permission request or notification is sent automatically on launch.

`npm run desktop:parity:check` verifies tracking implementation and required
interaction evidence. Developer bench references cannot satisfy that gate.
Native boundary evidence is recorded in
`docs/qa/2026-08-30-desktop-native-boundary.md`.

## Shared tracking runtime

`src/timeline-screen.tsx` reuses the web Timeline groups, rows, status controls,
notes, timing controls, and Needs decision dialog. It accepts local form actions,
a stable `onRefresh` callback, and `onShowMore`. The web continues to use its
existing Next navigation through `WebRuntimeProvider`. `src/behaviors-screen.tsx`
reuses the current web editor, list, and dated review with a local link adapter.
`src/settings-screen.tsx` reuses timezone controls and displays native permission
and actual verified reminder coverage. `src/export-screen.tsx` reuses the shared
Export controls with local option, save, import, and restore callbacks.
`src/product.tsx` connects the available screens to local services. Connected source code
alone does not establish native interaction parity.

The product entry imports `src/timeline.css` to bundle the existing Tailwind
product styles, canonical tokens, and Fontsource IBM Plex Sans locally. Keep
operator bench chrome separate from product CSS. Vite emits only the four
current product PNGs and completion MP3 from root `public`; it does not copy
unrelated public assets or add a remote asset dependency. The build includes
the IBM Plex OFL and Lucide license notices. On 2026-08-31 the owner confirmed
ownership and authorized distribution of the six exact asset hashes inside
Cadence; see `docs/qa/2026-08-30-desktop-asset-provenance.md`. MIT exclusions,
third-party notices, and reserved trademark rights remain unchanged. The owner
approved the current preview packet; any further publication requires concrete
approval.
