# Settings wording pass: before and after (Ticket 309)

Date: November 10, 2026. Owner direction: `docs/DECISIONS.md`, 2026-11-10 ("prioritize clear
and delightful language"). Voice: `PRODUCT.md`, "Brand Personality".

Scope: web Settings, the shared panels on the Mac, and the Mac-only Settings sections.
Sentences that state what Cadence sends, stores or shares are unchanged. They are listed for
Ticket 246 in `docs/MESSAGING_CHANGES.md`, P-033. Privacy, Terms, Trust, consent text,
marketing, the user guide and the owner-approved leave reminder phrases are unchanged.

`{name}` is the source name in full: Google Calendar, Outlook Calendar, iCloud Calendar or
Hevy.

## General

| Location | Before | After |
|---|---|---|
| Timezone, select options | `America/New_York` | New York, under the group "Americas" (the saved value stays `America/New_York`) |
| Timezone, three-part names | `America/Indiana/Knox` | Knox, Indiana |
| Timezone, device hint | Detected America/New_York. | Your device is set to New York. |
| Timezone, hint button | Use detected timezone | Use device timezone |
| Timezone, help text | Saving updates active behavior schedules and future unresolved occurrences. Past and resolved history stays unchanged. | Saving moves active Behavior schedules and future Unresolved Occurrences to this timezone. Past Occurrences and ones you have marked stay as they are. |
| Timezone, saving button | Saving... | Saving… |
| Timezone, saved result (web) | Timezone saved. 1 active behavior was updated. | Timezone saved. 1 active Behavior now uses it. |
| Timezone, saved result (web) | Timezone saved. N active behaviors were updated. | Timezone saved. N active Behaviors now use it. |
| Notifications (web), status | Checking | Checking… |
| Notifications (web), saving button | Saving... | Saving… |
| Notifications (web), blocked help | Allow notifications for Cadence in your browser or site settings, then return here and select Refresh this device. | Allow notifications for Cadence in your browser's site settings, then come back and choose Refresh this device. |
| Notifications (web), not allowed | Notifications were not enabled. Click Enable notifications on this device to try again. | Notifications are still off. Choose Enable notifications on this device to try again. |
| Notifications (web), check failed | Cadence could not check notification delivery for this device. Select Refresh this device to try again. | Cadence could not check notifications on this device. Choose Refresh this device to try again. |
| Notifications (web), no server key | Notifications are not configured. | This Cadence server has not set up notifications. |
| Categories, purpose | Organize Behaviors with your own categories. Descriptions provide context in forms and exports. | Group Behaviors your way. A category's description shows in Behavior forms and exports. |
| Categories, save error | Unable to save categories. Your draft is unchanged. Try again. | Categories could not save. Your changes are still here. Try again. |

## Connections

| Location | Before | After |
|---|---|---|
| Connected sources, purpose (last sentence) | Each source connects and fails separately. | Each source works on its own. |
| Source that this build cannot connect | {name} is unavailable in this build. | This version of Cadence cannot connect {name}. |
| Source row state, no broker | Unavailable in this build | Not in this version |
| Every source, server without the provider | {name} connection is not configured for this Cadence deployment. | This Cadence server cannot connect {name}. |
| Every source, status while loading | Loading {name} connection. | Checking {name}… |
| Every source, status read failed | {name} status is unavailable. Other sources and tracking are unaffected. | Cadence could not check {name}. Other sources and tracking still work. |
| Google Calendar, status read failed | Calendar status is unavailable. | Cadence could not check Google Calendar. Reload Settings to try again. |
| Google Calendar, status unavailable | Calendar is unavailable. | Google Calendar is not available right now. |
| Calendar sources, display legend | Calendar display / Outlook display / iCloud display | Timeline display |
| Calendar sources, show checkbox | Show Calendar context on Timeline / Show Outlook context on Timeline / Show iCloud context on Timeline | Show {name} events on Timeline |
| Calendar sources, all-day checkbox | Show all-day events / Show all-day Outlook events / Show all-day iCloud events | Show all-day {name} events |
| Google Calendar, refresh button | Refresh Calendar | Refresh Google Calendar |
| Refresh buttons while busy | Refreshing Calendar… / Refreshing Outlook… / Refreshing iCloud… | Refreshing {name}… |
| Disconnect buttons while busy | Disconnecting Calendar… / Disconnecting Outlook… / Disconnecting iCloud… | Disconnecting {name}… |
| Connect buttons while busy | Opening Calendar connection… / Opening Outlook connection… / Connecting iCloud… | Opening Google Calendar… / Opening Outlook Calendar… / Connecting iCloud Calendar… |
| Google and Outlook, connect started | Continue in the browser to connect Calendar. / Continue in the browser to connect Outlook Calendar. | Continue in your browser to connect {name}. |
| Google and Outlook, connect did not start | Calendar connection could not start. / Outlook Calendar connection could not start. | {name} could not start connecting. Try again. |
| Google and Outlook, callback failed | Calendar connection could not complete. Try connecting again. / Outlook Calendar connection could not complete. Try connecting again. | {name} did not connect. Try again. |
| Outlook, expired attempt | That Outlook Calendar connection expired. Start the connection again. | That Outlook Calendar connection timed out. Connect Outlook Calendar again. |
| Calendar sources, list did not load | Calendar list could not load. / Outlook calendar list could not load. / iCloud calendar list could not load. | Your {name} calendars could not load. Try Refresh {name}. (Google and iCloud say "Your Google calendars" and "Your iCloud calendars".) |
| Calendar sources, list updated with no calendars chosen | Calendar list refreshed. Select calendars to show events. (and the Outlook and iCloud forms) | Calendar list updated. Choose calendars to show their events. |
| Calendar sources, saved but list did not reload | Saved. The calendar list could not reload; try Refresh {name}. | Saved. The calendar list did not reload. Try Refresh {name}. |
| iCloud, connected but list did not load | iCloud Calendar connected. The calendar list could not load; try Refresh iCloud Calendar. | iCloud Calendar connected. The calendar list did not load. Try Refresh iCloud Calendar. |
| Google Calendar, refreshed | Calendar refreshed. {freshness}. | Google Calendar refreshed. {freshness}. |
| Calendar sources, no events | No Calendar events in this range. / No {name} events in this range. | No {name} events to show. |
| Google Calendar, refresh failed | Calendar refresh did not finish. Try again; saved settings and existing timeline context are unchanged. | Google Calendar did not refresh. Try again. Your settings and Timeline are unchanged. |
| Outlook and iCloud, refresh failed | {name} refresh did not finish. Try again; saved settings, other sources, and tracking are unchanged. | {name} did not refresh. Try again. Your settings, other sources and tracking are unchanged. |
| Hevy, refresh failed | Hevy refresh did not finish. Try again; other sources and tracking are unchanged. | Hevy did not refresh. Try again. Other sources and tracking are unchanged. |
| Outlook and iCloud, refresh incomplete | {name} refresh was incomplete. The Timeline keeps the last complete read. | {name} refresh was incomplete. Timeline shows the last full refresh. |
| Every source, timeout | {provider} did not respond in time. Try again; other sources and tracking are unchanged. | {provider} did not respond in time. Try again. Other sources and tracking are unchanged. |
| Every source, disconnect failed | {name} disconnect could not finish. | {name} did not disconnect. Try again. |
| Google Calendar, settings save failed | Calendar settings could not save. Try again. | Google Calendar settings could not save. Try again. |
| Google Calendar, no calendars | No readable calendars are available. | This account has no calendars to show. |
| iCloud, partial calendar | iCloud returned only part of a calendar, so Cadence did not treat it as complete. | iCloud sent only part of a calendar, so some events may be missing. |
| Hevy, intake (last sentence) | A complete read means no change was detected during the scan, not an atomic snapshot. | A complete refresh means Hevy reported no changes while Cadence read it. |
| Hevy, incomplete list | Hevy could not verify a complete list. The scan is limited to 500 workouts; changes during the scan can also make it incomplete. | Hevy did not return a complete list. Cadence reads up to 500 workouts, and changes made during a refresh can also leave gaps. |
| Connected apps, empty | No apps connected. Start a connection from an AI client to review its permissions here. | No apps connected yet. When you connect Cadence from an AI app, it shows here with its permissions. |

## Planning

| Location | Before | After |
|---|---|---|
| Travel, panel description | Estimate travel time to located Calendar events and Behaviors. Travel never changes a schedule or status. | Estimates travel time to Calendar events and Behaviors that have a place. Travel never changes a schedule or status. |
| Travel, location outcome (denied) | Location denied. Estimates start from Home or your previous stop instead. | Location access is off. Estimates start from Home or your previous stop instead. |
| Travel, location outcome (unavailable) | Location unavailable. … Diagnostic: timeout. | Your device did not share a position. … Details: timeout. |
| Travel, location outcome (inaccurate) | Location inaccurate. … | Your position is not precise enough. … |
| Travel, Mac line | Saved places work offline. Route estimates need a linked account, a synchronized working copy and an internet connection. | Saved places work offline. Route estimates need a linked Cadence account, a finished sync and an internet connection. |
| Daily Brief, nothing connected | … Connect a calendar or Hevy in Connectors, and this choice covers it. | … Connect a calendar or Hevy in Connected sources, and this choice covers it. |
| Daily Brief, Advanced row | … Choose calendars in Connectors. | … Choose calendars in Connected sources. |
| Daily Brief, load failed | Daily Brief settings are unavailable. | Daily Brief settings could not load. Reload Settings to try again. |
| Daily Brief, save failed | Cadence could not save Daily Brief settings. | Daily Brief settings could not save. Try again. |
| Daily Brief, server without a model | Daily Brief is unavailable because this Cadence server has no configured model. | This Cadence server does not offer Daily Brief. |
| Daily Brief, Mac without account or connection | Daily Brief is available only to linked, online desktop accounts. Local tracking remains available offline. | Daily Brief needs a linked Cadence account and an internet connection. Tracking works offline. |
| Daily Brief, Notes checkbox | Include Notes on Not Completed occurrences | Include Notes on Not Completed Occurrences |

## Account and data

| Location | Before | After |
|---|---|---|
| Delete account, gate help | Deletion unlocks after the export acknowledgement and typed confirmation match. | Delete account turns on after you check the box and type the confirmation. |
| Delete account, button while busy | Deleting... | Deleting… |

## Mac only

| Location | Before | After |
|---|---|---|
| General, notifications heading | Native notifications | Notifications (also in the Setup guide list) |
| Notifications, macOS permission | Checking macOS permission / Not requested / Provisional permission / Denied / Not verified / Unavailable | Checking… / Not asked yet / Allowed quietly / Not allowed / Unknown / Not available here |
| Notifications, permission button | Request notification permission | Allow notifications |
| Notifications, denied help | Allow notifications for Cadence in macOS System Settings, then refresh reminder coverage. Tracking still works without notification permission. | Turn on notifications for Cadence in System Settings › Notifications, then choose Check reminders. Tracking works without notifications. |
| Notifications, preview window | Native notifications are unavailable in this runtime. Open the installed macOS app to check permission. | Notifications are not available here. Open Cadence for Mac to check them. |
| Reminder coverage, checking | Checking reminder coverage… | Checking reminders… |
| Reminder coverage, complete | All eligible reminders in the target window are scheduled. | Every reminder for the next 30 days is scheduled. |
| Reminder coverage, limited | Limited reminder coverage. The verified horizon is shorter than the target. | macOS kept fewer reminders than Cadence scheduled. Reminders are set only through the date below. |
| Reminder coverage, unknown | Reminder coverage is not verified. | Cadence has not confirmed which reminders are scheduled. |
| Reminder coverage, labels | Verified through / 30-day target through / Retained reminders / Eligible reminders / Last readback check / First unverified reminder | Scheduled through / 30-day goal / Reminders macOS kept / Reminders to schedule / Last checked / First reminder not scheduled |
| Reminder coverage, empty values | Not verified | Not confirmed |
| Reminder coverage, help | Cadence targets 30 days and schedules the nearest eligible reminders first. macOS may retain fewer requests. Later reminders do not extend coverage past a missing reminder. Open Cadence to refresh the verified horizon. | Cadence schedules up to 30 days of reminders, nearest first. macOS may keep fewer. Scheduled through stops at the first reminder macOS did not keep. Opening Cadence checks again. |
| Reminder coverage, timezone line | Times use America/New_York. Scheduling does not prove delivery; macOS controls notification presentation. | Times use New York time. macOS decides whether and how each scheduled reminder shows. |
| Reminder coverage, button | Refresh reminder coverage / Refreshing reminders… | Check reminders / Checking reminders… |
| Cadence account, linked | This Mac remains connected to its Cadence account. | This Mac is linked to your Cadence account. |
| Cadence account, reconnecting | Complete account reconnection in your browser. | Finish reconnecting in your browser. |
| Cadence account, not linked | … Local tracking remains available without an account. | … Tracking works without an account. |
| Cadence account, no sign-in in this build | Account sign-in is not configured in this build. | This version of Cadence cannot sign in to an account. |
| Cadence account, signing in | Complete Google sign-in in your browser. | Finish signing in with Google in your browser. |
| Cadence account state, no sign-in in this build | Unavailable in this build | Not in this version |
| Sync, heading | Account synchronization | Sync |
| Sync, offline | Offline. Local changes will synchronize when Cadence reconnects. | Offline. Changes on this Mac sync when Cadence is back online. |
| Sync, running | Synchronizing account data… | Syncing… |
| Sync, conflicts | N synchronization conflicts require review. | N sync conflicts to review. |
| Sync, signed out | The account session expired or was revoked. Reconnect or disconnect the account. | You were signed out of your Cadence account. Reconnect, or disconnect this Mac. |
| Conflict review, help | Synchronization stays paused until every conflict has a valid decision. | Sync stays paused until you choose a version for every conflict. |
| Conflict review, button | Apply conflict decisions | Apply choices |
| First link, headings | Account data connected / Connecting account data | Account linked / Linking your account |
| First link, done | The hosted and local copies now share one saved baseline. | This Mac and your account now have the same data. |
| First link, choice | Cadence found tracking data on this Mac. Choose one path before connecting the account. | Cadence found tracking data on this Mac. Choose what to do with it before linking. |
| First link, empty Mac | This untouched local profile is using the account data automatically. | This Mac had no tracking data, so it uses your account's data. |
| Setup guide, description | Review the Behavior, notification, timezone, and optional import steps. The guide opens existing controls without changing tracking data. | Go through the Behavior, notification, timezone and import steps again. The guide only opens controls; it changes nothing by itself. |
| Local database, path label | Exact path | Location |
| Local database, recovery sizes | Before recovery, including WAL / Current storage, including remaining recovery files / Database / WAL / shared memory / recovery files | Size before recovery / Size now, with recovery files / Database / log / shared memory / recovery files |
| Local database, recovery done | Cadence verified and reopened the repaired database. Delete only this recovery backup when you no longer need it. | Cadence checked and reopened the repaired database. Delete this recovery backup when you no longer need it. |
| Local database, recovery pending | Storage recovery has not finished. Cadence has preserved the recovery files. | Storage recovery has not finished. Cadence kept the recovery files. |
| Local database, linked Mac | Disconnect the account before restoring a raw database backup. | Disconnect your Cadence account before restoring a database backup. |
| Local database, restore help | Cadence validates the backup and protects the current database before replacement. | Cadence checks the backup and keeps a copy of the current database before replacing it. |
| App updates, purpose | Cadence checks for updates daily while open. Installation and restart always require your action. | Cadence checks for updates once a day while it is open. It installs and restarts only when you choose. |
| App updates, loading | Reading update configuration… | Checking update settings… |
| App updates, unavailable | Signed updates are not configured for this build. | This version of Cadence cannot update itself. |
| App updates, installing | Installing the signed update. Keep Cadence open. | Installing the update. Keep Cadence open. |
| App updates, unsaved changes | Save your changes before restarting, or explicitly discard your unsaved drafts. | Save your changes before restarting, or discard them. |
| App updates, discard button | Discard drafts and restart | Discard changes and restart |
| Update notice (shell bar), required | Update required to synchronize. Local tracking remains available. | Update Cadence to keep syncing. Tracking still works. |

## Kept on purpose

- "Local profile" stays: the Mac's navigation footer uses the same name.
- "Verified client" and "Unverified client" stay: the consent screen uses them, and consent
  text is out of scope. P-033 asks Ticket 246 to choose app or client for both.
- "Status unavailable", "Needs reconnection" and the other row states stay.
- Desktop Google Calendar labels such as "Calendar is unavailable in this build." stay: the
  Timeline freshness logic matches them as keys (`apps/desktop/src/calendar/timeline-freshness.ts`).
- The leave reminder phrases in `@cadence/core/services/departure-phrases` stay
  (owner-approved, `docs/NOTIFICATION_SPEC.md`, "Leave reminders").
- The Home help text and the Home lookup messages stay with P-036 and Ticket 308.
