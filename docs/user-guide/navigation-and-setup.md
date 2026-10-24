# App navigation and first-run setup

The authenticated app has four primary screens: **Timeline**, **Behaviors**,
**Export & Import**, and **Settings**. Timeline is the default screen after
sign-in.

## Move between app screens

**Prerequisites:** You are signed in to Cadence.

1. Choose **Timeline** for current and future Occurrences plus
   **Needs decision**.
2. Choose **Behaviors** to create or edit Behaviors, review adherence, inspect a
   dated record, archive, or restore.
3. Choose **Export & Import** for downloads, AI-readable Markdown, BehaviorLog
   import, and restore.
4. Choose **Settings** for the profile timezone, this device's browser
   notifications, optional Google Calendar controls when configured, public
   account information, and account deletion.
5. In the expanded desktop rail or mobile navigation, choose the **Cadence**
   brand, whose accessible name is **Open Timeline**, to return to Timeline.
6. Choose the account row, whose accessible name is
   **Open account settings**, to open Settings.

**Result and persistence:** Navigation loads the selected protected route. It
does not change Behavior or Occurrence data. If the session is no longer valid,
Cadence sends you to sign-in and preserves a safe requested route.

**Recovery or undo:** Use another primary navigation item or the browser Back
action. If redirected to sign-in, authenticate again rather than repeatedly
submitting an action from a stale page.

**Privacy and safety:** The account row can show the account name or email.
Avoid leaving the app visible on a shared device.

**Keyboard and mobile:** Tab to a navigation item and press Enter. The current
screen is exposed as the current page, not by color alone. On mobile, first
open the navigation drawer as described below.

## Collapse or expand the desktop rail

**Prerequisites:** Use a viewport at least 1024 pixels wide.

1. In the expanded rail, choose **Collapse navigation**.
2. In the collapsed rail, primary destinations remain available as icons with
   accessible names and hover titles.
3. To expand the rail again, choose **Expand navigation** in the top 64px
   cell. It expands the rail without changing the current screen.

**Result and persistence:** Cadence stores the open or collapsed preference in
browser local storage when available. The preference applies only to this
browser profile. If storage is unavailable, the rail still changes for the
current page session.

**Recovery or undo:** Activate the opposite rail state. Clear the site's local
storage only if you intentionally want to remove the saved preference and
other local-only Cadence preferences.

**Privacy and safety:** The rail preference contains no Behavior record, but
clearing all site data may also clear the authentication session.

**Keyboard and mobile:** **Collapse navigation** and **Expand navigation** are
keyboard-operable. Labels remain available to assistive technology when the
rail is visually collapsed. Reduced-motion settings remove the width
transition. Mobile does not use this collapsed rail.

## Use the mobile navigation drawer

**Prerequisites:** Use a viewport below 1024 pixels wide.

1. Choose **Open navigation** in the sticky header. You can also swipe right
   from the first 20 pixels of the viewport edge.
2. Choose a destination in the drawer. Selecting **Timeline**, **Behaviors**,
   **Export & Import**, **Settings**, the **Cadence** brand, or the account row
   closes the drawer as navigation begins.
3. Without navigating, close the drawer with **Close navigation**, Escape, the
   shaded backdrop, or a left swipe while the drawer is open.

**Result and persistence:** Opening the drawer locks background scrolling and
keeps keyboard focus inside the drawer. Closing it unlocks scrolling and, when
the page did not change, restores the prior focus. Drawer state is not stored.

**Recovery or undo:** If a short or mostly vertical swipe is ignored, use
**Open navigation** or **Close navigation**. If focus appears lost after a route
change, move to the new page's first control with Tab or use the browser's
landmark navigation.

**Privacy and safety:** Opening or closing the drawer does not write product
data.

**Keyboard and mobile:** Escape closes the drawer. Tab and Shift+Tab cycle
within it while open. The drawer is 60% of the viewport width, so long account
labels may truncate without changing their accessible name. Touch swipes need
to be horizontal and at least about 48 pixels.

## Use first-run setup

**Prerequisites:** You are on Timeline, one or more required launch setup items
are incomplete, and this browser has not dismissed the setup pop-up.

1. In **Set up Cadence**, review these rows:
   - **Create first behavior**: choose **Create behavior** or
     **Open behaviors**.
   - **Browser notifications**: choose **Open settings**.
   - **Timezone**: choose **Review timezone**.
   - **Import existing records**: optionally choose **Open import**.
   - **Home and travel**: optionally choose **Open travel** to save Home and
     usual travel. This row appears only where travel routing is configured.
2. Complete each task on its owning screen. The setup row only navigates; it
   never performs the underlying action automatically.
3. To hide the pop-up without completing the remaining tasks, use the icon
   control named **Dismiss setup** or choose **Skip setup**.

**Result and persistence:** Task links navigate to
`/behaviors#create-behavior`, `/settings#notifications`,
`/settings#timezone`, `/export#behaviorlog-import`, or `/settings#travel`.
Saving Home and usual travel sends nothing to Google, asks for no location and
does not turn on travel estimates. Dismissing the pop-up
stores a local `cadence-first-run-dismissed` preference when browser storage is
available. Completing required tasks causes the pop-up to stop appearing based
on current account and device state. Import and Home and travel are optional.

**Recovery or undo:** A dismissed pop-up has no in-app restore control. You can
still open every task directly from **Behaviors**, **Settings**, or
**Export & Import**. Removing the `cadence-first-run-dismissed` local-storage
entry restores the prompt without changing hosted data. Using the browser's
broader **Clear site data** action may also remove other preferences and the
authentication session.

**Privacy and safety:** No notification permission is requested when the
pop-up loads. **Open settings** only navigates; the browser prompt appears only
after you activate **Enable notifications on this device**. A blocked or
unsupported notification decision does not prevent tracking.

**Keyboard and mobile:** The pop-up is non-modal, so Tab can move between it and
the page. On a small screen it sits below the sticky header and scrolls when
needed. Status text such as **Done**, **Start here**, **Enabled**, **Blocked**,
**Confirmed**, **Review**, or **Optional** communicates state without color
alone.
