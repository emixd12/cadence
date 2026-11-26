// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PERIOD_MESSAGES } from "@cadence/core/resolvers/period.resolver";
import { PERIOD_CONFLICT_MESSAGE } from "@cadence/core/services/period.service";
import type { PeriodActionState, PeriodActions, PeriodFormAction, PeriodView } from "@/lib/types/period";
import { RefreshProvider } from "@cadence/ui/runtime";

import { PeriodDayControls, PeriodList } from "../components/periods/PeriodControl";
import { DayNoteControl } from "../components/timeline/DayNoteControl";
import { TimelineGroup } from "../components/timeline/TimelineGroup";
import type { OccurrenceFormAction, TimelineDaySection } from "../lib/types/timeline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const TODAY = "2026-11-09";
const SICK: PeriodView = { id: "p-sick", label: "Sick", start_on: "2026-11-03", end_on: null, note: "Stayed home", revision: 2 };
const TRAVEL: PeriodView = { id: "p-travel", label: "Travel", start_on: "2026-11-09", end_on: "2026-11-12", note: null, revision: 1 };
const DONE: PeriodView = { id: "p-done", label: "Exams", start_on: "2026-10-01", end_on: "2026-10-05", note: null, revision: 1 };

type Recorded = { kind: "save" | "end" | "remove" | "note"; fields: Record<string, string> };

function recordingActions(reply: (call: Recorded) => PeriodActionState = (call) => ({
  status: "success",
  noticeId: call.kind === "save" ? "period.saved" : call.kind === "end" ? "period.ended" : "period.removed",
  message: "",
}), noteRevision = 3) {
  const calls: Recorded[] = [];
  const make = (kind: Recorded["kind"]): PeriodFormAction => async (_state, form) => {
    const call = { kind, fields: Object.fromEntries([...form.entries()].map(([name, value]) => [name, String(value)])) };
    calls.push(call);
    return reply(call);
  };
  // The note field's own save answers with the Period's next revision.
  const saveNote: PeriodActions["saveNote"] = async (_state, form) => {
    calls.push({ kind: "note", fields: Object.fromEntries([...form.entries()].map(([name, value]) => [name, String(value)])) });
    return { status: "success", message: "", revision: noteRevision };
  };
  const actions: PeriodActions = { save: make("save"), end: make("end"), remove: make("remove"), saveNote };
  return { calls, actions };
}

async function render(node: React.ReactNode, onRefresh: () => void = () => undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const draw = (next: React.ReactNode) => act(async () => root.render(<RefreshProvider onRefresh={onRefresh}>{next}</RefreshProvider>));
  await draw(node);
  return {
    container,
    rerender: draw,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
const field = <T extends HTMLElement = HTMLInputElement>(container: HTMLElement, label: string) => {
  const found = [...container.querySelectorAll("label")].find((item) => item.textContent === label);
  return found ? container.querySelector<T>(`#${CSS.escape(found.htmlFor)}`) : null;
};
const noteField = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>('[data-period-editor] textarea[name="note"]');
const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); });

function dayControls(overrides: Partial<React.ComponentProps<typeof PeriodDayControls>> = {}) {
  return (
    <PeriodDayControls localDate={TODAY} dayLabel="Monday, November 9" today={TODAY} periods={[]} {...overrides}>
      <span data-day-note-slot>Add day note</span>
    </PeriodDayControls>
  );
}

