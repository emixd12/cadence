type ReminderEditorProps = Readonly<{
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
  error?: string;
  runtime?: "web" | "desktop";
  /** False for a Behavior with no fixed schedule: the offset is kept but not shown. */
  showOffset?: boolean;
}>;

const COMPACT_UNDERLINED_FIELD_CONTROL_CLASS =
  "min-h-6 border-0 border-b border-line bg-background px-0 py-0.5 text-base text-foreground";

export function ReminderEditor({
  browserReminderEnabled,
  emailReminderEnabled,
  reminderOffsetMinutes,
  error,
  runtime = "web",
  showOffset = true,
}: ReminderEditorProps) {
  return (
    <fieldset className="grid gap-3 border-0 p-0">
      <legend className="mb-1 text-lg leading-tight">Reminders</legend>

      <div className="grid gap-2">
        <div
          className={
            runtime === "desktop"
              ? "grid gap-2 lg:grid-cols-[max-content_minmax(16rem,1fr)] lg:items-center lg:gap-x-5"
              : "grid gap-2 lg:grid-cols-[max-content_max-content_minmax(16rem,1fr)] lg:items-center lg:gap-x-5"
          }
        >
          <label className="flex min-h-11 items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              name="browser_reminder"
              defaultChecked={browserReminderEnabled}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {runtime === "desktop"
              ? "Native reminders"
              : "Browser notifications"}
          </label>

          {runtime === "desktop" ? (
            <input
              type="hidden"
              name="email_reminder"
              value={emailReminderEnabled ? "on" : ""}
            />
          ) : (
            <label className="flex min-h-11 items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                name="email_reminder"
                defaultChecked={emailReminderEnabled}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Email reminder
            </label>
          )}

          {showOffset ? (
          <label className="grid gap-1 text-sm lg:ml-auto lg:flex lg:min-h-11 lg:w-full lg:items-center lg:gap-3">
            <span className="shrink-0">Reminder offset</span>
            <select
              name="reminder_offset"
              defaultValue={String(reminderOffsetMinutes)}
              className={`${COMPACT_UNDERLINED_FIELD_CONTROL_CLASS} lg:min-w-0 lg:flex-1`}
            >
              <option value="0">At scheduled start</option>
              <option value="15">15 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
              <option value="4320">3 days before</option>
            </select>
          </label>
          ) : (
            <input type="hidden" name="reminder_offset" value={String(reminderOffsetMinutes)} />
          )}
        </div>

        <p className="text-sm leading-6 text-muted-readable">
          {runtime === "desktop" ? (
            <>
              Native reminders require macOS notification permission and
              verified reminder coverage. Tracking works without notification
              permission. Email reminder intent is preserved but email delivery
              is unavailable in the local profile.
            </>
          ) : (
            <>
              Browser reminders use devices that are enabled in Settings. If
              this device is not enabled or browser notifications are blocked,
              the behavior is still tracked.
            </>
          )}
        </p>
      </div>

      {error ? (
        <p className="border-t border-line pt-3 text-sm leading-6 text-accent">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
