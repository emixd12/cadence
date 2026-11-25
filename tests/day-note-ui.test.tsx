// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
import { NOTE_AUTO_SAVE_DELAY_MS, NOTE_CLOSED_SAVED_MS } from "../components/notes/NoteEditor";
import { DayNoteControl } from "../components/timeline/DayNoteControl";
import { TimelineGroup } from "../components/timeline/TimelineGroup";
import type { OccurrenceFormAction, TimelineDaySection } from "../lib/types/timeline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const idle: OccurrenceFormAction = async () => ({ status: "idle", message: "" });

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<RefreshProvider onRefresh={() => undefined}>{node}</RefreshProvider>));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Day note control", () => {
  it("auto-saves on pause, updates the summary optimistically, and collapses on Done with a fading Saved indicator", async () => {
    vi.useFakeTimers();
    let stored = "";
    const submissions: FormData[] = [];
    const action: OccurrenceFormAction = async (_state, form) => {
      submissions.push(form);
      if (form.get("expected_note") !== stored) return { status: "error", message: "This day note changed elsewhere." };
      stored = String(form.get("note")).trim();
      return { status: "success", message: "Day note saved." };
    };
    const view = await render(<DayNoteControl localDate="2026-11-10" dayLabel="Tuesday, November 10" note="" action={action} />);
    try {
      const details = view.container.querySelector("details")!;
      const summary = view.container.querySelector("summary")!;
      expect(details.open).toBe(false);
      expect(summary.getAttribute("aria-label")).toBe("Add day note for Tuesday, November 10");
      expect(summary.textContent).toBe("Add day note");
      expect(view.container.querySelector("label span")?.textContent).toBe("Day note");
      expect(view.container.querySelector("label span")?.className).toContain("sr-only");
      expect(view.container.querySelector('input[name="occurrence_id"]')).toBeNull();

      await act(async () => summary.click());
      expect(details.open).toBe(true);

      const textarea = view.container.querySelector("textarea")!;
      expect(textarea.placeholder).toBe("Add a note about this day");
      await act(async () => setTextareaValue(textarea, "Travel day, slept badly."));

      // Debounced auto-save fires after pause without closing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOTE_AUTO_SAVE_DELAY_MS);
      });

      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.get("local_date")).toBe("2026-11-10");
      expect(submissions[0]?.get("expected_note")).toBe("");
      expect(stored).toBe("Travel day, slept badly.");
      expect(details.open).toBe(true);
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Saved");
      expect(summary.getAttribute("aria-label")).toBe("Edit day note for Tuesday, November 10");

      // Clicking Done collapses back to the 1-line summary with a fading Saved indicator.
      const doneButton = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
      await act(async () => doneButton.click());
      expect(details.open).toBe(false);
      expect(summary.textContent).toBe("Day noteTravel day, slept badly.Saved");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOTE_CLOSED_SAVED_MS);
      });
      expect(summary.textContent).toBe("Day noteTravel day, slept badly.");
    } finally {
      await view.unmount();
    }
  });

  it("flushes unsaved edits on Done and Cmd+Enter, and stays open with Try again on conflict", async () => {
    let stored = "Initial";
    const submissions: FormData[] = [];
    const action: OccurrenceFormAction = async (_state, form) => {
      submissions.push(form);
      if (form.get("expected_note") !== stored) return { status: "error", message: "This day note changed elsewhere." };
      stored = String(form.get("note")).trim();
      return { status: "success", message: "Day note saved." };
    };
    const view = await render(<DayNoteControl localDate="2026-11-10" dayLabel="Tuesday, November 10" note="Initial" action={action} />);
    try {
      const details = view.container.querySelector("details")!;
      const summary = view.container.querySelector("summary")!;
      await act(async () => summary.click());
      expect(details.open).toBe(true);

      const textarea = view.container.querySelector("textarea")!;
      await act(async () => setTextareaValue(textarea, "Updated via Cmd+Enter"));
      await act(async () => {
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
      });
      expect(submissions).toHaveLength(1);
      expect(stored).toBe("Updated via Cmd+Enter");
      expect(details.open).toBe(false);

      // Simulate an external change causing a conflict: editor must stay open with Try again.
      await act(async () => summary.click());
      stored = "Changed on another device";
      await act(async () => setTextareaValue(textarea, "Conflicting draft"));
      const doneButton = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
      await act(async () => doneButton.click());

      expect(details.open).toBe(true);
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("This day note changed elsewhere.");
      expect(textarea.value).toBe("Conflicting draft");
      expect([...view.container.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it("flushes on blur without closing the editor", async () => {
    let stored = "";
    const action: OccurrenceFormAction = async (_state, form) => {
      stored = String(form.get("note")).trim();
      return { status: "success", message: "Day note saved." };
    };
    const view = await render(<DayNoteControl localDate="2026-11-10" dayLabel="Tuesday" note="" action={action} />);
    try {
      const details = view.container.querySelector("details")!;
      await act(async () => view.container.querySelector("summary")!.click());
      const textarea = view.container.querySelector("textarea")!;
      await act(async () => setTextareaValue(textarea, "Saved on blur"));
      await act(async () => {
        textarea.focus();
        textarea.blur();
      });
      expect(stored).toBe("Saved on blur");
      expect(details.open).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it("queues a reverted edit made while an auto-save is in flight so the final draft persists", async () => {
    vi.useFakeTimers();
    let stored = "A";
    let finishFirst: ((state: { status: "success"; message: string }) => void) | undefined;
    const submissions: Array<{ expected: string; note: string }> = [];
    const action: OccurrenceFormAction = async (_state, form) => {
      const expected = String(form.get("expected_note"));
      const next = String(form.get("note")).trim();
      submissions.push({ expected, note: next });
      if (submissions.length === 1) {
        return new Promise((resolve) => {
          finishFirst = (result) => {
            stored = next;
            resolve(result);
          };
        });
      }
      stored = next;
      return { status: "success", message: "Day note saved." };
    };
    const view = await render(<DayNoteControl localDate="2026-11-10" dayLabel="Tuesday" note="A" action={action} />);
    try {
      await act(async () => view.container.querySelector("summary")!.click());
      const textarea = view.container.querySelector("textarea")!;
      await act(async () => setTextareaValue(textarea, "B"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOTE_AUTO_SAVE_DELAY_MS);
      });
      expect(submissions).toEqual([{ expected: "A", note: "B" }]);
      expect(finishFirst).toBeDefined();

      // Revert back to "A" while "B" is still in flight.
      await act(async () => setTextareaValue(textarea, "A"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOTE_AUTO_SAVE_DELAY_MS);
      });

      // Completing "B" automatically flushes the queued revert to "A".
      await act(async () => finishFirst!({ status: "success", message: "Day note saved." }));
      expect(submissions).toEqual([
        { expected: "A", note: "B" },
        { expected: "B", note: "A" },
      ]);
      expect(stored).toBe("A");
    } finally {
      await view.unmount();
    }
  });

  it("shows a one-line preview and an edit label when the day has a note", async () => {
    const view = await render(<DayNoteControl localDate="2026-11-09" dayLabel="Monday, November 9" note={"Sick\n\nRested all day"} action={idle} />);
    try {
      const summary = view.container.querySelector("summary")!;
      expect(summary.getAttribute("aria-label")).toBe("Edit day note for Monday, November 9");
      expect(summary.textContent).toBe("Day noteSick Rested all day");
      expect(view.container.querySelector("textarea")?.value).toBe("Sick\n\nRested all day");
    } finally {
      await view.unmount();
    }
  });

  it("shows day note shortcuts only from the day pool and saves immediately when tapped", async () => {
    let stored = "";
    const action: OccurrenceFormAction = async (_state, form) => {
      stored = String(form.get("note")).trim();
      return { status: "success", message: "Day note saved." };
    };
    const view = await render(<DayNoteControl localDate="2026-11-09" dayLabel="Monday" note="" action={action} shortcuts={[{
      key: "a".repeat(64), text: "Rest day", status: "accepted", source: "repeated_text", evidence: [], created_at: "2026-11-01T00:00:00Z", expires_at: null,
    }]} />);
    try {
      expect(view.container.querySelector('[aria-label="Day note shortcuts"]')?.textContent).toBe("Rest day");
      await act(async () => view.container.querySelector("summary")!.click());
      const chip = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Rest day")!;
      await act(async () => chip.click());
      expect(stored).toBe("Rest day");
    } finally {
      await view.unmount();
    }
  });

  it("appears under the date in Needs decision day sections only when an action is provided", async () => {
    const section: TimelineDaySection = {
      key: "needs-2026-11-08", kind: "needs_decision_day", localDate: "2026-11-08", label: "Sunday, November 8",
      relativeLabel: "2 days ago", emptyMessage: "", occurrenceGroups: [], parentGroups: [], rows: [], unresolvedOccurrenceCount: 0,
    } as unknown as TimelineDaySection;
    const common = { section, statusAction: idle, noteAction: idle, startTimeTrackingAction: idle, stopTimeTrackingAction: idle, resetTimeTrackingAction: idle } as unknown as React.ComponentProps<typeof TimelineGroup>;
    const without = await render(<TimelineGroup {...common} variant="needsDecisionDialog" />);
    expect(without.container.querySelector("[data-day-note]")).toBeNull();
    await without.unmount();
    const withNote = await render(<TimelineGroup {...common} variant="needsDecisionDialog" dayNoteAction={idle} dayNote="Holiday" />);
    try {
      expect(withNote.container.querySelector("[data-day-note]")?.getAttribute("data-day-note")).toBe("2026-11-08");
      expect(withNote.container.querySelector("textarea")?.value).toBe("Holiday");
    } finally {
      await withNote.unmount();
    }
  });
});
