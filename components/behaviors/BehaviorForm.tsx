"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { ReminderEditor } from "@/components/behaviors/ReminderEditor";
import { PlaceMarkerControl, type WhereDraft } from "@/components/travel/PlaceLabels";
import { DesktopFormDraftGuard } from "@/lib/desktop-draft";
import type {
  BehaviorActionState,
  BehaviorFormAction,
  BehaviorRecurrenceFormDefaults,
  BehaviorRecurrenceKind,
  BehaviorView,
  BehaviorWhereKind,
  CategoryOption,
} from "@/lib/types/behavior";
import {
  TIME_RANGE_PRESETS,
  TIME_RANGE_PRESET_LIST,
  type TimeRangePreset,
} from "@/lib/types/schedule";
import type { Weekday } from "@/lib/types/recurrence";

type BehaviorFormProps = Readonly<{
  mode: "create" | "edit";
  action: BehaviorFormAction;
  categories: CategoryOption[];
  behavior?: BehaviorView;
  defaultTimezone?: string;
  showActiveToggle?: boolean;
  initialState?: BehaviorActionState;
  onSuccess?: (state: BehaviorActionState) => void;
  reminderRuntime?: "web" | "desktop";
  /** Ticket 216: Where filled in from a reviewed suggestion; saving still needs the user. */
  whereDraft?: WhereDraft | null;
}>;

export type TimeEntryRow = {
  key: string;
  id: string;
  kind: "exact" | "range";
  exactTime: string;
  rangeStart: string;
  rangeEnd: string;
  rangePreset: TimeRangePreset | null;
};

export type ScheduleFormRow = {
  key: string;
  id: string;
  recurrenceDefaults: BehaviorRecurrenceFormDefaults;
  recurrenceKind: BehaviorRecurrenceKind;
  timeEntries: TimeEntryRow[];
};

const EMPTY_ACTION_STATE: BehaviorActionState = {
  status: "idle",
  message: "",
};

const DEFAULT_RECURRENCE: BehaviorRecurrenceFormDefaults = {
  kind: "daily",
  dailyInterval: 1,
  everyDays: 2,
  weeklyInterval: 1,
  weeklyDays: ["monday"],
  monthlyInterval: 1,
  monthlyDay: 1,
};

const WEEKDAY_OPTIONS: Array<{ value: Weekday; label: string }> = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];
const WHERE_OPTIONS: Array<{ value: BehaviorWhereKind | ""; label: string }> = [
  { value: "", label: "Not set" },
  { value: "anywhere", label: "Anywhere" },
  { value: "home", label: "Home" },
  { value: "place", label: "A place" },
];
const MAX_SCHEDULE_ROWS = 6;
const MAX_TIME_ENTRIES_PER_SCHEDULE = 8;
const COMPACT_UNDERLINED_FIELD_CONTROL_CLASS =
  "min-h-6 border-0 border-b border-line bg-background px-0 py-0.5 text-base text-foreground";

