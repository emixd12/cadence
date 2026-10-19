# Privacy, account information, and deletion

Settings shows the signed-in profile email, links to public product boundaries,
and provides the permanent account-deletion flow.

## Sign out

**Prerequisites:** You are signed in to Cadence.

1. Find the account region at the bottom of the expanded desktop rail, collapsed
   desktop rail, or mobile drawer.
2. Choose **Sign out** directly below the account row.
3. Confirm that Login shows **Signed out.**

**Result and persistence:** Cadence reads this browser's current push endpoint,
deactivates only its active row for the departing account, ends the current
authenticated session, and returns to Login. This also works for browser
subscriptions created before Cadence added endpoint-aware sign-out. A browser
without a subscription still signs out. Cadence does not delete the account or
its other records.

**Recovery or undo:** Sign in with Google again to start a new session. If
current-device deactivation or sign out fails, Cadence leaves the session
unchanged and shows a factual error. A second account may then enable browser
notifications in the same browser without the departed account retaining the
active endpoint.

**Privacy and safety:** Sign out before leaving a shared device. Avoid signing
in through a shared browser profile when another person can access its cookies
or history; use a separate operating-system or browser profile when possible.
Account deletion is permanent and is not a substitute for signing out.

**Keyboard and mobile:** In the desktop rail or mobile drawer, Tab to **Sign
out** and press Enter or Space. The collapsed desktop control has the accessible
name and tooltip **Sign out**. On mobile, submitting closes the drawer.

## Open Trust, Privacy, or Terms from Settings

**Prerequisites:** You are signed in and Settings has loaded.

1. Under **Trust and legal**, choose **Privacy**, **Terms**, or **Trust**.
2. Read the public page and use its legal navigation to switch pages.
3. Use **Open settings** to return to the protected Settings screen, or
   **Cadence overview** and **Sign in** for the other public destinations.

**Result and persistence:** Only navigation changes. No account setting or
hosted record changes.

**Recovery or undo:** Use **Open settings** or browser Back. If the session is
invalid, Cadence routes through sign-in before opening Settings.

**Privacy and safety:** Privacy lists stored account, Behavior, reminder,
provider, export, import, and deletion data. Trust explains account isolation,
manual status truth, portability, and delivery limits. Terms defines the
single-account and non-clinical product boundaries.

**Keyboard and mobile:** Each row is a normal link with a visible title and
summary. Use Tab and Enter. At high zoom, the title and summary stack while the
link remains one focus target.

## Google Calendar data and disconnection

**Prerequisites:** The Cadence deployment has enabled the optional Google
Calendar connector, and you connected the same Google
identity used for the Cadence account. If Settings says Calendar is not
configured, the deployment has not enabled provider access. See the current
release evidence for deployment and installed-client acceptance.

Cadence requests read-only Calendar-list and event scopes through a separate
consent flow. It reads your subscribed calendar list for selection, then reads
events from selected calendars within the displayed inclusive date range. Depending on Google data and permissions, normalized event details can
include title, description, time or date span, timezone, location, organizer,
attendees, conference links, recurrence facts, response, busy/free state,
attachment links, revision, and a source URL. Cadence does not download
attachments or create, edit, or delete source events.
Google processes the consent, token, and Calendar API requests under Google's
terms and privacy policy. Cadence's use and transfer of Google API information
adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including its Limited Use requirements.

**Data custody:** Vercel runtime processes Calendar API requests and returned
event details while serving a refresh. Supabase stores the Calendar connection
and display preferences with the Cadence account. It stores the Google refresh
credential as account-bound encrypted ciphertext in a private database schema.
Cadence does not store Google event details in its hosted database. Browser and
desktop clients receive normalized event snapshots, not the Google credential.
Desktop may store the last complete normalized snapshot in the separate
`calendar-cache.sqlite3` file. That file can contain the readable event details
listed above. It contains no Google credential or raw Google response.

**Exports and backups:** Calendar credentials and event snapshots are excluded
from JSONL, CSV, App JSON, BehaviorLog, account synchronization, and user-created
desktop backups. Desktop backup and restore operate on `cadence.sqlite3`, not
the disposable Calendar cache. Supabase daily infrastructure backups can retain
sealed credential ciphertext for the current seven-day backup window after live
deletion. A user-created export cannot restore a Calendar connection.

