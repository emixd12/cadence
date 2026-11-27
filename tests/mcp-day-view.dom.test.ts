// Ticket 377: the "Cadence day" MCP Apps view. Every test here drives the shipped bundle
// (lib/mcp/apps/day-view-html.ts), not the source, through a mock host that speaks the
// MCP Apps protocol. The window has no network; `view.network` records any attempt.
import { afterEach, describe, expect, it } from "vitest";

import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { noticeText } from "@cadence/core/notices";
import { FIXTURE_DAYS, HOSTILE_NOTE_TEXT } from "@/packages/mcp-views/src/fixtures";
import { FULL_SCOPES, READ_ONLY_SCOPES } from "@/packages/mcp-views/src/mock-host";
import { inlineScript, mountDayView, type MountedDayView } from "./helpers/day-view-harness";

let view: MountedDayView | null = null;
const mount = async (options: Parameters<typeof mountDayView>[0]) => (view = await mountDayView(options));
afterEach(() => {
  view?.close();
  view = null;
});

const action = (row: Element, name: string) => row.querySelector<HTMLButtonElement>(`:scope > .row-main [data-action="${name}"], :scope > .editor [data-action="${name}"]`);
const text = (element: Element | null | undefined) => element?.textContent ?? null;
const titles = (root: ParentNode) => [...root.querySelectorAll(":scope > li")].map((row) => text(row.querySelector(".title")));
const WRITE_CONTROLS = '[data-action="completed"], [data-action="not_completed"], [data-action="note"], [data-action="save-note"]';

describe("Cadence day view: reading", () => {
  it("shows one day: heading, day note, the Needs decision count and rows in the server's order", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    expect(text(v.main().querySelector("h1"))).toBe("Today");
    expect(text(v.main().querySelector(".heading .muted"))).toBe("Wednesday, November 25");
    expect(text(v.main().querySelector("[data-day-note] .user-text"))).toBe("Flight home lands at 6. Keep the evening light.");
    expect(text(v.main().querySelector("[data-needs-decision]"))).toBe("4 earlier items need a decision");
    expect(titles(v.main().querySelector("ul.rows")!)).toEqual(["Morning walk", "Vitamins", "Stretch", "Read"]);
    // A moved item shows where it sits today, formatted from the server's instant and timezone.
    expect(text(v.row("Stretch").querySelector(".time"))).toBe("3:30 PM");
    expect(text(v.row("Morning walk").querySelector(".time"))).toBe("7:30 AM");
    expect(text(v.row("Vitamins").querySelector("[data-facts]"))).toBe("Completed");
    expect(text(v.row("Vitamins").querySelector("[data-note]"))).toBe("Took them with breakfast.");
    expect(action(v.row("Vitamins"), "completed")?.getAttribute("aria-pressed")).toBe("true");
    // Needs decision is a count line only: no control expands it.
    expect(v.main().querySelector("[data-needs-decision] button, [data-needs-decision] a")).toBeNull();
    expect(v.errors).toEqual([]);
  });

  it("counts Needs decision as none, one, several and more than the server lists", async () => {
    expect((await mount({ day: FIXTURE_DAYS.empty() })).main().querySelector("[data-needs-decision]")).toBeNull();
    view!.close();
    expect(text((await mount({ day: FIXTURE_DAYS.oneEarlier() })).main().querySelector("[data-needs-decision]"))).toBe("1 earlier item needs a decision");
    view!.close();
    expect(text((await mount({ day: FIXTURE_DAYS.manyEarlier() })).main().querySelector("[data-needs-decision]"))).toBe("More than 100 earlier items need a decision");
  });

  it("says an empty day is empty and shows no rows", async () => {
    const v = await mount({ day: FIXTURE_DAYS.empty() });
    expect(text(v.main().querySelector("[data-empty]"))).toBe(noticeText("day-view.empty"));
    expect(v.main().querySelector("ul.rows")).toBeNull();
    expect(v.main().querySelector("[data-day-note]")).toBeNull();
  });

  it('shows "Alongside" only when the field is true', async () => {
    const v = await mount({ day: FIXTURE_DAYS.alongside() });
    expect(text(v.row("Podcast").querySelector("[data-facts]"))).toBe("Alongside");
    for (const title of ["Deep work", "Laundry", "Journal"]) expect(v.row(title).querySelector("[data-facts]")).toBeNull();
  });

  it("labels a connector completion from the server's field and still lets the person change it", async () => {
    const v = await mount({ day: FIXTURE_DAYS.connector() });
    expect(text(v.row("Gym").querySelector("[data-facts]"))).toBe("Completed · From Hevy");
    expect(text(v.row("Vitamins").querySelector("[data-facts]"))).toBe("Completed");
    await v.click(action(v.row("Gym"), "not_completed"));
    expect(v.toolCalls("set_occurrence_status")[0]?.arguments).toMatchObject({ status: "not_completed", expected_status: "completed" });
    expect(text(v.row("Gym").querySelector("[data-facts]"))).toBe("Not Completed");
  });

  it("labels rows added from the person's opportunities", async () => {
    const v = await mount({ day: FIXTURE_DAYS.opportunity() });
    expect(text(v.row("Call Mom").querySelector("[data-facts]"))).toBe("Added");
    expect(text(v.row("Water the plants").querySelector("[data-facts]"))).toBe("Added from Daily Brief");
    expect(text(v.row("Tidy the desk").querySelector("[data-facts]"))).toBe("Added by a connected app");
    expect(v.row("Morning walk").querySelector("[data-facts]")).toBeNull();
  });

  it("shows placeholders until a result arrives, and says so when none will", async () => {
    const waiting = await mount({ day: FIXTURE_DAYS.normal(), result: "never" });
    expect(waiting.main().querySelector("[data-loading]")).not.toBeNull();
    expect(text(waiting.main().querySelector('[role="status"]'))).toBe(noticeText("day-view.loading"));
    waiting.close();
    const cancelled = await mount({ day: FIXTURE_DAYS.normal(), result: "cancelled" });
    expect(text(cancelled.main().querySelector('[role="alert"]'))).toBe(noticeText("day-view.unavailable"));
  });

  it("follows the host's theme and style variables", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), theme: "dark", styleVariables: { "--color-text-primary": "#FAF9F5" } });
    const root = v.document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#FAF9F5");
    v.host.setTheme("light", { "--color-text-primary": "#141413" });
    await v.settle();
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#141413");
  });
});

