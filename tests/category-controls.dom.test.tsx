// @vitest-environment jsdom
import { LinkProvider, RefreshProvider } from "@cadence/ui/runtime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { CategoryPanel } from "../components/settings/CategoryPanel";
import { BehaviorList } from "../components/behaviors/BehaviorList";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { storedBehavior } from "./helpers/export-row-fixture";
import { categoryAssignmentSnapshot, categorySnapshot, verifyCategoryDeletionReview, type CategoryAction } from "@cadence/core/services/category.service";
let root: Root; let container: HTMLDivElement;
const categories = [{ id: "home", name: "Home", description: "Household routines", sort_order: 0, updated_at: "2026-09-05T00:00:00Z" }];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
async function click(label: string) { const button = [...container.querySelectorAll("button")].find((row) => (row.getAttribute("aria-label") ?? row.textContent) === label); expect(button).toBeTruthy(); await act(() => button!.click()); }
it("keeps category drafts after failed saves and confirms the reviewed assignment set", async () => {
  const assignments = [{ id: "behavior", categoryId: "home", active: false, updatedAt: "now" }];
  const action = vi.fn(async () => ({ status: "error" as const, message: "Duplicate name" }));
  await act(() => root.render(<CategoryPanel categories={categories} assignments={assignments} action={action} />));
  await click("Edit Home");
  const name = container.querySelector<HTMLInputElement>('[name="name"]')!; name.value = "Draft";
  await click("Save category");
  expect(action).toHaveBeenCalledOnce(); expect(name.value).toBe("Draft"); expect(container.textContent).toContain("Duplicate name");
  await click("Delete category…"); expect(container.textContent).toContain("0 active and 1 archived");
  const form = new FormData(container.querySelector("form")!);
  expect(form.get("expected_assignments")).toBe(categoryAssignmentSnapshot(assignments, "home"));
  expect(() => verifyCategoryDeletionReview(form, [...assignments, { ...assignments[0], id: "new" }], "home")).toThrow(/assignments changed/);
  expect(container.querySelector<HTMLInputElement>('[name="confirm_delete"]')!.required).toBe(true);
  await click("Cancel"); expect(container.querySelector("form")).toBeNull();
});
it("filters both lists, retains mounted drafts, clears controls, and resets removed categories", async () => {
  const home = { ...toBehaviorView(storedBehavior()), id: "home-behavior", title: "Home behavior", categoryId: "home", categoryName: "Home" };
  const other = { ...home, id: "none-behavior", title: "Uncategorized behavior", categoryId: "", categoryName: "No category" };
  const unchanged = async <T,>(state: T) => state;
  const props = { activeBehaviors: [home, other], archivedBehaviors: [{...home,id:"archived",active:false}], categories,
    analytics: resolveAnalytics({ occurrences: [], now: Temporal.Instant.from("2026-09-05T12:00:00Z"), timezone: "America/New_York" }),
    updateAction: unchanged, archiveAction: unchanged, restoreAction: unchanged, archiveNoteAction: unchanged,
    statusAction: unchanged, noteAction: unchanged,
    stopTimeTrackingAction: unchanged, resetTimeTrackingAction: unchanged };
  await act(() => root.render(<LinkProvider component={(props) => <a {...props} />}><RefreshProvider onRefresh={() => undefined}><BehaviorList {...props} /></RefreshProvider></LinkProvider>));
  const selects = container.querySelectorAll("select"); const category = selects[0]; const sort = selects[1];
  const article = [...container.querySelectorAll("article")].find(row => row.querySelector("h3")?.textContent === "Home behavior")!;
  const details = article.querySelector("details")!;
  await act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  const draft = article.querySelector<HTMLInputElement>('[name="title"]'); expect(draft).toBeTruthy(); draft!.value = "Unsaved title";
  await act(() => { category.value = "none"; category.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(article.closest("[hidden]")).toBeTruthy(); expect(container.textContent).toContain("1 of 2 active behaviors"); expect(container.textContent).toContain("0 of 1 archived behaviors");
  await act(() => { sort.value = "name"; sort.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Clear filters"); expect(category.value).toBe("all"); expect(sort.value).toBe("time"); expect(article.querySelector('[name="title"]')).toBe(draft); expect(draft!.value).toBe("Unsaved title");
  await act(() => { category.value = "home"; category.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => root.render(<LinkProvider component={(props) => <a {...props} />}><RefreshProvider onRefresh={() => undefined}><BehaviorList {...props} categories={[]} /></RefreshProvider></LinkProvider>));
  expect(category.value).toBe("all"); expect(container.textContent).toContain("selected category was removed");
});
it("keeps an archive-note draft after the archive action fails", async () => {
  const behavior = toBehaviorView(storedBehavior());
  const unchanged = async <T,>(state: T) => state;
  const archiveAction = vi.fn(async (_state, form: FormData) => {
    expect(form.get("expected_updated_at")).toBe(behavior.updatedAt);
    expect(form.get("archive_note")).toBe("Pause during travel");
    return { status: "error" as const, message: "Archive failed." };
  });
  const props = {
    activeBehaviors: [behavior], archivedBehaviors: [], categories,
    analytics: resolveAnalytics({ occurrences: [], now: Temporal.Instant.from("2026-09-05T12:00:00Z"), timezone: "America/New_York" }),
    updateAction: unchanged, archiveAction, restoreAction: unchanged, archiveNoteAction: unchanged,
    statusAction: unchanged, noteAction: unchanged, stopTimeTrackingAction: unchanged, resetTimeTrackingAction: unchanged,
  };
  await act(() => root.render(<LinkProvider component={(props) => <a {...props} />}><RefreshProvider onRefresh={() => undefined}><BehaviorList {...props} /></RefreshProvider></LinkProvider>));
  const details = container.querySelector("article details") as HTMLDetailsElement;
  await act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  const note = container.querySelector<HTMLTextAreaElement>('[name="archive_note"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Pause during travel");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Archive behavior");
  expect(archiveAction).toHaveBeenCalledOnce();
  expect(note.value).toBe("Pause during travel");
  expect(container.textContent).toContain("Archive failed.");
});

const three = [
  { id: "home", name: "Home", description: null, sort_order: 0, updated_at: "2026-09-05T00:00:00Z" },
  { id: "work", name: "Work", description: null, sort_order: 1, updated_at: "2026-09-05T00:00:00Z" },
  { id: "fitness", name: "Fitness", description: null, sort_order: 2, updated_at: "2026-09-05T00:00:00Z" },
];
const names = () => [...container.querySelectorAll("[data-category-row] > span")].map((row) => row.textContent);
const handle = (name: string) => container.querySelector<HTMLButtonElement>(`[aria-label="Reorder ${name}"]`)!;
const status = () => container.querySelector('[role="status"], [role="alert"]')!;
const saved = () => ({ status: "success" as const, message: "Categories saved." });
function pointer(target: Element, type: string, clientY: number, pointerType: "mouse" | "touch", pointerId = 1) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientY, pointerId, pointerType, button: 0 }));
}
/** Each row is 44 px tall, stacked from the top of the viewport in list order. */
function layOutRows() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const item = this.closest("li");
    const index = item?.parentElement ? [...item.parentElement.children].indexOf(item) : 0;
    return { top: index * 44, bottom: index * 44 + 44, left: 0, right: 300, width: 300, height: 44, x: 0, y: index * 44, toJSON: () => ({}) } as DOMRect;
  });
}
function moveForm(action: ReturnType<typeof vi.fn>, call = 0) {
  const form = action.mock.calls[call]![1] as FormData;
  return { intent: form.get("intent"), category_id: form.get("category_id"), position: form.get("position"), expected: form.get("expected") };
}

