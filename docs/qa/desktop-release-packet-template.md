# Cadence for Mac X.Y.Z release packet — Month D, YYYY

<!--
Copy to docs/qa/YYYY-MM-DD-desktop-X.Y.Z-release-packet.md and delete these comments.
Keep the packet to one page: link evidence instead of pasting logs or reports.
Checks: docs/DESKTOP_RELEASE.md, "Release acceptance". Steps: "Publication".
-->

## State

One line with a date: Built, Accepted, Published or Withdrawn. Publication needs the
owner's instruction for this exact artifact.

## Candidate

| Item | Value |
|---|---|
| Version | `X.Y.Z` |
| Release commit | full SHA, PR, clean tree |
| Last published | `A.B.C` from `<commit>` |
| SQLite schema | N (last published: M) |
| Notarization | app `<submission ID>`, DMG `<submission ID>`; both accepted and stapled |
| Toolchain and host | Node, rustc, Xcode; macOS version and build |

| Artifact | Bytes | SHA-256 |
|---|---|---|
| `Cadence_X.Y.Z_aarch64.dmg` (stapled) | | |
| `Cadence.app.tar.gz` (updater archive) | | |
| `Cadence.app.tar.gz.sig` | | |

Retained in `~/Library/Application Support/Cadence Release/apple/acceptance-X.Y.Z/`.

## Changes since the last published version

Summarize `git diff --name-only <last published commit> <release commit>` by area,
with PR links. Name the files that trigger area checks.

## Required checks

| Check | Result | Build, Mac, date |
|---|---|---|
| CI on the release commit | run link | — |
| `release.mjs check` and `build`: 14 artifact checks | | |
| Notarization and quarantined download | | |
| Upgrade from the last published version | acceptance report summary | |
| Real updater | result, or "Not required: no schema or updater change" | |

## Area checks

Evidence from a dev-signed build or an earlier candidate counts while the check's
files are unchanged since that build. Name the build and its commit.

| Check | Matched files | Result, build, Mac |
|---|---|---|
| Sign-in callback replay | files, or "Not required: no change to …" | |
| Session renewal and revoked session | | |
| Calendar callback replay | | |
| Native reminders | | |
| Second Mac or new macOS user | | |

Ticket acceptance in this release: links to the tickets' QA records.

## Release notes

Owner-approved plain text for the feed's `notes`.

## Publication

Record the time, the SHA-256 of each public asset (versioned and version-free DMG),
both feed versions, the feed signature check, and the quarantined public download.

## Limitations and rollback

Only what changed since the previous packet, with a link to it.