describe("Cadence day view: writes", () => {
  it("marks an Occurrence with the displayed status as the precondition, then re-reads the day and tells the model", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    await v.click(action(v.row("Morning walk"), "completed"));
    const [call] = v.toolCalls("set_occurrence_status");
    expect(call?.arguments).toMatchObject({ occurrence_id: v.host.day().occurrences[0]!.id, status: "completed", expected_status: "unresolved" });
    expect(call?.arguments.idempotency_key).toMatch(/^view-[0-9a-f]{32}$/);
    expect(v.toolCalls().map((entry) => entry.name)).toEqual(["set_occurrence_status", "show_day"]);
    expect(v.toolCalls("show_day")[0]?.arguments).toEqual({ date: "2026-11-25" });
    expect(v.row("Morning walk").dataset.status).toBe("completed");
    expect(text(v.row("Morning walk").querySelector("[data-facts]"))).toBe("Completed");
    expect(v.modelContext()).toEqual(["Morning walk: Completed (set by the person in the Cadence day view)"]);
    expect(v.main().querySelector('[role="alert"]')).toBeNull();
  });

  it("returns a row to Unresolved when the person clicks the status it already has", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    await v.click(action(v.row("Vitamins"), "completed"));
    expect(v.toolCalls("set_occurrence_status")[0]?.arguments).toMatchObject({ status: "unresolved", expected_status: "completed" });
    expect(v.row("Vitamins").dataset.status).toBe("unresolved");
    expect(v.modelContext()).toEqual(["Vitamins: Unresolved (set by the person in the Cadence day view)"]);
  });

  it("saves a note with the displayed revision, keeps one editor open at a time and never sends note text to the model", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    await v.click(action(v.row("Vitamins"), "note"));
    await v.click(action(v.row("Morning walk"), "note"));
    expect(v.main().querySelectorAll("[data-note-editor]")).toHaveLength(1);
    expect(v.main().querySelectorAll("textarea")).toHaveLength(1);
    const editor = v.row("Morning walk").querySelector("textarea")!;
    expect(v.document.activeElement).toBe(editor);
    await v.type(editor, "Knee felt fine. SECRET-NOTE-TEXT");
    await v.click(action(v.row("Morning walk"), "save-note"));
    expect(v.toolCalls("update_occurrence_note")[0]?.arguments).toMatchObject({ note: "Knee felt fine. SECRET-NOTE-TEXT", expected_revision: "r1-1" });
    expect(v.toolCalls("update_occurrence_note")[0]?.arguments.idempotency_key).toMatch(/^view-[0-9a-f]{32}$/);
    expect(text(v.row("Morning walk").querySelector("[data-note]"))).toBe("Knee felt fine. SECRET-NOTE-TEXT");
    expect(v.main().querySelector("[data-note-editor]")).toBeNull();
    expect(v.modelContext()).toEqual(["Morning walk: note saved (by the person in the Cadence day view)"]);
    expect(v.modelContext().join("\n")).not.toContain("SECRET-NOTE-TEXT");
  });

  it("shows a parent slot collapsed with the server's progress, each step once, and marks the slot with every displayed step as the precondition", async () => {
    const v = await mount({ day: FIXTURE_DAYS.parent() });
    expect(titles(v.main().querySelector("ul.rows")!)).toEqual(["Skin routine", "Morning walk"]);
    const slot = v.row("Skin routine");
    expect(text(slot.querySelector("[data-progress]"))).toBe("1/3");
    expect(slot.querySelector("ul.steps")).toBeNull();
    await v.click(action(slot, "steps"));
    expect(titles(v.row("Skin routine").querySelector("ul.steps")!)).toEqual(["Cleanser", "Moisturizer", "Sunscreen"]);
    expect(v.main().querySelectorAll("li[data-occurrence]")).toHaveLength(4);
    await v.click(action(v.row("Skin routine"), "completed"));
    const ids = v.host.day().parent_groups[0]!.occurrence_ids;
    expect(v.toolCalls("set_parent_occurrence_status")[0]?.arguments).toMatchObject({
      status: "completed",
      occurrence_ids: ids,
      expected_statuses: [{ occurrence_id: ids[0], status: "completed" }, { occurrence_id: ids[1], status: "unresolved" }, { occurrence_id: ids[2], status: "unresolved" }],
    });
    expect(text(v.row("Skin routine").querySelector("[data-progress]"))).toBe("Completed");
    expect(v.row("Sunscreen").dataset.status).toBe("completed");
    expect(v.modelContext()).toEqual(["Skin routine: Completed for every step (set by the person in the Cadence day view)"]);
    // One step can still be marked on its own.
    await v.click(action(v.row("Sunscreen"), "not_completed"));
    expect(text(v.row("Skin routine").querySelector("[data-progress]"))).toBe("2/3");
  });
});

