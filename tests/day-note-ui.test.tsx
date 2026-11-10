// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RefreshProvider } from "@cadence/ui/runtime";
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
  return { container, unmount: () => act(async () => root.unmount()) };
}

describe("Day note control", () => {
  it("submits the local date, the expected note and the new text through the shared editor", async () => {
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
      const summary = view.container.querySelector("summary")!;
      expect(summary.getAttribute("aria-label")).toBe("Add day note for Tuesday, November 10");
      expect(summary.textContent).toBe("Add day note");
      expect(view.container.querySelector("label span")?.textContent).toBe("Day note");
      expect(view.container.querySelector('input[name="occurrence_id"]')).toBeNull();

      const textarea = view.container.querySelector("textarea")!;
      expect(textarea.placeholder).toBe("Add a note about this day");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Travel day, slept badly.");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const form = view.container.querySelector("form")!;
      await act(async () => form.requestSubmit(form.querySelector('button[type="submit"]') as HTMLButtonElement));

      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.get("local_date")).toBe("2026-11-10");
      expect(submissions[0]?.get("expected_note")).toBe("");
      expect(stored).toBe("Travel day, slept badly.");
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Day note saved.");
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

  it("shows day note shortcuts only from the day pool", async () => {
    const view = await render(<DayNoteControl localDate="2026-11-09" dayLabel="Monday" note="" action={idle} shortcuts={[{
      key: "a".repeat(64), text: "Rest day", status: "accepted", source: "repeated_text", evidence: [], created_at: "2026-11-01T00:00:00Z", expires_at: null,
    }]} />);
    try {
      expect(view.container.querySelector('[aria-label="Day note shortcuts"]')?.textContent).toBe("Rest day");
    } finally {
      await view.unmount();
    }
  });

  it("appears under the date in Needs decision day sections only when an action is provided", async () => {
    const section: TimelineDaySection = {
      key: "needs-2026-11-08", kind: "needs_decision_day", localDate: "2026-11-08", label: "Sunday, November 8",
      relativeLabel: "2 days ago", emptyMessage: "", occurrenceGroups: [], unresolvedOccurrenceCount: 0,
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
