"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useState } from "react";

import type { PeriodDataStore } from "@cadence/core/data-store";
import { noticeText } from "@cadence/core/notices";
import { resolvePeriodAdherence } from "@cadence/core/resolvers/analytics.resolver";
import {
  PERIOD_MESSAGES,
  attachTimelinePeriods,
  periodLabelSuggestions,
  periodsNewestFirst,
  resolvePeriodNoteShortcuts,
  toPeriodView,
  type PeriodRecord,
} from "@cadence/core/resolvers/period.resolver";
import {
  PERIOD_CONFLICT_MESSAGE,
  createPeriod,
  deletePeriod,
  endPeriod,
  savePeriodNote,
  updatePeriod,
} from "@cadence/core/services/period.service";

import { PeriodDayControls, PeriodList } from "@/components/periods/PeriodControl";
import { DayNoteControl } from "@/components/timeline/DayNoteControl";
import type { PeriodActionState, PeriodActions, PeriodFormAction, PeriodNoticeId } from "@/lib/types/period";
import type { OccurrenceFormAction } from "@/lib/types/timeline";

// Ticket 369. Synthetic Periods held in this component; nothing is stored. The fake
// actions run the real Period resolver and services against an in-memory store, so
// validation, End today and the revision check behave as they do in the app. The
// label "Conflict" always answers with the conflict notice.

const TODAY = "2026-11-09";
const BENCH_NOW = Temporal.Instant.from("2026-11-09T17:00:00Z");
const DAYS = [
  { localDate: "2026-11-09", relative: "Today", label: "Monday, November 9" },
  { localDate: "2026-11-10", relative: "Tomorrow", label: "Tuesday, November 10" },
  { localDate: "2026-11-11", relative: "In 2 days", label: "Wednesday, November 11" },
] as const;

const record = (id: string, label: string, start_on: string, end_on: string | null, note: string | null, created: string): PeriodRecord => ({
  id, user_id: "bench", label, start_on, end_on, note, revision: 1, created_at: created, updated_at: created,
});

const INITIAL: PeriodRecord[] = [
  record("bench-sick", "Sick", "2026-11-03", null, "Stayed home.\nNo training", "2026-11-03T12:00:00Z"),
  record("bench-travel", "Travel", "2026-11-09", "2026-11-10", null, "2026-11-08T12:00:00Z"),
  record("bench-long", "Visiting family over the long weekend in the mountains", "2026-11-10", "2026-11-14", null, "2026-11-07T12:00:00Z"),
  record("bench-exams", "Exams", "2026-10-12", "2026-10-16", "Two papers and an oral.\nNo training", "2026-10-10T12:00:00Z"),
];

const OCCURRENCES = [
  ...Array.from({ length: 17 }, () => ({ status: "completed" as const, localDate: "2026-11-01" })),
  ...Array.from({ length: 3 }, () => ({ status: "not_completed" as const, localDate: "2026-11-02" })),
  { status: "completed" as const, localDate: "2026-11-04" },
  ...Array.from({ length: 4 }, () => ({ status: "not_completed" as const, localDate: "2026-11-05" })),
];

const dayNoteAction: OccurrenceFormAction = async () => ({ status: "success", message: "Day note saved." });