describe("Cadence day view: refused writes", () => {
  it("on a conflict re-reads the day, asks again and does not send the write a second time", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), writes: "conflict-once" });
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(v.toolCalls().map((entry) => `${entry.name}:${entry.outcome}`)).toEqual(["set_occurrence_status:conflict", "show_day:ok"]);
    expect(text(v.main().querySelector('[role="alert"]'))).toBe(`Not changed. ${noticeText("day-view.conflict")}`);
    // The row now shows what the other change left.
    expect(v.row("Morning walk").dataset.status).toBe("not_completed");
    expect(v.modelContext()).toEqual([]);
    // A new click sends the new displayed status and a new key.
    const firstKey = v.toolCalls("set_occurrence_status")[0]!.arguments.idempotency_key;
    await v.click(action(v.row("Morning walk"), "completed"));
    const second = v.toolCalls("set_occurrence_status")[1]!;
    expect(second.arguments).toMatchObject({ status: "completed", expected_status: "not_completed" });
    expect(second.arguments.idempotency_key).not.toBe(firstKey);
    expect(v.row("Morning walk").dataset.status).toBe("completed");
    expect(v.main().querySelector('[role="alert"]')).toBeNull();
  });

  it("never overwrites a note silently: a refused save keeps the draft beside the note that is saved now", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), writes: "conflict-once" });
    await v.click(action(v.row("Vitamins"), "note"));
    await v.type(v.row("Vitamins").querySelector("textarea")!, "My draft");
    await v.click(action(v.row("Vitamins"), "save-note"));
    expect(v.host.day().occurrences[1]!.note).toBe("Changed on another device.");
    expect(text(v.main().querySelector('[role="alert"]'))).toBe(`Not changed. ${noticeText("day-view.conflict")}`);
    const row = v.row("Vitamins");
    expect(row.querySelector("textarea")!.value).toBe("My draft");
    expect(text(row.querySelector("[data-note-current] .muted"))).toBe(noticeText("day-view.note-current"));
    expect(text(row.querySelector("[data-note-current] .note"))).toBe("Changed on another device.");
    expect(v.toolCalls("update_occurrence_note")).toHaveLength(1);
    // Saving again is the person's decision, with the revision now displayed.
    const savedRevision = v.host.day().occurrences[1]!.revision;
    expect(savedRevision).not.toBe("r1-2");
    await v.click(action(v.row("Vitamins"), "save-note"));
    expect(v.toolCalls("update_occurrence_note")[1]?.arguments.expected_revision).toBe(savedRevision);
    expect(v.toolCalls("update_occurrence_note")[1]?.outcome).toBe("ok");
    expect(v.host.day().occurrences[1]!.note).toBe("My draft");
  });

  it("refuses a note save when the note changed elsewhere while the editor was open, even after a re-read brought the newer revision", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    const vitamins = v.host.day().occurrences[1]!;
    await v.click(action(v.row("Vitamins"), "note"));
    await v.type(v.row("Vitamins").querySelector("textarea")!, "My draft");
    v.host.changeNoteElsewhere(vitamins.id, "Written on the phone.");
    // Marking another row re-reads the day, which now carries the phone's note and revision.
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(v.row("Vitamins").querySelector("textarea")!.value).toBe("My draft");
    await v.click(action(v.row("Vitamins"), "save-note"));
    const [refused] = v.toolCalls("update_occurrence_note");
    expect(refused).toMatchObject({ outcome: "conflict", arguments: { expected_revision: vitamins.revision } });
    expect(v.host.day().occurrences[1]!.note).toBe("Written on the phone.");
    expect(text(v.row("Vitamins").querySelector("[data-note-current] .note"))).toBe("Written on the phone.");
    expect(v.row("Vitamins").querySelector("textarea")!.value).toBe("My draft");
    // Having seen the phone's note, a second Save note is the person's decision.
    await v.click(action(v.row("Vitamins"), "save-note"));
    expect(v.toolCalls("update_occurrence_note")[1]?.outcome).toBe("ok");
    expect(v.host.day().occurrences[1]!.note).toBe("My draft");
  });

  it("saves a note without a conflict after the person marks the same row with the editor open", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal() });
    await v.click(action(v.row("Morning walk"), "note"));
    await v.type(v.row("Morning walk").querySelector("textarea")!, "Short one today");
    await v.click(action(v.row("Morning walk"), "completed"));
    const revision = v.host.day().occurrences[0]!.revision;
    expect(revision).not.toBe("r1-1");
    await v.click(action(v.row("Morning walk"), "save-note"));
    expect(v.toolCalls("update_occurrence_note")[0]).toMatchObject({ outcome: "ok", arguments: { expected_revision: revision } });
    expect(v.main().querySelector('[role="alert"]')).toBeNull();
  });

  it("honors the rate limit's wait: says how long, holds the controls, then lets the same action through with the same key", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), writes: "rate-limit-once", retryAfterSeconds: 1 });
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(text(v.main().querySelector('[role="alert"]'))).toBe(`Not changed. ${noticeText("day-view.rate-limited", { seconds: 1 })}`);
    expect(text(v.main().querySelector('[role="alert"]'))).toContain("Try again in 1 second.");
    expect(action(v.row("Morning walk"), "completed")!.disabled).toBe(true);
    await v.click(action(v.row("Read"), "completed"));
    expect(v.toolCalls()).toHaveLength(1);
    await v.waitFor(() => !action(v.row("Morning walk"), "completed")!.disabled, "the wait to end");
    expect(v.main().querySelector('[role="alert"]')).toBeNull();
    await v.click(action(v.row("Morning walk"), "completed"));
    const calls = v.toolCalls("set_occurrence_status");
    expect(calls.map((entry) => entry.outcome)).toEqual(["rate_limited", "ok"]);
    expect(calls[1]!.arguments.idempotency_key).toBe(calls[0]!.arguments.idempotency_key);
    expect(v.row("Morning walk").dataset.status).toBe("completed");
  });
});

