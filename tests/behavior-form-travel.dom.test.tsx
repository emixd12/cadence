// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { BehaviorForm } from "@/components/behaviors/BehaviorForm";
import type { BehaviorActionState, BehaviorFormAction, BehaviorView } from "@/lib/types/behavior";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const success: BehaviorFormAction = async () => ({ status: "success", message: "Saved." } as BehaviorActionState);
const behavior = (): BehaviorView => ({
  id: "behavior-1", title: "Walk", description: "", whereKind: "place", locationText: "1 Main St", categoryId: "category-1", categoryName: "Health",
  recurrenceSummary: "Daily", recurrenceDefaults: { kind: "daily", dailyInterval: 1, everyDays: 2, weeklyInterval: 1, weeklyDays: ["monday"], monthlyInterval: 1, monthlyDay: 5 },
  scheduledTime: "18:00", scheduledTimeLabel: "6:00 PM", schedules: [],
  scheduleSlots: [{ id: "slot-1", kind: "exact", preset: null, startTime: "18:00", endTime: null, sortOrder: 0, label: "6:00 PM" }],
  scheduleSummary: "6:00 PM", timezone: "America/New_York", browserReminderEnabled: true, emailReminderEnabled: false,
  reminderOffsetMinutes: 0, reminderSummary: "Browser reminders", active: true, archivedAt: null, archiveNotes: [],
  createdAt: "2026-06-01T12:00:00Z", updatedAt: "2026-06-01T12:00:00Z",
});

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

async function saveWith(fields: Record<string, string>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const listener = vi.fn();
  window.addEventListener("cadence:travel-changed", listener);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<BehaviorForm mode="edit" action={success} categories={[{ id: "category-1", name: "Health" }]} behavior={behavior()} />));
    const form = host.querySelector("form")!;
    for (const [name, value] of Object.entries(fields)) (form.elements.namedItem(name) as HTMLInputElement).value = value;
    await act(async () => { form.requestSubmit(); });
    return listener.mock.calls.length;
  } finally {
    window.removeEventListener("cadence:travel-changed", listener);
    await act(() => root.unmount());
  }
}

it("announces a travel change after saving a changed location", async () => {
  expect(await saveWith({ location_text: "2 Main St" })).toBe(1);
});

it("does not announce a travel change for an unrelated edit", async () => {
  expect(await saveWith({ title: "Evening walk" })).toBe(0);
});

it("announces a travel change after changing Where (Ticket 215)", async () => {
  expect(await saveWith({ where_kind: "home" })).toBe(1);
});

it("offers four Where states, shows Place only for A place, and keeps one hint (Ticket 215)", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<BehaviorForm mode="create" action={success} categories={[{ id: "category-1", name: "Health" }]} />));
    const where = host.querySelector<HTMLSelectElement>('select[name="where_kind"]')!;
    expect([...where.options].map((option) => option.textContent)).toEqual(["Not set", "Anywhere", "Home", "A place"]);
    expect(where.value).toBe("");
    expect(host.querySelector('input[name="location_text"]')).toBeNull();
    await act(() => { where.value = "place"; where.dispatchEvent(new Event("change", { bubbles: true })); });
    const place = host.querySelector<HTMLInputElement>('input[name="location_text"]')!;
    expect(place.required).toBe(true);
    await act(() => { where.value = "anywhere"; where.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector('input[name="location_text"]')).toBeNull();
    expect(host.textContent).toContain("Travel estimates and scheduling advice work better when Where is set.");
  } finally { await act(() => root.unmount()); }
});