/** The Period writes over an in-memory store. `onChange` receives every new list. */
function benchActions(onChange: (records: PeriodRecord[]) => void): PeriodActions {
  let rows = INITIAL;
  let created = 0;
  const commit = (next: PeriodRecord[]) => { rows = next; onChange(next); };
  const store: PeriodDataStore = {
    listPeriods: async () => rows,
    getPeriod: async (id) => rows.find((item) => item.id === id) ?? null,
    createPeriod: async (input) => {
      created += 1;
      const added = record(`bench-new-${created}`, input.label, input.startOn, input.endOn, input.note,
        `2026-11-09T12:00:${String(created % 60).padStart(2, "0")}Z`);
      commit([...rows, added]);
      return added;
    },
    updatePeriod: async (input) => {
      const current = rows.find((item) => item.id === input.id);
      if (!current || current.revision !== input.expectedRevision) return null;
      const updated = { ...current, label: input.label, start_on: input.startOn, end_on: input.endOn, note: input.note,
        revision: current.revision + 1 };
      commit(rows.map((item) => item.id === updated.id ? updated : item));
      return updated;
    },
    deletePeriod: async (input) => {
      const current = rows.find((item) => item.id === input.id);
      if (!current || current.revision !== input.expectedRevision) return null;
      commit(rows.filter((item) => item !== current));
      return current.id;
    },
  };
  const run = (noticeId: PeriodNoticeId, write: (form: FormData) => Promise<unknown>): PeriodFormAction =>
    async (_state, form): Promise<PeriodActionState> => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        if (form.get("label") === "Conflict") throw new Error(PERIOD_CONFLICT_MESSAGE);
        await write(form);
        return { status: "success", noticeId, message: noticeText(noticeId) };
      } catch (error) {
        const message = error instanceof Error ? error.message : PERIOD_MESSAGES.revisionInvalid;
        return message === PERIOD_CONFLICT_MESSAGE
          ? { status: "error", noticeId: "period.conflict", message: noticeText("period.conflict") }
          : { status: "error", message };
      }
    };
  const target = (form: FormData) => ({ id: form.get("period_id"), expectedRevision: form.get("expected_revision") });
  const fields = (form: FormData) => ({
    label: form.get("label"), startOn: form.get("start_on"), endOn: form.get("end_on"), note: form.get("note"),
  });
  return {
    save: run("period.saved", (form) => form.get("period_id")
      ? updatePeriod(store, { ...target(form), ...fields(form) })
      : createPeriod(store, fields(form))),
    end: run("period.ended", (form) => endPeriod(store, { ...target(form), today: TODAY })),
    remove: run("period.removed", (form) => deletePeriod(store, target(form))),
    saveNote: async (_state, form) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        const { period } = await savePeriodNote(store, {
          id: form.get("period_id"), expectedNote: form.get("expected_note"), note: form.get("note"),
        });
        return { status: "success", message: "", revision: period.revision };
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Unable to save this note." };
      }
    },
  };
}

export function PeriodBench() {
  const [records, setRecords] = useState<PeriodRecord[]>(INITIAL);
  const [actions] = useState(() => benchActions(setRecords));

  const view = attachTimelinePeriods(
    { daySections: DAYS.map((day) => ({ localDate: day.localDate })), needsDecision: { daySections: [] } },
    records,
  );
  // "No training" repeats across two Period notes, so the note field offers it as a chip.
  const noteShortcuts = resolvePeriodNoteShortcuts({ periods: records, now: BENCH_NOW });
  const adherence = resolvePeriodAdherence({
    occurrences: OCCURRENCES, periods: records, startLocalDate: "2026-10-11", endLocalDate: TODAY,
  });

  return (
    <div className="grid gap-8">
      <section className="grid gap-5" aria-label="Timeline day headers with Periods">
        {DAYS.map((day) => (
          <div key={day.localDate} className="border-b border-line pb-3" data-bench-period-day={day.localDate}>
            <p className="text-sm font-bold text-muted-readable">{day.relative}</p>
            <h2 className={day.localDate === TODAY ? "text-3xl font-bold leading-tight" : "text-2xl font-bold leading-tight"}>
              <time dateTime={day.localDate}>{day.label}</time>
            </h2>
            <PeriodDayControls
              localDate={day.localDate}
              dayLabel={day.label}
              periods={view.periodsByDate[day.localDate]}
              today={TODAY}
              labelSuggestions={view.periodLabelSuggestions}
              noteShortcuts={noteShortcuts}
              actions={actions}
            >
              <DayNoteControl localDate={day.localDate} dayLabel={day.label} note="" action={dayNoteAction} />
            </PeriodDayControls>
          </div>
        ))}
      </section>

      <section className="grid max-w-sm gap-1" aria-label="Adherence summary line">
        <p className="text-2xl leading-tight tabular-nums">Overall adherence: 72%</p>
        {adherence ? (
          <p className="text-sm text-muted-readable tabular-nums" data-testid="period-adherence-line">{adherence.line}</p>
        ) : (
          <p className="text-sm text-muted-readable">No Period in this range, so the line is hidden.</p>
        )}
      </section>

      <PeriodList
        periods={periodsNewestFirst(records).map(toPeriodView)}
        today={TODAY}
        labelSuggestions={periodLabelSuggestions(records)}
        noteShortcuts={noteShortcuts}
        actions={actions}
      />
    </div>
  );
}