it("keeps the title outside a closed Edit categories drawer with one line per category", async () => {
  await act(() => root.render(<CategoryPanel categories={three} assignments={[]} action={vi.fn<CategoryAction>(async () => saved())} headingLevel={3} />));
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(container.querySelector("h3")?.textContent).toBe("Categories");
  expect(details.contains(container.querySelector("h3"))).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("Edit 3 categories");
  expect(names()).toEqual(["Home", "Work", "Fitness"]);
  expect([...container.querySelectorAll("button")].some((button) => /Move (up|down)/.test(button.textContent ?? ""))).toBe(false);
  await click("Edit Work");
  expect(container.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe("Work");
  expect(container.querySelector<HTMLInputElement>('[name="intent"]')?.value).toBe("update");
});

it("moves the focused category one place with the arrow keys and announces it", async () => {
  const action = vi.fn<CategoryAction>(async () => saved());
  await act(() => root.render(<CategoryPanel categories={three} assignments={[]} action={action} />));
  const fitness = handle("Fitness");
  fitness.focus();
  await act(() => { fitness.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
  expect(moveForm(action)).toEqual({ intent: "move", category_id: "fitness", position: "1", expected: categorySnapshot(three) });
  expect(names()).toEqual(["Home", "Fitness", "Work"]);
  expect(status().textContent).toBe("Fitness moved to position 2 of 3.");
  expect(document.activeElement).toBe(fitness);
  await act(() => { handle("Home").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
  expect(action).toHaveBeenCalledOnce();
});

for (const pointerType of ["mouse", "touch"] as const) {
  it(`drags a category with ${pointerType} input and saves the order when it is dropped`, async () => {
    const rects = layOutRows();
    const action = vi.fn<CategoryAction>(async () => saved());
    await act(() => root.render(<CategoryPanel categories={three} assignments={[]} action={action} />));
    const home = handle("Home");
    await act(() => pointer(home, "pointerdown", 20, pointerType, 7));
    await act(() => pointer(home, "pointermove", 60, pointerType, 7));
    await act(() => pointer(home, "pointermove", 110, pointerType, 7));
    expect(names()).toEqual(["Work", "Fitness", "Home"]);
    expect(status().textContent).toBe("Home moved to position 3 of 3.");
    expect(action).not.toHaveBeenCalled();
    await act(() => pointer(home, "pointerup", 110, pointerType, 7));
    expect(action).toHaveBeenCalledOnce();
    expect(moveForm(action)).toMatchObject({ intent: "move", category_id: "home", position: "2" });
    rects.mockRestore();
  });
}

it("drops a cancelled drag without saving", async () => {
  const rects = layOutRows();
  const action = vi.fn<CategoryAction>(async () => saved());
  await act(() => root.render(<CategoryPanel categories={three} assignments={[]} action={action} />));
  const home = handle("Home");
  await act(() => pointer(home, "pointerdown", 20, "touch"));
  await act(() => pointer(home, "pointermove", 70, "touch"));
  expect(names()).toEqual(["Work", "Home", "Fitness"]);
  await act(() => pointer(home, "pointercancel", 70, "touch"));
  expect(names()).toEqual(["Home", "Work", "Fitness"]);
  expect(action).not.toHaveBeenCalled();
  rects.mockRestore();
});

it("restores the stored order and shows the refusal when the snapshot is stale", async () => {
  const action = vi.fn<CategoryAction>(async () => ({ status: "error", message: "Categories changed. Refresh Settings and review your changes." }));
  await act(() => root.render(<CategoryPanel categories={three} assignments={[]} action={action} />));
  await act(() => { handle("Work").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  expect(action).toHaveBeenCalledOnce();
  expect(names()).toEqual(["Home", "Work", "Fitness"]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Categories changed");
  // The reloaded list replaces the draft order.
  const reloaded = [three[2]!, three[0]!, three[1]!].map((row, index) => ({ ...row, sort_order: index, updated_at: "2026-09-06T00:00:00Z" }));
  await act(() => root.render(<CategoryPanel categories={reloaded} assignments={[]} action={action} />));
  expect(names()).toEqual(["Fitness", "Home", "Work"]);
});
