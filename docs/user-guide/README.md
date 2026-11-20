# Cadence user guide

Cadence is a personal behavior tracker for one independent account. You define
recurring Behaviors, Cadence creates scheduled Occurrences, and you manually
mark each Occurrence as **Completed** or **Not Completed**. An Occurrence stays
**Unresolved** until you decide. **Needs decision** is only a view of prior-day
Unresolved Occurrences; it is not another stored status and Cadence does not
automatically mark an Occurrence as missed.

These guides describe the current web app and public marketing site. Control
names are written exactly as they appear in the interface.

The separate [local desktop preview notes](desktop-local.md) describe the
development build. They do not establish desktop release readiness.

## Start with the path that fits your task

The persona names below are navigation aids, not account types. Every guide is
available to every user.

### Maya: first-time private tracker

1. [Learn what Cadence stores and sign in](public-and-sign-in.md)
2. [Use first-run setup](navigation-and-setup.md#use-first-run-setup)
3. [Create a first Behavior](behaviors-and-review.md#create-a-behavior)
4. [Record an Occurrence](timeline.md#record-an-occurrence-status)

### Jordan: fast daily checker

1. [Navigate on desktop or mobile](navigation-and-setup.md#move-between-app-screens)
2. [Record daily Occurrence statuses](timeline.md#record-an-occurrence-status)
3. [Reveal more future days](timeline.md#reveal-more-future-days)
4. [Review Needs decision](timeline.md#review-needs-decision)
5. [Use the mobile navigation drawer](navigation-and-setup.md#use-the-mobile-navigation-drawer)

### Priya: reflective reviewer

1. [Read the adherence summary](behaviors-and-review.md#change-the-review-range)
2. [Open a dated review and correct a record](behaviors-and-review.md#review-and-correct-one-day)
3. [Resolve or revisit prior-day decisions](timeline.md#review-needs-decision)
4. [Archive or restore a Behavior without losing history](behaviors-and-review.md#edit-archive-or-restore-a-behavior)

### Sam: portability-focused adopter

1. [Inspect BehaviorLog and machine-readable public resources](public-and-sign-in.md#use-behaviorlog-and-machine-readable-resources)
2. [Download an export](data-portability.md#download-structured-data)
3. [Copy a task-specific analysis prompt](data-portability.md#use-an-analysis-prompt)
4. [Preview and apply an import](data-portability.md#import-a-behaviorlog-bundle)
5. [Understand restore safety](data-portability.md#restore-from-a-trusted-behaviorlog-bundle)

### Lina: reminder-dependent user

1. [Enable browser notifications on a device](reminders-and-timezone.md#enable-browser-notifications-on-this-device)
2. [Configure Behavior reminder intent and offset](reminders-and-timezone.md#configure-reminders-for-a-behavior)
3. [Confirm the account timezone](reminders-and-timezone.md#choose-and-save-a-timezone)

### Robin: privacy-conscious account owner

1. [Read Trust, Privacy, and Terms](public-and-sign-in.md#read-account-information)
2. [Control note inclusion and create a backup](data-portability.md#choose-export-options)
3. [Review account and deletion safeguards](privacy-and-account.md)

### Alex: keyboard and low-vision user

1. [Read the keyboard, zoom, focus, and touch guide](accessibility-and-mobile.md)
2. Follow the **Keyboard and mobile** notes in every task guide.
3. [Use the mobile navigation drawer](navigation-and-setup.md#use-the-mobile-navigation-drawer)
4. [Use status actions without relying on color](timeline.md#record-an-occurrence-status)

## Task guide index

- [Public site, account information, and Google sign-in](public-and-sign-in.md)
- [App navigation and first-run setup](navigation-and-setup.md)
- [Timeline, Needs decision, statuses, and Notes](timeline.md)
- [Chat: questions, Undo, Yes or No, and past conversations](chat.md)
- [Behavior setup, review, corrections, archive, and restore](behaviors-and-review.md)
- [Browser notifications, email reminder intent, and timezone](reminders-and-timezone.md)
- [Export, Markdown tools, BehaviorLog import, and restore](data-portability.md)
- [Trust links, export-before-delete, and account deletion](privacy-and-account.md)
- [Travel-routing limits and data boundaries](travel.md)
- [Keyboard, zoom, focus, touch, and non-color operation](accessibility-and-mobile.md)
- [Internal QA-only controls](internal-qa.md)

## Safety conventions used in these guides

- A draft field changes only the open form until you use its save or apply
  action.
- **Archive behavior** preserves history but removes the Behavior from active
  use after schedule repair. **Delete account** and **Apply restore** can remove
  hosted records and receive explicit warnings in their guides.
- Occurrence Notes and Behavior titles or descriptions can contain private
  text. Exports can include that text; read the option and format warnings
  before sharing a file or clipboard value.
- Browser notifications and email reminders are delivery aids, not guarantees.
  Cadence remains a manual tracker if delivery is blocked, unavailable, or
  delayed.
