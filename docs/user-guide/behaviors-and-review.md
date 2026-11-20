# Behaviors, schedules, review, and archive

The Behaviors screen combines recurring Behavior setup with a sparse adherence
review. A **Behavior** is the recurring thing you track. An **Occurrence** is
one dated, scheduled instance of that Behavior.

## Change the review range

**Prerequisites:** You are signed in and Behaviors has loaded.

1. In **Overall adherence**, choose **7 days**, **30 days**, or **90 days**.
2. Confirm the selected date range under the adherence percentage.
3. Read the status counts and calendar legend. Default adherence excludes
   Unresolved Occurrences.

**Result and persistence:** Cadence updates the `range` query and recalculates
the overall summary, heatmaps, category counts, and per-Behavior rows. A valid
selected Behavior day remains selected. This is a view change, not a data
write.

When a Behavior has recorded timing in the selected range, its outcome metadata
also shows **Average tracked time**. Cadence sums stopped sessions for each
Occurrence, then averages only Occurrences with recorded totals. Untimed and
running-only Occurrences do not affect the average. Cadence hides the line when
the range has no recorded total.

**Recovery or undo:** Choose another range. Unsupported URL range values return
to the default range.

**Privacy and safety:** Review data comes from your stored records. Avoid
sharing a screenshot when Behavior names or Notes are sensitive. Unresolved is
neutral and excluded from final adherence.

**Keyboard and mobile:** The range links expose the current selection as the
current page state. Use Tab and Enter. Calendar labels, percentages, and status
names supplement color; at high zoom, summary and calendar content stack.

## Review and correct one day

**Prerequisites:** An active Behavior has at least one non-empty cell in its
Behavior calendar.

1. In the specific Behavior row, activate a non-empty calendar cell. The
   accessible label ends with **open day review**. The overall calendar is
   passive and cannot open this review.
2. In **Review selected day**, read **Date of behavior**,
   **Time of behavior**, conditional **Tracked time**, **Status**, and **Note**
   for each Occurrence. A running-only session shows **In progress**. A stopped
   total shows its recorded duration. Both labels appear when both states exist.
3. Choose **Review** on the Occurrence you want to inspect.
4. Under **Change status**, choose **Completed** or **Not Completed**. For an
   already resolved Occurrence, choose **Clear decision** to return it to
   Unresolved.
5. To edit the Occurrence Note, change **Note** and choose **Save note**.
6. When timing data exists, choose **Reset tracked time** inside the same
   **Review** disclosure to delete every timing session for that Occurrence.

**Result and persistence:** Selecting the day changes the `behavior` and `day`
query values and renders the review in the owning Behavior row. Opening
**Review** changes only disclosure state. A status choice atomically updates
the snapshot and status history, then refreshes metrics. **Clear decision**
records a correction back to Unresolved and permits reminder planning through
normal service rules. **Save note** changes only the Note. **Reset tracked
time** deletes only timing sessions, then refreshes Behaviors and Timeline. It
does not change Status or Note.

**Recovery or undo:** Empty calendar cells are passive. Invalid URL selections
do not render an empty review panel. Correct a status with another explicit
status choice. After **Clear decision**, choose **Completed** or
**Not Completed** if you cleared it accidentally. If a save fails, Cadence
shows an error and preserves the stored record. Resetting removes the recorded
timing sessions. Start a new Timeline timer if the reset was accidental.

**Privacy and safety:** Clearing a prior-day decision may make the Occurrence
eligible for **Needs decision** and may allow a future reminder to be planned
under current settings. Date and time are display-only in this review; the
review does not reschedule the Occurrence.

**Keyboard and mobile:** Non-empty calendar cells are links; focus and press
Enter. Empty cells are not interactive. Focus **Review** and press Enter or
Space to open the native disclosure. Status text, counts, diagonal partial
marks, and labels communicate meaning without color alone.

## Open the create form

**Prerequisites:** You are on Behaviors.

1. Choose the **Create behavior** disclosure. It may already be open when no
   active Behavior exists.
2. Activate the same disclosure again to close it without saving.

**Result and persistence:** Only disclosure state changes. Reopening clears
prior success copy. No product record is created until **Save behavior**
succeeds.

**Recovery or undo:** Close the disclosure to leave the draft. Reopen it to
start or continue with the currently mounted form state.

**Privacy and safety:** Draft text is visible on screen but is not stored by
Cadence until save.

**Keyboard and mobile:** Focus **Create behavior** and press Enter or Space.
The form stacks on narrow screens and remains in normal document order.

## Create a Behavior