describe("Cadence day view: missing write scope", () => {
  it('shows "Reconnect to allow changes" in place of the controls for a read-only grant', async () => {
    const v = await mount({ day: FIXTURE_DAYS.parent(), scopes: READ_ONLY_SCOPES });
    expect(text(v.main().querySelector("[data-reconnect]"))).toBe("Reconnect to allow changes");
    expect(v.main().querySelectorAll(WRITE_CONTROLS)).toHaveLength(0);
    // Reading still works: the steps open.
    await v.click(action(v.row("Skin routine"), "steps"));
    expect(v.main().querySelectorAll("li[data-occurrence]")).toHaveLength(4);
    expect(v.main().querySelectorAll(WRITE_CONTROLS)).toHaveLength(0);
    expect(v.toolCalls()).toEqual([]);
  });

  it("switches to the reconnect state when a write returns insufficient_scope", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), scopes: null, writes: "insufficient-scope" });
    expect(v.main().querySelector("[data-reconnect]")).toBeNull();
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(text(v.main().querySelector("[data-reconnect]"))).toBe(noticeText("day-view.reconnect"));
    expect(v.main().querySelectorAll(WRITE_CONTROLS)).toHaveLength(0);
    expect(v.row("Morning walk").dataset.status).toBe("unresolved");
  });

  it("handles a rejected call by re-reading the day and applying its scopes", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), initialScopes: null, scopes: READ_ONLY_SCOPES, writes: "reject" });
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(v.toolCalls().map((entry) => `${entry.name}:${entry.outcome}`)).toEqual(["set_occurrence_status:rejected", "show_day:ok"]);
    expect(text(v.main().querySelector("[data-reconnect]"))).toBe("Reconnect to allow changes");
    expect(v.main().querySelectorAll(WRITE_CONTROLS)).toHaveLength(0);
    expect(v.main().querySelector('[role="alert"]')).toBeNull();
  });

  it("says a rejected call was not saved when the grant can write, and reuses the key for the identical retry", async () => {
    const v = await mount({ day: FIXTURE_DAYS.normal(), scopes: FULL_SCOPES, writes: "reject" });
    await v.click(action(v.row("Morning walk"), "completed"));
    expect(text(v.main().querySelector('[role="alert"]'))).toBe(`Not changed. ${noticeText("day-view.not-saved")}`);
    expect(v.row("Morning walk").dataset.status).toBe("unresolved");
    await v.click(action(v.row("Morning walk"), "completed"));
    const calls = v.toolCalls("set_occurrence_status");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.arguments).toEqual(calls[0]!.arguments);
    expect(v.modelContext()).toEqual([]);
  });
});