describe("Period day controls (Ticket 369)", () => {
  it("renders nothing of its own without actions", async () => {
    const view = await render(dayControls({ periods: [SICK], labelSuggestions: ["Sick"] }));
    try {
      expect(view.container.innerHTML).toBe("<span data-day-note-slot=\"true\">Add day note</span>");
    } finally {
      await view.unmount();
    }
  });

  it("adds a Period from today with the label field, past labels, dates and note", async () => {
    const { calls, actions } = recordingActions();
    const onRefresh = vi.fn();
    const view = await render(dayControls({ actions, labelSuggestions: ["Sick", "Travel"] }), onRefresh);
    try {
      const summary = view.container.querySelector("summary")!;
      expect(summary.textContent).toBe("Add period");
      expect(view.container.querySelector("form")).toBeNull();

      await act(async () => {
        view.container.querySelector("details")!.open = true;
        view.container.querySelector("details")!.dispatchEvent(new Event("toggle"));
      });

      const label = field(view.container, "Label")!;
      const first = field(view.container, "First day")!;
      const last = field(view.container, "Last day")!;
      const note = noteField(view.container)!;
      expect(note.labels?.[0]?.textContent).toBe("Note");
      expect(first.type).toBe("date");
      expect(first.value).toBe(TODAY);
      expect(last.type).toBe("date");
      expect(last.value).toBe("");
      expect(document.getElementById(last.getAttribute("aria-describedby")!)?.textContent).toBe("Still going. Set a last day when it ends.");
      const options = [...document.getElementById(label.getAttribute("list")!)!.querySelectorAll("option")].map((item) => item.value);
      expect(options).toEqual(["Sick", "Travel"]);
      // A new Period offers neither End today nor Remove.
      expect(button(view.container, "End today")).toBeUndefined();
      expect(button(view.container, "Remove")).toBeUndefined();

      await act(async () => {
        setValue(label, "Sick");
        setValue(note, "Fever");
      });
      await click(button(view.container, "Save"));

      expect(calls).toEqual([{ kind: "save", fields: { label: "Sick", start_on: TODAY, end_on: "", note: "Fever" } }]);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(view.container.querySelector("form")).toBeNull();
      expect(view.container.querySelector('[data-notice="period.saved"]')?.textContent).toBe("Period saved.");
    } finally {
      await view.unmount();
    }
  });

  it("shows the resolver's sentence inline for a broken rule, keeps the draft and sends nothing", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(dayControls({ actions }));
    try {
      await act(async () => {
        view.container.querySelector("details")!.open = true;
        view.container.querySelector("details")!.dispatchEvent(new Event("toggle"));
      });
      await click(button(view.container, "Save"));
      expect(view.container.querySelector("[data-period-error]")?.textContent).toBe(PERIOD_MESSAGES.labelRequired);

      await act(async () => {
        setValue(field(view.container, "Label")!, "Travel");
        setValue(field(view.container, "Last day")!, "2026-11-01");
      });
      await click(button(view.container, "Save"));
      expect(view.container.querySelector("[data-period-error]")?.textContent).toBe(PERIOD_MESSAGES.endBeforeStart);
      expect(field(view.container, "Label")!.value).toBe("Travel");
      expect(calls).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it("shows Add period on today only", async () => {
    const { actions } = recordingActions();
    const view = await render(dayControls({ actions, localDate: "2026-11-10", dayLabel: "Tuesday, November 10", periods: [SICK] }));
    try {
      expect(view.container.querySelector("summary")).toBeNull();
      expect(view.container.textContent).not.toContain("Add period");
      // The chip still shows on a day that is not today.
      expect(button(view.container, "Sick")).toBeDefined();
    } finally {
      await view.unmount();
    }
  });

  it("shows one chip per covering Period and opens that Period's editor in place", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(dayControls({ actions, periods: [SICK, TRAVEL] }));
    try {
      const list = view.container.querySelector("[data-period-chips] ul")!;
      expect(list.getAttribute("aria-label")).toBe("Periods on Monday, November 9");
      const chips = [...list.querySelectorAll("button")];
      expect(chips.map((chip) => chip.textContent)).toEqual(["Sick", "Travel"]);
      expect(chips[0]!.getAttribute("aria-label")).toBe("Edit period Sick, Since Nov 3");
      expect(chips[1]!.getAttribute("aria-label")).toBe("Edit period Travel, Nov 9 – Nov 12");
      expect(chips[0]!.getAttribute("aria-expanded")).toBe("false");

      await click(chips[0]);
      expect(chips[0]!.getAttribute("aria-expanded")).toBe("true");
      expect(view.container.querySelector('[data-period-editor="p-sick"]')).not.toBeNull();
      expect(field(view.container, "Label")!.value).toBe("Sick");
      expect(field(view.container, "First day")!.value).toBe("2026-11-03");
      expect(field(view.container, "Last day")!.value).toBe("");
      expect(noteField(view.container)!.value).toBe("Stayed home");

      await act(async () => {
        setValue(field(view.container, "Label")!, "Flu");
        setValue(field(view.container, "Last day")!, "2026-11-08");
      });
      await click(button(view.container, "Save"));

      expect(calls).toEqual([{ kind: "save", fields: {
        period_id: "p-sick", expected_revision: "2", label: "Flu", start_on: "2026-11-03", end_on: "2026-11-08",
      } }]);
      expect(view.container.querySelector("[data-period-editor]")).toBeNull();
      expect(view.container.querySelector('[data-notice="period.saved"]')).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it("offers End today only when the Period resolver allows it", async () => {
    const { calls, actions } = recordingActions();
    const future: PeriodView = { ...TRAVEL, id: "p-future", label: "Trip", start_on: "2026-11-20", end_on: null };
    const view = await render(dayControls({ actions, periods: [SICK, DONE, future] }));
    try {
      await click(button(view.container, "Exams"));
      expect(button(view.container, "End today")).toBeUndefined();
      await click(button(view.container, "Trip"));
      expect(button(view.container, "End today")).toBeUndefined();

      await click(button(view.container, "Sick"));
      await click(button(view.container, "End today"));

      expect(calls).toEqual([{ kind: "end", fields: { period_id: "p-sick", expected_revision: "2" } }]);
      expect(view.container.querySelector('[data-notice="period.ended"]')?.textContent).toBe("Period ended today.");
    } finally {
      await view.unmount();
    }
  });

  it("removes only after a second tap on the inline confirmation", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(dayControls({ actions, periods: [SICK] }));
    try {
      await click(button(view.container, "Sick"));
      expect(button(view.container, "Remove this period")).toBeUndefined();

      await click(button(view.container, "Remove"));
      expect(calls).toEqual([]);
      expect(view.container.querySelector("dialog, [role='dialog']")).toBeNull();
      expect(view.container.textContent).not.toMatch(/undo/i);
      await click(button(view.container, "Keep"));
      expect(button(view.container, "Remove this period")).toBeUndefined();
      expect(calls).toEqual([]);

      await click(button(view.container, "Remove"));
      await click(button(view.container, "Remove this period"));
      expect(calls).toEqual([{ kind: "remove", fields: { period_id: "p-sick", expected_revision: "2" } }]);

      // The page then reloads without the Period: the chip goes and the outcome stays.
      await view.rerender(dayControls({ actions, periods: [] }));
      expect(view.container.querySelector("[data-period-chips] ul")).toBeNull();
      expect(view.container.querySelector('[data-notice="period.removed"]')?.textContent).toBe("Period removed.");
    } finally {
      await view.unmount();
    }
  });

  it("shows a conflict inline, reloads, and then shows the latest version", async () => {
    const { actions } = recordingActions(() => ({ status: "error", noticeId: "period.conflict", message: PERIOD_CONFLICT_MESSAGE }));
    const onRefresh = vi.fn();
    const view = await render(dayControls({ actions, periods: [SICK] }), onRefresh);
    try {
      await click(button(view.container, "Sick"));
      await act(async () => setValue(field(view.container, "Label")!, "Flu"));
      await click(button(view.container, "Save"));

      expect(view.container.querySelector('[data-notice="period.conflict"]')?.textContent).toBe(PERIOD_CONFLICT_MESSAGE);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(view.container.querySelector("[data-period-editor]")).not.toBeNull();

      await view.rerender(dayControls({ actions, periods: [{ ...SICK, label: "Cold", revision: 3 }] }));
      expect(field(view.container, "Label")!.value).toBe("Cold");
      expect(view.container.querySelector<HTMLInputElement>('input[name="expected_revision"]')!.value).toBe("3");
      expect(view.container.querySelector('[data-notice="period.conflict"]')).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it("saves an existing Period's note on its own, and the next write names the revision that save returned", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(dayControls({ actions, periods: [SICK] }));
    try {
      await click(button(view.container, "Sick"));
      const note = noteField(view.container)!;
      // The shared note editor: no Done of its own inside the Period editor.
      expect(button(view.container, "Done")).toBeUndefined();
      expect(note.form).not.toBe(field(view.container, "Label")!.form);

      await act(async () => {
        setValue(note, "Stayed home\nFever");
        note.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(calls).toEqual([{ kind: "note", fields: {
        period_id: "p-sick", note: "Stayed home\nFever", expected_note: "Stayed home", used_shortcut: "false",
      } }]);
      expect(view.container.querySelector('[data-notice="timeline.note-saved"]')).not.toBeNull();
      expect(view.container.querySelector("[data-period-editor]")).not.toBeNull();

      await act(async () => setValue(field(view.container, "Label")!, "Flu"));
      await click(button(view.container, "Save"));
      expect(calls[1]).toEqual({ kind: "save", fields: {
        period_id: "p-sick", expected_revision: "3", label: "Flu", start_on: "2026-11-03", end_on: "",
      } });
    } finally {
      await view.unmount();
    }
  });

  it("saves a note typed while a save was in flight before Close closes the editor", async () => {
    const { calls, actions } = recordingActions();
    let release: () => void = () => undefined;
    const slow: PeriodActions = { ...actions, saveNote: async (state, form) => {
      const result = await actions.saveNote(state, form);
      if (calls.filter((call) => call.kind === "note").length === 1) await new Promise<void>((resolve) => { release = resolve; });
      return result;
    } };
    const view = await render(dayControls({ actions: slow, periods: [SICK] }));
    try {
      await click(button(view.container, "Sick"));
      const note = noteField(view.container)!;
      await act(async () => {
        setValue(note, "First");
        note.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      await act(async () => setValue(note, "First and second"));
      await click(button(view.container, "Close"));
      // The first save is still in flight: the editor stays until the latest text is saved.
      expect(view.container.querySelector("[data-period-editor]")).not.toBeNull();

      await act(async () => { release(); });
      expect(calls.filter((call) => call.kind === "note").map((call) => call.fields.note)).toEqual(["First", "First and second"]);
      expect(view.container.querySelector("[data-period-editor]")).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it("keeps a label being edited when the Period reloads after its note saved", async () => {
    const { actions } = recordingActions();
    const view = await render(dayControls({ actions, periods: [SICK] }));
    try {
      await click(button(view.container, "Sick"));
      await act(async () => setValue(field(view.container, "Label")!, "Flu"));

      await view.rerender(dayControls({ actions, periods: [{ ...SICK, note: "Fever", end_on: "2026-11-08", revision: 3 }] }));
      expect(field(view.container, "Label")!.value).toBe("Flu");
      expect(field(view.container, "Last day")!.value).toBe("2026-11-08");
      expect(noteField(view.container)!.value).toBe("Fever");
      expect(view.container.querySelector<HTMLInputElement>('input[name="expected_revision"]')!.value).toBe("3");
    } finally {
      await view.unmount();
    }
  });

  it("offers repeated Period note lines as chips and clears the last day", async () => {
    const { calls, actions } = recordingActions();
    const shortcut = {
      key: "a".repeat(64), text: "No training", status: "proposed" as const, source: "repeated_text" as const,
      evidence: [], created_at: "2026-11-09T12:00:00Z", expires_at: "2026-12-09T12:00:00Z",
    };
    const view = await render(dayControls({ actions, noteShortcuts: [shortcut] }));
    try {
      await act(async () => {
        view.container.querySelector("details")!.open = true;
        view.container.querySelector("details")!.dispatchEvent(new Event("toggle"));
      });
      const chips = view.container.querySelector('[aria-label="Period note shortcuts"]')!;
      // Nothing stores these chips, so there is nothing to dismiss.
      expect([...chips.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["No training"]);

      const last = field(view.container, "Last day")!;
      expect(button(view.container, "Clear")).toBeUndefined();
      await act(async () => {
        setValue(field(view.container, "Label")!, "Travel");
        setValue(last, "2026-11-12");
      });
      expect(last.min).toBe(TODAY);
      await click(button(view.container, "Clear"));
      expect(last.value).toBe("");
      expect(button(view.container, "Clear")).toBeUndefined();

      await click(button(view.container, "No training"));
      expect(noteField(view.container)!.value).toBe("No training");
      await click(button(view.container, "Save"));
      expect(calls).toEqual([{ kind: "save", fields: { label: "Travel", start_on: TODAY, end_on: "", note: "No training" } }]);
    } finally {
      await view.unmount();
    }
  });

  it("closes on Close and on Escape without sending anything", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(dayControls({ actions, periods: [SICK] }));
    try {
      await click(button(view.container, "Sick"));
      expect(button(view.container, "Cancel")).toBeUndefined();
      await click(button(view.container, "Close"));
      expect(view.container.querySelector("[data-period-editor]")).toBeNull();
      expect(document.activeElement).toBe(button(view.container, "Sick"));

      await click(button(view.container, "Sick"));
      await act(async () => {
        field(view.container, "Label")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(view.container.querySelector("[data-period-editor]")).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      await view.unmount();
    }
  });
});

describe("Periods in a Timeline day header", () => {
  const idle: OccurrenceFormAction = async () => ({ status: "idle", message: "" });
  const section = (localDate: string, label: string): TimelineDaySection => ({
    key: `day-${localDate}`, kind: "needs_decision_day", localDate, label, relativeLabel: "",
    emptyMessage: "No occurrences.", occurrenceCount: 0, unresolvedOccurrenceCount: 0,
    occurrences: [], occurrenceGroups: [], parentGroups: [], rows: [],
  } as unknown as TimelineDaySection);
  const group = (props: Partial<React.ComponentProps<typeof TimelineGroup>>) => (
    <TimelineGroup section={section("2026-11-08", "Sunday, November 8")} statusAction={idle} noteAction={idle}
      startTimeTrackingAction={idle as never} stopTimeTrackingAction={idle as never} resetTimeTrackingAction={idle as never}
      dayNoteAction={idle} {...props} />
  );

  it("puts the chips under the date and keeps the day note control", async () => {
    const { actions } = recordingActions();
    const view = await render(group({ periodActions: actions, periods: [SICK], todayLocalDate: TODAY }));
    try {
      const chips = view.container.querySelector('[data-period-chips="2026-11-08"]')!;
      expect(chips.textContent).toBe("Sick");
      expect(chips.previousElementSibling?.tagName).toBe("H2");
      expect(view.container.querySelector("[data-day-note]")).not.toBeNull();
      expect(view.container.textContent).not.toContain("Add period");
    } finally {
      await view.unmount();
    }
  });

  it("is unchanged when no Period actions are passed", async () => {
    const withPeriods = await render(group({ periods: [SICK], todayLocalDate: TODAY }));
    const plain = await render(group({}));
    try {
      expect(withPeriods.container.querySelector("[data-period-chips]")).toBeNull();
      expect(withPeriods.container.innerHTML).toBe(plain.container.innerHTML);
    } finally {
      await withPeriods.unmount();
      await plain.unmount();
    }
  });

  it("sits beside a real day note control on today", async () => {
    const { actions } = recordingActions();
    const view = await render(
      <PeriodDayControls localDate={TODAY} dayLabel="Monday, November 9" today={TODAY} actions={actions}>
        <DayNoteControl localDate={TODAY} dayLabel="Monday, November 9" note="" action={idle} />
      </PeriodDayControls>,
    );
    try {
      const summaries = [...view.container.querySelectorAll("summary")].map((item) => item.textContent);
      expect(summaries).toEqual(["Add day note", "Add period"]);
      const row = view.container.querySelector("[data-day-note]")!.parentElement!.parentElement!;
      expect(row.className).toContain("flex-wrap");
      expect(row.querySelector("[data-period-add]")).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

describe("Period list on Behaviors", () => {
  it("is hidden without actions or without Periods", async () => {
    const { actions } = recordingActions();
    const none = await render(<PeriodList periods={[]} today={TODAY} actions={actions} />);
    const noActions = await render(<PeriodList periods={[SICK]} today={TODAY} />);
    try {
      expect(none.container.innerHTML).toBe("");
      expect(noActions.container.innerHTML).toBe("");
    } finally {
      await none.unmount();
      await noActions.unmount();
    }
  });

  it("lists every Period in the order given with its dates and the same editor", async () => {
    const { calls, actions } = recordingActions();
    const view = await render(<PeriodList periods={[TRAVEL, SICK, DONE]} today={TODAY} labelSuggestions={["Sick"]} actions={actions} />);
    try {
      expect(view.container.querySelector("h2")?.textContent).toBe("Periods");
      const rows = [...view.container.querySelectorAll("[data-period]")];
      expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
        "TravelNov 9 – Nov 12", "SickSince Nov 3", "ExamsOct 1 – Oct 5",
      ]);
      expect(rows[1]!.textContent).toContain("Stayed home");

      await click(view.container.querySelector('button[aria-label="Edit period Sick"]'));
      expect(view.container.querySelectorAll("[data-period-editor]")).toHaveLength(1);
      expect(field(view.container, "Label")!.value).toBe("Sick");
      await click(button(view.container, "Remove"));
      await click(button(view.container, "Remove this period"));

      expect(calls).toEqual([{ kind: "remove", fields: { period_id: "p-sick", expected_revision: "2" } }]);
      expect(view.container.querySelector('[data-notice="period.removed"]')).not.toBeNull();

      // With the last Period gone the outcome still shows.
      await view.rerender(<PeriodList periods={[]} today={TODAY} actions={actions} />);
      expect(view.container.querySelector('[data-notice="period.removed"]')).not.toBeNull();
      expect(view.container.querySelector("ul")).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});