**Prerequisites:** Open **Create behavior**. Confirm the account timezone first
if the schedule must use a timezone other than the saved profile timezone.

1. Enter the required **Title**. Optionally enter **Description** and choose a
   **Category** or **No category**.
2. Configure at least one schedule using
   [Build schedules and times](#build-schedules-and-times).
3. Review **Browser notifications**, **Email reminder**, and
   **Reminder offset**. See
   [Configure reminders for a Behavior](reminders-and-timezone.md#configure-reminders-for-a-behavior).
4. Choose **Save behavior**.
5. Confirm that the form closes and the new Behavior row appears.

**Result and persistence:** A successful save atomically creates the owned
Behavior, its initial definition-history event, schedules, and time entries,
then marks the Occurrence horizon for repair. Future Occurrences appear through
the normal synchronization path. Browser reminder intent defaults on; email
reminder intent defaults off.

**Recovery or undo:** Required-field or server errors stay with the form and no
partial Behavior graph is created. Correct the named fields and submit again.
To discard native field edits without writing, choose **Cancel**. To remove a
created Behavior from active use, archive it; archive preserves its history.

**Privacy and safety:** Title and Description are hosted account data and are
included in full JSON and BehaviorLog exports, including definition history.
Do not use Cadence as a medication dosing, refill, emergency, or clinical
decision system.

**Keyboard and mobile:** Every field has a text label. Use Tab through the
draft and Space for checkboxes. On mobile, schedule controls stack; review all
rows before saving because the submit action follows the complete schedule.

## Build schedules and times

**Prerequisites:** A create or **Details and Settings** form is open.

1. For each schedule, choose a **Recurrence**:
   - **Daily** uses the **Every** days value.
   - **Every few days** uses an **Every** days interval.
   - **Weekly** uses **Every** weeks plus one or more weekday checkboxes:
     **Mon**, **Tue**, **Wed**, **Thu**, **Fri**, **Sat**, and **Sun**.
   - **Monthly** uses **Every** months and **Day** from 1 through 31. If that
     day does not exist in a month, Cadence uses the month's last day.
2. For each time entry, choose **Exact time** or **Time range**.
3. For **Exact time**, enter `HH:MM` in **Exact time**.
4. For **Time range**, choose **Morning**, **Afternoon**, **Evening**,
   **Night**, or **Custom range**. For a custom range, fill **Range start** and
   **Range end** in `HH:MM` form.
5. Choose **Add time** to add another time under the same recurrence. Choose
   **Remove time** to remove one when the schedule has more than one.
6. Choose **Add schedule** to add another recurrence pattern. Choose
   **Remove schedule** when more than one schedule exists.

**Result and persistence:** These controls change only the client draft until
**Save behavior**. One Behavior can have up to six schedule rows, and one
schedule can have up to eight time entries. At those limits the add control is
disabled. Saving creates one Occurrence for each matching schedule time, with
overlapping identical generated slots deduplicated.

**Recovery or undo:** The last schedule and the last time in a schedule cannot
be removed because at least one of each is required. Server validation rejects
missing weekdays, invalid intervals, invalid days, malformed times, or a custom
range whose end is not after its start. Correct the field and resubmit. Choose
**Cancel** to discard every unsaved schedule and time-row change and restore
the draft that was present when the form opened.

**Privacy and safety:** Times are interpreted in the Behavior's saved timezone.
Changing a schedule later affects future Unresolved Occurrences after repair;
it does not rewrite past or resolved history.

**Keyboard and mobile:** Selects, number fields, checkboxes, and action buttons
work in Tab order. Use arrow keys inside selects and number fields and Space on
weekday checkboxes. At high zoom or on mobile, recurrence, detail, and time
columns stack; labels remain adjacent to their fields.

## Save, reset, or update a Behavior draft

**Prerequisites:** A create or edit form is open.

1. Change **Title**, **Description**, **Category**, schedules, time entries, or
   reminder fields.
2. Choose **Save behavior** to persist the current valid draft.
3. Choose **Cancel** to discard the complete draft without a server write.

**Result and persistence:** In create mode, **Save behavior** creates the
Behavior as described above. In edit mode, it atomically updates the owned
Behavior graph, appends a definition-history event when Title or Description
changed, and marks the Occurrence horizon for repair. **Cancel** performs no
server action and restores identity, reminder, recurrence, schedule, and time
fields to the form's initial draft.

**Recovery or undo:** A validation or service error preserves the last stored
Behavior and shows field or form errors. Correct the draft and resubmit, or use
**Cancel** to discard all unsaved edits. Re-enter intended edits before saving.

**Privacy and safety:** Saving Title or Description creates durable history
that is included in full JSON and BehaviorLog exports. Review sensitive text
before save. Reminder edits can replan future reminders.

**Keyboard and mobile:** **Save behavior** and **Cancel** are reachable after
the form fields. Enter from a text field may submit in some browsers; use Tab
to the explicit action when you need to review the whole draft first.

## Edit, archive, or restore a Behavior

**Prerequisites:** At least one active or archived Behavior exists.

1. On an active row, open **Details and Settings**. The edit form mounts after
   the first open.
2. Edit fields and choose **Save behavior**, or choose **Cancel** to avoid a
   server write.
3. Optionally enter an **Archive note** explaining why tracking is ending.
   To remove the Behavior from active use, choose **Archive behavior** at the
   end of the active row's settings.
4. At the bottom of the screen, open **Archived behaviors (n)**. This
   disclosure is available even when the count is zero.
5. On an archived row, choose **Restore** to return it to active use. You can
   also open its **Details and Settings** disclosure to inspect or edit it.

**Result and persistence:** Opening disclosures does not write data.
**Archive behavior** or **Restore** commits the durable active-state change and
an Occurrence/reminder graph retry marker together. Archive marks the Behavior
inactive and preserves historical data; Restore marks it active again.
Immediate graph repair is best-effort. If it cannot finish, the committed
marker keeps the repair eligible for background retry.

**Recovery or undo:** Archive has no confirmation dialog. If it was accidental,
open **Archived behaviors (n)** and choose **Restore**. A failed archive or
restore transaction shows an error and preserves both the prior active state
and prior retry state. Once the transaction commits, a later repair failure
does not reverse the active-state change; reload to confirm the state while
Cadence retains the retry marker. If the archive count is zero, the disclosure
shows **No archived behaviors.**

**Privacy and safety:** Archive is reversible but materially changes future
tracking and reminders. It does not delete history. Review the Behavior title
before activating **Archive behavior**, especially when multiple rows are
nearby.

**Keyboard and mobile:** Native disclosures open with Enter or Space. Archive
and Restore are text-labeled buttons and do not rely on color. On mobile, the
archive action follows the entire edit form; confirm the row heading before
submitting.

## Categories and list controls

In Settings, use Add category or Edit to enter a name and optional description.
Save category applies the change. Cancel discards the draft. Move up and Move
down change the category order. Default categories use the same controls.
Names must be unique within your account after trimming and ignoring ASCII case.
Names allow 120 characters; descriptions allow 2,000 characters.

Delete category shows the affected active and archived Behavior counts.
Confirm the checkbox and select Delete category to move those Behaviors to
No category. Behaviors, Occurrences, and history remain saved.
If assignments change during review, cancel and reopen the editor before retrying.

On Behaviors, Category selects All categories, No category, or one category.
Sort selects Scheduled time, Name A–Z, or Category. Both controls affect active
and archived lists. Overall adherence keeps its account-wide scope.
Clear filters restores All categories and Scheduled time. Unsaved Behavior and
Note drafts stay available when their rows are temporarily hidden.
Controls survive in-screen refreshes; leaving Behaviors or reloading may reset them.


## Review archive notes

Open **Archived behaviors**, then the Behavior's details. **Archive history**
shows each recorded archive date and its optional note. Change the text and
choose **Save note**, or choose **Remove note** to clear it. Cadence retains the
archive entry when its text is removed. Notes can contain up to 2,000 characters.

Restore preserves archive history. Archiving again adds another entry without
replacing earlier notes. Archives made before this feature have no recorded
archive notes. Failed saves preserve your draft. If another copy changed the
Behavior, reload the Behavior before retrying your correction.

Archive notes sync with the account when linked and work offline on desktop.
They appear in Full JSON and BehaviorLog exports when **Include Notes** is on.
Turn that option off to omit their text from an export. The fields have visible
labels and support keyboard input; controls wrap on narrow screens.


## Default duration and end date

Default duration (minutes) is optional. Enter a whole number from 1 to 1,440. Timeline uses this value for planning while your tracked time and measured averages stay separate. Clear it to return to the measured estimate.

End date is optional. Cadence archives the Behavior at the start of that date in its timezone. No Occurrences are scheduled on that date or later. The end date must come after today, so the Behavior's last day is the day before it. Your history stays available under Archived behaviors. Cadence shows an in-app archive notification, including when you return after being offline. Desktop catches up when it opens or resumes. Restoring clears an expired end date.