export function BehaviorForm({
  mode,
  action,
  categories,
  behavior,
  showActiveToggle = true,
  initialState = EMPTY_ACTION_STATE,
  onSuccess,
  reminderRuntime = "web",
  whereDraft = null,
}: BehaviorFormProps) {
  const planningId = useId();
  const [selectedCategory, setSelectedCategory] = useState(behavior?.categoryId ?? "");
  const initialPlaceText = whereDraft ? whereDraft.locationText : behavior?.whereKind === "place" ? behavior.locationText ?? "" : "";
  const [whereKind, setWhereKind] = useState<BehaviorWhereKind | "">(whereDraft?.whereKind ?? behavior?.whereKind ?? "");
  const [placeText, setPlaceText] = useState(initialPlaceText);
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const [scheduleRows, setScheduleRows] = useState<ScheduleFormRow[]>(() =>
    initialScheduleRows(behavior),
  );
  const [draftDirty, setDraftDirty] = useState(Boolean(whereDraft));
  const formRef = useRef<HTMLFormElement>(null);
  const draftRevisionRef = useRef(0);
  const submittedRevisionRef = useRef<number | null>(null);
  const submittedLocationRef = useRef<string | null>(null);

  const markDraftDirty = useCallback(() => {
    draftRevisionRef.current += 1;
    setDraftDirty(true);
  }, []);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      if (submittedRevisionRef.current === draftRevisionRef.current) {
        setDraftDirty(false);
      }
      // A changed Where withdraws cached travel estimates (web and desktop hooks listen).
      const submitted = submittedLocationRef.current;
      submittedLocationRef.current = null;
      if (submitted !== null && submitted !== whereSignature(behavior?.whereKind ?? "", behavior?.locationText ?? "") && typeof window !== "undefined") {
        window.dispatchEvent(new Event("cadence:travel-changed"));
      }
      onSuccess?.(state);
    }
  }, [behavior?.locationText, behavior?.whereKind, onSuccess, state]);

  function addScheduleRow() {
    if (scheduleRows.length >= MAX_SCHEDULE_ROWS) {
      return;
    }

    markDraftDirty();

    setScheduleRows((rows) => [
      ...rows,
      {
        key: `new-schedule-${Date.now()}-${rows.length}`,
        id: "",
        recurrenceDefaults: DEFAULT_RECURRENCE,
        recurrenceKind: "daily",
        timeEntries: [newExactTimeEntry("09:00", 0)],
      },
    ]);
  }

  function removeScheduleRow(scheduleKey: string) {
    markDraftDirty();
    setScheduleRows((rows) =>
      rows.length === 1
        ? rows
        : rows.filter((schedule) => schedule.key !== scheduleKey),
    );
  }

  function updateScheduleRow(
    scheduleKey: string,
    update: Partial<Pick<ScheduleFormRow, "recurrenceKind">>,
  ) {
    markDraftDirty();
    setScheduleRows((rows) =>
      rows.map((schedule) =>
        schedule.key === scheduleKey ? { ...schedule, ...update } : schedule,
      ),
    );
  }

  function addTimeEntry(scheduleKey: string) {
    markDraftDirty();
    setScheduleRows((rows) =>
      rows.map((schedule) => {
        if (
          schedule.key !== scheduleKey ||
          schedule.timeEntries.length >= MAX_TIME_ENTRIES_PER_SCHEDULE
        ) {
          return schedule;
        }

        return {
          ...schedule,
          timeEntries: [
            ...schedule.timeEntries,
            newExactTimeEntry(
              nextTimeEntryStart(schedule.timeEntries),
              schedule.timeEntries.length,
            ),
          ],
        };
      }),
    );
  }

  function updateTimeEntry(
    scheduleKey: string,
    entryKey: string,
    update: Partial<Omit<TimeEntryRow, "key" | "id">>,
  ) {
    markDraftDirty();
    setScheduleRows((rows) =>
      rows.map((schedule) =>
        schedule.key === scheduleKey
          ? {
              ...schedule,
              timeEntries: schedule.timeEntries.map((entry) =>
                entry.key === entryKey ? { ...entry, ...update } : entry,
              ),
            }
          : schedule,
      ),
    );
  }

  function removeTimeEntry(scheduleKey: string, entryKey: string) {
    markDraftDirty();
    setScheduleRows((rows) =>
      rows.map((schedule) =>
        schedule.key === scheduleKey && schedule.timeEntries.length > 1
          ? {
              ...schedule,
              timeEntries: schedule.timeEntries.filter(
                (entry) => entry.key !== entryKey,
              ),
            }
          : schedule,
      ),
    );
  }

  const resetFormDraft = useCallback(() => {
    draftRevisionRef.current += 1;
    submittedRevisionRef.current = null;
    setDraftDirty(false);
    setSelectedCategory(behavior?.categoryId ?? "");
    setWhereKind(behavior?.whereKind ?? "");
    setPlaceText(behavior?.whereKind === "place" ? behavior.locationText ?? "" : "");
    setScheduleRows((rows) => resetBehaviorScheduleDraft(rows, behavior));
  }, [behavior]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onChangeCapture={markDraftDirty}
      onReset={resetFormDraft}
      onSubmitCapture={(event) => {
        submittedRevisionRef.current = draftRevisionRef.current;
        const data = new FormData(event.currentTarget);
        const where = data.get("where_kind");
        const location = data.get("location_text");
        submittedLocationRef.current = whereSignature(typeof where === "string" ? where : "", typeof location === "string" ? location : "");
      }}
      className="grid gap-6"
    >
      <DesktopFormDraftGuard
        dirty={draftDirty}
        onDiscard={() => formRef.current?.reset()}
      />
      {behavior ? (
        <>
          <input type="hidden" name="behavior_id" value={behavior.id} />
          <input
            type="hidden"
            name="expected_updated_at"
            value={behavior.updatedAt}
          />
        </>
      ) : null}
      <FieldError message={fieldErrors.behavior_id} />

      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="sr-only">Behavior details</legend>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,20rem)] lg:grid-cols-[minmax(0,1fr)_minmax(14rem,24rem)]">
          <TextField
            label="Title"
            name="title"
            defaultValue={behavior?.title ?? ""}
            required
            error={fieldErrors.title}
          />

          <SelectField
            label="Category"
            labelClassName="pl-1"
            name="category_id"
            value={selectedCategory}
            onChange={setSelectedCategory}
            error={fieldErrors.category_id}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          {categories.find((category) => category.id === selectedCategory)?.description ? <p className="break-words text-sm text-muted-readable">{categories.find((category) => category.id === selectedCategory)?.description}</p> : null}
        </div>

        <DescriptionField
          defaultValue={behavior?.description ?? ""}
          error={fieldErrors.description}
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,20rem)_minmax(0,1fr)] lg:grid-cols-[minmax(14rem,24rem)_minmax(0,1fr)]">
          <SelectField
            label="Where"
            name="where_kind"
            value={whereKind}
            onChange={(value) => setWhereKind(value as BehaviorWhereKind | "")}
            error={fieldErrors.where_kind}
          >
            {WHERE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
          {whereKind === "place" ? (
            <TextField label="Place" name="location_text"
              defaultValue={initialPlaceText}
              onValueChange={setPlaceText}
              required error={fieldErrors.location_text} />
          ) : null}
        </div>
        {whereDraft ? <p className="text-sm" role="status">Where is filled in from a suggestion. Save to keep it.</p> : null}
        {whereKind === "home" ? <PlaceMarkerControl place={{ kind: "home" }} />
          : whereKind === "place" ? <PlaceMarkerControl place={{ kind: "saved_place", text: placeText }} /> : null}
        <p className="text-sm text-muted-readable">Travel estimates and scheduling advice work better when Where is set.</p>
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="mb-2 text-lg leading-tight">Schedule</legend>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1 text-sm">
            <label htmlFor={`${planningId}-duration`}>Default duration (minutes)</label>
            <input id={`${planningId}-duration`} name="default_duration_minutes"
              type="number" min={1} max={1440} step={1}
              defaultValue={behavior?.defaultDurationMinutes ?? ""}
              aria-invalid={Boolean(fieldErrors.default_duration_minutes)}
              aria-describedby={`${planningId}-duration-help`}
              className="min-h-11 min-w-0 w-full border-0 border-b border-line bg-background px-0 text-base" />
            <div id={`${planningId}-duration-help`}>
              <p className="text-muted-readable">Optional. Used for Timeline planning. Tracked time and averages stay separate.</p>
              <FieldError message={fieldErrors.default_duration_minutes} />
            </div>
          </div>
          <div className="grid min-w-0 gap-1 text-sm">
            <label htmlFor={`${planningId}-end-date`}>End date</label>
            <input id={`${planningId}-end-date`} name="end_date" type="date"
              min="0001-01-01" max="9999-12-31" defaultValue={behavior?.endDate ?? ""}
              aria-invalid={Boolean(fieldErrors.end_date)}
              aria-describedby={`${planningId}-end-date-help`}
              className="min-h-11 min-w-0 w-full border-0 border-b border-line bg-background px-0 text-base" />
            <div id={`${planningId}-end-date-help`}>
              <p className="text-muted-readable">Optional. Archives at the start of this date in the Behavior’s timezone. Cadence shows an in-app notification.</p>
              <FieldError message={fieldErrors.end_date} />
            </div>
          </div>
        </div>

        <input
          type="hidden"
          name="behavior_schedule_count"
          value={scheduleRows.length}
        />

        <div className="divide-y divide-line">
          {scheduleRows.map((schedule, index) => (
            <ScheduleRowEditor
              key={schedule.key}
              schedule={schedule}
              index={index}
              canRemoveSchedule={scheduleRows.length > 1}
              onScheduleChange={(update) =>
                updateScheduleRow(schedule.key, update)
              }
              onRemoveSchedule={() => removeScheduleRow(schedule.key)}
              onAddTime={() => addTimeEntry(schedule.key)}
              onTimeChange={(entryKey, update) =>
                updateTimeEntry(schedule.key, entryKey, update)
              }
              onRemoveTime={(entryKey) =>
                removeTimeEntry(schedule.key, entryKey)
              }
            />
          ))}
        </div>

        <div className="-mt-2 grid gap-2 text-sm">
          <button
            type="button"
            onClick={addScheduleRow}
            disabled={scheduleRows.length >= MAX_SCHEDULE_ROWS}
            className="product-action product-action-primary justify-self-start"
          >
            Add schedule
          </button>
          <FieldError message={fieldErrors.recurrence} />
          <FieldError message={fieldErrors.schedule} />
        </div>
      </fieldset>

      <div>
        <ReminderEditor
          runtime={reminderRuntime}
          browserReminderEnabled={behavior?.browserReminderEnabled ?? true}
          emailReminderEnabled={behavior?.emailReminderEnabled ?? false}
          reminderOffsetMinutes={behavior?.reminderOffsetMinutes ?? 0}
          error={fieldErrors.reminders}
        />
      </div>

      {mode === "edit" && showActiveToggle ? (
        <label className="flex min-h-12 items-center gap-3 border-b border-line py-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={behavior?.active ?? true}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Active
        </label>
      ) : null}
      {mode === "edit" && !showActiveToggle && behavior?.active ? (
        <input type="hidden" name="active" value="on" />
      ) : null}
      <FieldError message={fieldErrors.active} />

      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:gap-5">
        <SubmitButton />
        <button
          type="reset"
          className="product-action product-action-secondary min-h-11 justify-self-start py-2 text-sm"
        >
          Cancel
        </button>
        <ActionMessage state={state} onReload={() => window.location.reload()} />
      </div>
    </form>
  );
}