describe("Cadence day view: the shipped bundle is inert and offline", () => {
  it("renders hostile titles, notes and the day note as text and makes no network request", async () => {
    const v = await mount({ day: FIXTURE_DAYS.hostile() });
    const main = v.main();
    expect(main.querySelectorAll("img, script, style, b, iframe, link, object, embed, a")).toHaveLength(0);
    expect(text(main.querySelector("li[data-occurrence] [data-note]"))).toBe(HOSTILE_NOTE_TEXT);
    expect(text(main.querySelector("li[data-occurrence] .title"))).toBe("<b>Bold</b> <script>alert(1)</script> title");
    expect(text(main.querySelector("[data-day-note] .user-text"))).toContain(HOSTILE_NOTE_TEXT);
    // The same text through a save, the editor and a re-read.
    const row = main.querySelector<HTMLElement>("li[data-occurrence]")!;
    await v.click(action(row, "note"));
    const editor = v.main().querySelector("textarea")!;
    expect(editor.value).toBe(HOSTILE_NOTE_TEXT);
    await v.type(editor, `${HOSTILE_NOTE_TEXT}<svg onload=alert(1)>`);
    await v.click(v.main().querySelector('[data-action="save-note"]'));
    expect(v.host.day().occurrences[0]!.note).toBe(`${HOSTILE_NOTE_TEXT}<svg onload=alert(1)>`);
    expect(text(v.main().querySelector("li[data-occurrence] [data-note]"))).toBe(`${HOSTILE_NOTE_TEXT}<svg onload=alert(1)>`);
    expect(v.main().querySelectorAll("img, script, style, b, svg, iframe, link, object, embed, a")).toHaveLength(0);
    expect(v.document.querySelectorAll("script[src], link, img, iframe, object, embed")).toHaveLength(0);
    expect(v.network).toEqual([]);
    expect(v.errors).toEqual([]);
  });

  it("makes no network request across reads, writes, refusals and a theme change", async () => {
    const v = await mount({ day: FIXTURE_DAYS.parent(), writes: "conflict-once" });
    await v.click(action(v.row("Skin routine"), "steps"));
    await v.click(action(v.row("Skin routine"), "completed"));
    await v.click(action(v.row("Skin routine"), "completed"));
    await v.click(action(v.row("Morning walk"), "note"));
    await v.type(v.main().querySelector("textarea")!, "Note");
    await v.click(v.main().querySelector('[data-action="save-note"]'));
    v.host.setTheme("dark");
    await v.settle();
    expect(v.toolCalls().length).toBeGreaterThan(4);
    expect(v.network).toEqual([]);
    expect(v.errors).toEqual([]);
    // The view calls the four tools of its contract and sends nothing else to the host.
    expect([...new Set(v.toolCalls().map((entry) => entry.name))].sort()).toEqual(["set_parent_occurrence_status", "show_day", "update_occurrence_note"]);
    expect(v.host.log.filter((entry) => entry.kind === "other")).toEqual([]);
  });

  it("is one self-contained file: no external script, style, image, font, frame or link", () => {
    const script = inlineScript();
    const styles = [...DAY_VIEW_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).join("\n");
    const markup = DAY_VIEW_HTML.replace(script, "").replace(styles, "");
    // Booleans, so a failure does not print the whole bundle.
    const has = (source: string, pattern: RegExp) => pattern.test(source);
    expect(markup.length).toBeLessThan(1000);
    expect(has(markup, /\s(?:src|href|srcset|action|poster|data)\s*=/i)).toBe(false);
    expect(has(markup, /<(?:link|img|iframe|object|embed|base|form|video|audio|source)\b/i)).toBe(false);
    expect(has(markup, /https?:|\/\//)).toBe(false);
    expect(has(styles, /url\(|@import|@font-face|image-set\(/i)).toBe(false);
    // Network and storage APIs do not appear in the code at all, apart from schema descriptions in the SDK.
    for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /new\s+WebSocket/, /EventSource/, /sendBeacon/, /importScripts/, /\bimport\s*\(/, /new\s+(?:Shared)?Worker/,
      /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /serviceWorker/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/]) {
      expect(has(script, pattern), String(pattern)).toBe(false);
    }
    // No analytics or third-party host names.
    expect(has(script, /google-analytics|googletagmanager|segment\.|sentry|posthog|mixpanel|cdn\./i)).toBe(false);
  });
});