**Disconnect and deletion:** **Disconnect Google Calendar** marks the connection
disconnected, clears selected calendar IDs, and deletes the live credential
before Cadence attempts to revoke the Google grant. If Google cannot confirm
revocation, Cadence tells you to remove the grant in Google Account permissions.
Account deletion attempts the same revocation and then removes the Auth user and
owner-scoped live Calendar records. If revocation fails, Google Account
permissions may still show the grant. Provider or hosting backup remnants can
outlast the live record under their retention policies. Other devices stop
refreshing when they next observe the connection change.

Ordinary web sign-out ends that browser session but keeps the account-level
Calendar connection. Desktop account disconnect and account reconnection clear
that Mac's event cache and pending Calendar callback without revoking the global
Google grant. An offline desktop may retain stale cached event details until it
reconnects or its Cadence account is disconnected. Keeping a local Cadence copy
does not keep Calendar event details in the Cadence database backup.

**Recovery or undo:** Reconnect Calendar to grant read-only access again.
Deleting the Cadence account is permanent and does not recreate any data when a
new account later connects to the same Google identity.

## Outlook, iCloud, Hevy, and Daily Brief data

These connectors are locally implemented and independently verified with synthetic
inputs. Live providers, installed desktop behavior and deployment remain unverified.
iCloud real-credential use and release also require the owner's acceptance of
hosted custody of an app-specific password that Apple does not limit to Calendar.
See [Timeline source instructions](timeline.md#connected-sources-outlook-calendar-icloud-calendar-and-hevy).

Cadence seals Outlook refresh credentials, the iCloud email and app-specific
password, and the Hevy API key in its hosted private schema. Client intake is
transient. Clients never persist these credentials. Vercel processes provider
responses; Cadence does not persist source records in its hosted database.
Web snapshots stay in memory. Desktop uses a separate disposable per-source
cache outside tracking exports, synchronization and user-created backups.
Infrastructure backups may retain deleted ciphertext for the existing seven-day
window. An offline device can retain stale context until its next connection
check or local account disconnect. Sign-out and account switch clear desktop caches.

Disconnect removes Cadence's saved access. Successful account deletion cascades
live connector records; a failed deletion preserves connections. Neither action
revokes these providers' grants or credentials. Remove Cadence in Microsoft
account app permissions or work/school My Apps, revoke the app-specific password
at account.apple.com, or remove or regenerate the API key in Hevy settings.

Hevy requires Pro. Its API can return exercise and other workout details;
Cadence discards them and keeps only identity/revision and timing fields needed
for normalized snapshots. Timeline shows timing and duration only. A request for
today still scans global history up to 500 workouts; larger accounts report
incomplete without page reads. Count/page checks detect some changes, not an
atomic snapshot. A workout never completes a Behavior or proves free time.

Connecting or displaying a source never permits model access. Each source needs
its own default-off Daily Brief choice before today's timing can reach OpenAI.
Calendar titles/details and credentials stay out. Hevy contributes only past
recorded timing. Reconnect or calendar reselection requires renewed permission.
Turning Daily Brief off revokes optional choices; older client saves also revoke
new source choices. Pending results are fenced after withdrawal or account changes.
Cadence retains no production prompt or briefing history. Text stays in memory;
preferences and bounded operational metadata persist. OpenAI retention can apply
even with `store:false`. Withdrawal cannot recall input already sent.

## Create an export before deletion

**Prerequisites:** You are signed in and considering account deletion.

1. In **Delete account**, choose **Open Export**.
2. Follow the procedure to
   [choose export options](data-portability.md#choose-export-options).
3. Download **App JSON backup (.json)** and/or
   **BehaviorLog bundle (.behaviorlog.zip)** and verify that the browser saved
   the file.
4. Return to Settings only after deciding whether the backup is sufficient.

**Result and persistence:** **Open Export** only navigates. Downloading creates
a local artifact; it does not change hosted records. The deletion form does not
detect whether the file is readable, complete for your needs, or stored safely.

**Recovery or undo:** If a download fails, do not acknowledge the export
decision yet. Retry with a valid session and enough local storage. Delete an
unwanted local copy through the operating system.

**Privacy and safety:** Full JSON and BehaviorLog can contain Behavior titles,
descriptions, definition history, status history, reminders, and optional
Notes. Store the backup securely. Full JSON is not accepted by the current
restore uploader; BehaviorLog is the restore-oriented format.

**Keyboard and mobile:** **Open Export** is a normal link. Use browser Back to
return to Settings. On mobile, use the browser download manager to verify the
file before continuing.

## Complete or clear the deletion gates

**Prerequisites:** Read the deletion warning and decide whether you have a
usable export or intentionally do not need one.

1. Select **I downloaded an export or do not need one.**
2. Read **Type _confirmation label_ to confirm**. The label is normally the
   signed-in profile email; if the account has no email, it is `DELETE`.
3. Enter the label exactly. Leading or trailing whitespace is ignored by the
   server, but the meaningful text and case must match.
4. Confirm that **Delete account** becomes enabled only after both gates are
   satisfied.

**Result and persistence:** The checkbox and typed value are client form state
only. They do not delete anything by themselves. The server revalidates both
values if the form is submitted.

**Recovery or undo:** Clear the checkbox or change the typed text to disable
**Delete account** before submission. Navigate away or reload to discard the
entire unsent form state.

**Privacy and safety:** Selecting **I downloaded an export or do not need one.**
is your explicit decision, not proof that a backup exists. The confirmation
label may be the private account email; do not expose it in screenshots or
shared recordings.

**Keyboard and mobile:** Use Space on the acknowledgement, Tab to the text
field, then type the exact label. Disabled state is programmatic and not shown
by color alone. At high zoom the gates and warning remain in one vertical
sequence.

## Delete the signed-in account

**Prerequisites:** You intentionally want permanent deletion, have handled the
export decision, and both deletion gates above are valid.

1. Verify the profile email and confirm you are deleting the intended Cadence
   account.
2. Recheck the local backup if you want to keep the record.
3. Choose **Delete account** once.
4. Wait for **Deleting...** to finish.
5. Confirm that Cadence returns to the public login screen and shows
   **Account deleted.**

**Result and persistence:** The server revalidates both gates, verifies its
server-only deletion credentials, deletes the Supabase Auth user, then attempts
global sign-out to clear the current browser session. Auth deletion removes
server session rows and refresh capability, and ownership cascades delete the
account's hosted Cadence records. An issued access token can remain valid until
its expiry. This is permanent and cannot be undone from the deleted account.

**Recovery or undo:** There is no undo after success. A later Google sign-in may
create a new empty Cadence account; it does not restore deleted records. If
validation, credential verification, or user deletion fails, Cadence shows a
specific error and preserves the account and session so you can review the
problem before trying again. A sign-out cleanup error after completed deletion
cannot restore the account and does not block the success confirmation.

**Privacy and safety:** Account deletion is destructive. Do not use it as a
troubleshooting step for notification, timezone, import, or schedule problems.
A local export is outside Cadence and remains wherever you stored or synced it,
even after hosted deletion.

**Keyboard and mobile:** Focus the enabled **Delete account** button and press
Enter or Space once. The destructive action is text-labeled and uses the form
gates in addition to visual styling. After navigation, focus moves to the
**Account deleted.** status so the result is announced on Login.

## Connect and disconnect an AI client

Start a Cadence connection from your AI client. Sign in with Google if needed.
Review the client name, verified or unverified label, return host, and account.
Read access is required and includes notes, which may contain sensitive data.
Switch off either write permission to narrow access. Choose **Allow** to connect
or **Deny** to refuse. Expired requests must be restarted from the AI client.

Open **Settings → Connected apps** to review permissions, connected dates, and
last use. Expand **Recent activity** for operations, times, and outcomes. Cadence
does not show operation payloads there. Choose **Disconnect** beside an app to
stop its access immediately. Reconnect from the AI client to restore access.
A failed Disconnect asks you to reload Settings and try again.

Use Tab to reach checkboxes and actions, Space to change a checkbox or expand
Recent activity, and Enter to submit. These controls also work in narrow mobile
browsers. Hosted grants are managed on the web; account-free desktop data is
not accessible to connected clients. Google Calendar, travel, Daily Brief, and
your email address are excluded from this access.