function ScheduleRowEditor({
  schedule,
  index,
  canRemoveSchedule,
  onScheduleChange,
  onRemoveSchedule,
  onAddTime,
  onTimeChange,
  onRemoveTime,
}: Readonly<{
  schedule: ScheduleFormRow;
  index: number;
  canRemoveSchedule: boolean;
  onScheduleChange: (
    update: Partial<Pick<ScheduleFormRow, "recurrenceKind">>,
  ) => void;
  onRemoveSchedule: () => void;
  onAddTime: () => void;
  onTimeChange: (
    entryKey: string,
    update: Partial<Omit<TimeEntryRow, "key" | "id">>,
  ) => void;
  onRemoveTime: (entryKey: string) => void;
}>) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(9rem,12rem)_minmax(9rem,1fr)_minmax(18rem,1.4fr)] lg:items-start lg:gap-3">
      <input
        type="hidden"
        name={`behavior_schedule_id_${index}`}
        value={schedule.id}
      />

      <label className="grid gap-1 text-sm lg:flex lg:min-h-8 lg:items-center lg:gap-3">
        <span className="shrink-0">Recurrence</span>
        <select
          name={`schedule_${index}_recurrence_kind`}
          value={schedule.recurrenceKind}
          onChange={(event) =>
            onScheduleChange({
              recurrenceKind: event.currentTarget.value as BehaviorRecurrenceKind,
            })
          }
          className="min-h-8 min-w-0 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground lg:flex-1"
        >
          <option value="daily">Daily</option>
          <option value="every_days">Every few days</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

      <RecurrenceDetailFields schedule={schedule} index={index} />

      <div className="grid gap-3">
        <span className="sr-only">Times</span>
        <input
          type="hidden"
          name={`schedule_${index}_time_entry_count`}
          value={schedule.timeEntries.length}
        />
        <div className="grid gap-2">
          {schedule.timeEntries.map((entry, entryIndex) => (
            <TimeEntryEditor
              key={entry.key}
              scheduleIndex={index}
              entryIndex={entryIndex}
              entry={entry}
              canRemove={schedule.timeEntries.length > 1}
              onChange={(update) => onTimeChange(entry.key, update)}
              onRemove={() => onRemoveTime(entry.key)}
            />
          ))}
        </div>
        <div className="justify-self-start text-xs">
          <button
            type="button"
            onClick={onAddTime}
            disabled={schedule.timeEntries.length >= MAX_TIME_ENTRIES_PER_SCHEDULE}
            className="product-action product-action-primary"
          >
            Add time
          </button>
        </div>
        {canRemoveSchedule ? (
          <div className="justify-self-start text-xs">
            <button
              type="button"
              onClick={onRemoveSchedule}
              className="product-action product-action-danger"
            >
              Remove schedule
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecurrenceDetailFields({
  schedule,
  index,
}: Readonly<{
  schedule: ScheduleFormRow;
  index: number;
}>) {
  const prefix = `schedule_${index}`;
  const defaults = schedule.recurrenceDefaults;

  if (schedule.recurrenceKind === "weekly") {
    return (
      <div className="grid gap-3">
        <NumberField
          label="Every"
          name={`${prefix}_weekly_interval`}
          defaultValue={defaults.weeklyInterval}
          suffix="weeks"
        />
        <div className="grid gap-2">
          <span className="text-sm text-foreground">On</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {WEEKDAY_OPTIONS.map((weekday) => (
              <label
                key={weekday.value}
                className="inline-flex min-h-8 items-center gap-1.5 py-1 pr-2 text-sm"
              >
                <input
                  type="checkbox"
                  name={`${prefix}_weekly_days`}
                  value={weekday.value}
                  defaultChecked={defaults.weeklyDays.includes(weekday.value)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {weekday.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (schedule.recurrenceKind === "monthly") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <NumberField
          label="Every"
          name={`${prefix}_monthly_interval`}
          defaultValue={defaults.monthlyInterval}
          suffix="months"
        />
        <NumberField
          label="Day"
          name={`${prefix}_monthly_day`}
          defaultValue={defaults.monthlyDay}
          max={31}
        />
      </div>
    );
  }

  if (schedule.recurrenceKind === "every_days") {
    return (
      <NumberField
        label="Every"
        name={`${prefix}_every_days`}
        defaultValue={defaults.everyDays}
        suffix="days"
      />
    );
  }

  return (
    <NumberField
      label="Every"
      name={`${prefix}_daily_interval`}
      defaultValue={defaults.dailyInterval}
      suffix="days"
    />
  );
}

function TimeEntryEditor({
  scheduleIndex,
  entryIndex,
  entry,
  canRemove,
  onChange,
  onRemove,
}: Readonly<{
  scheduleIndex: number;
  entryIndex: number;
  entry: TimeEntryRow;
  canRemove: boolean;
  onChange: (update: Partial<Omit<TimeEntryRow, "key" | "id">>) => void;
  onRemove: () => void;
}>) {
  const prefix = `schedule_${scheduleIndex}_time_entry`;
  const rangePresetValue = entry.rangePreset ?? "custom";

  return (
    <div className="grid gap-2 text-sm">
      <input
        type="hidden"
        name={`${prefix}_id_${entryIndex}`}
        value={entry.id}
      />

      <div className="grid gap-2 sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]">
        <select
          name={`${prefix}_kind_${entryIndex}`}
          value={entry.kind}
          aria-label={`Schedule ${scheduleIndex + 1}, time ${entryIndex + 1} mode`}
          onChange={(event) => {
            const nextKind = event.currentTarget.value as TimeEntryRow["kind"];

            if (nextKind === "range") {
              const defaultPreset = TIME_RANGE_PRESETS.morning;

              onChange({
                kind: "range",
                rangePreset: defaultPreset.preset,
                rangeStart: defaultPreset.startTime,
                rangeEnd: defaultPreset.endTime,
              });
              return;
            }

            onChange({ kind: "exact", rangePreset: null });
          }}
          className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
        >
          <option value="exact">Exact time</option>
          <option value="range">Time range</option>
        </select>

        {entry.kind === "exact" ? (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-2][0-9]:[0-5][0-9]"
            placeholder="HH:MM"
            name={`${prefix}_exact_time_${entryIndex}`}
            value={entry.exactTime}
            required
            onChange={(event) =>
              onChange({ exactTime: event.currentTarget.value })
            }
            aria-label="Exact time"
            className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
          />
        ) : (
          <div className="grid gap-2">
            <select
              name={`${prefix}_range_preset_${entryIndex}`}
              value={rangePresetValue}
              onChange={(event) => {
                const preset = event.currentTarget.value;

                if (!isTimeRangePresetValue(preset)) {
                  onChange({ rangePreset: null });
                  return;
                }

                const definition = TIME_RANGE_PRESETS[preset];

                onChange({
                  rangePreset: preset,
                  rangeStart: definition.startTime,
                  rangeEnd: definition.endTime,
                });
              }}
              aria-label="Time range"
              className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
            >
              <option value="custom">Custom range</option>
              {TIME_RANGE_PRESET_LIST.map((preset) => (
                <option key={preset.preset} value={preset.preset}>
                  {preset.label}
                </option>
              ))}
            </select>

            {entry.rangePreset ? null : (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  placeholder="Start HH:MM"
                  name={`${prefix}_range_start_${entryIndex}`}
                  value={entry.rangeStart}
                  required
                  onChange={(event) =>
                    onChange({
                      rangeStart: event.currentTarget.value,
                      rangePreset: null,
                    })
                  }
                  aria-label="Range start"
                  className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  placeholder="End HH:MM"
                  name={`${prefix}_range_end_${entryIndex}`}
                  value={entry.rangeEnd}
                  required
                  onChange={(event) =>
                    onChange({
                      rangeEnd: event.currentTarget.value,
                      rangePreset: null,
                    })
                  }
                  aria-label="Range end"
                  className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="product-action product-action-secondary justify-self-start text-[11px] leading-4"
        >
          Remove time
        </button>
      ) : null}
    </div>
  );
}

// Location text only counts for A place, matching the form parser.
function whereSignature(whereKind: string, locationText: string): string {
  return whereKind === "place" ? `place:${locationText.trim()}` : whereKind;
}

function TextField({
  label,
  name,
  defaultValue,
  required = false,
  error,
  onValueChange,
}: Readonly<{
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  error?: string;
  onValueChange?: (value: string) => void;
}>) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        required={required}
        onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
        aria-invalid={error ? "true" : undefined}
        className={COMPACT_UNDERLINED_FIELD_CONTROL_CLASS}
      />
      <FieldError message={error} />
    </label>
  );
}

function DescriptionField({
  defaultValue,
  error,
}: Readonly<{
  defaultValue: string;
  error?: string;
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [defaultValue]);

  return (
    <label className="grid gap-1 text-sm">
      <span>Description</span>
      <textarea
        ref={textareaRef}
        name="description"
        defaultValue={defaultValue}
        rows={1}
        aria-invalid={error ? "true" : undefined}
        onInput={(event) => resizeTextarea(event.currentTarget)}
        className={`${COMPACT_UNDERLINED_FIELD_CONTROL_CLASS} resize-none overflow-hidden`}
      />
      <FieldError message={error} />
    </label>
  );
}

function SelectField({
  label,
  labelClassName,
  controlClassName = COMPACT_UNDERLINED_FIELD_CONTROL_CLASS,
  name,
  defaultValue,
  value,
  onChange,
  error,
  children,
}: Readonly<{
  label: string;
  labelClassName?: string;
  controlClassName?: string;
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  children: ReactNode;
}>) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className={labelClassName}>{label}</span>
      <select
        name={name}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        aria-invalid={error ? "true" : undefined}
        className={`min-w-0 max-w-full ${controlClassName}`}
      >
        {children}
      </select>
      <FieldError message={error} />
    </label>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
  suffix,
  max = 999,
}: Readonly<{
  label: string;
  name: string;
  defaultValue: number;
  suffix?: string;
  max?: number;
}>) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-sm">
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="number"
          name={name}
          defaultValue={defaultValue}
          min={1}
          max={max}
          step={1}
          className="min-h-8 w-16 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
        />
        {suffix ? <span className="break-words text-sm text-muted-readable">{suffix}</span> : null}
      </span>
    </label>
  );
}

function FieldError({ message }: Readonly<{ message?: string }>) {
  if (!message) {
    return null;
  }

  return (
    <span className="text-sm leading-6 text-accent" role="alert">
      {message}
    </span>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="product-action product-action-primary min-h-11 py-2 text-sm font-bold"
    >
      {pending ? "Saving..." : "Save behavior"}
    </button>
  );
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function ActionMessage({
  state,
  onReload,
}: Readonly<{
  state: BehaviorActionState;
  onReload: () => void;
}>) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      className={[
        "border-t border-line pt-2 text-sm leading-6 sm:border-t-0 sm:pt-0",
        state.status === "success" ? "text-foreground" : "text-accent",
      ].join(" ")}
      role={state.status === "error" ? "alert" : "status"}
    >
      <p>{state.message}</p>
      {state.conflict ? (
        <button
          type="button"
          onClick={onReload}
          className="product-action product-action-secondary min-h-11 py-2 text-sm"
        >
          Reload behavior
        </button>
      ) : null}
    </div>
  );
}

function initialScheduleRows(behavior?: BehaviorView): ScheduleFormRow[] {
  const schedules = behavior?.schedules ?? [];

  if (schedules.length === 0) {
    return [
      {
        key: "schedule-0",
        id: "",
        recurrenceDefaults: behavior?.recurrenceDefaults ?? DEFAULT_RECURRENCE,
        recurrenceKind: behavior?.recurrenceDefaults.kind ?? "daily",
        timeEntries: [
          newExactTimeEntry(behavior?.scheduledTime ?? "09:00", 0),
        ],
      },
    ];
  }

  return schedules.map((schedule, index) => ({
    key: schedule.id || `schedule-${index}`,
    id: schedule.id,
    recurrenceDefaults: schedule.recurrenceDefaults,
    recurrenceKind: schedule.recurrenceDefaults.kind,
    timeEntries: schedule.timeEntries.map((entry, entryIndex) => {
      if (entry.kind === "range") {
        return {
          key: entry.id || `entry-${index}-${entryIndex}`,
          id: entry.id,
          kind: "range",
          exactTime: "09:00",
          rangeStart: entry.startTime,
          rangeEnd: entry.endTime ?? nextHalfHour(entry.startTime),
          rangePreset: entry.preset,
        };
      }

      return {
        key: entry.id || `entry-${index}-${entryIndex}`,
        id: entry.id,
        kind: "exact",
        exactTime: entry.startTime,
        rangeStart: entry.startTime,
        rangeEnd: nextHalfHour(entry.startTime),
        rangePreset: null,
      };
    }),
  }));
}

export function resetBehaviorScheduleDraft(
  _currentRows: readonly ScheduleFormRow[],
  behavior?: BehaviorView,
): ScheduleFormRow[] {
  return initialScheduleRows(behavior);
}

function newExactTimeEntry(time: string, index: number): TimeEntryRow {
  return {
    key: `new-entry-${Date.now()}-${index}`,
    id: "",
    kind: "exact",
    exactTime: time,
    rangeStart: time,
    rangeEnd: nextHalfHour(time),
    rangePreset: null,
  };
}

function nextTimeEntryStart(entries: TimeEntryRow[]): string {
  const lastEntry = entries.at(-1);

  if (!lastEntry) {
    return "09:00";
  }

  return nextHalfHour(
    lastEntry.kind === "exact" ? lastEntry.exactTime : lastEntry.rangeStart,
  );
}

function nextHalfHour(time: string): string {
  const [hourValue = "0", minuteValue = "0"] = time.split(":");
  const totalMinutes =
    Number(hourValue) * 60 + Number(minuteValue) + 30;
  const normalized = totalMinutes % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isTimeRangePresetValue(value: string): value is TimeRangePreset {
  return TIME_RANGE_PRESET_LIST.some((preset) => preset.preset === value);
}
