// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { ExternalEventDetails, ExternalEventPreview } from "@/components/timeline/ExternalEventDetails";
import { validateExternalEventSnapshot, validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import { allDayRangeLabel } from "@cadence/core/services/departure-phrases";
import googleFixture from "@/tests/fixtures/external-event-snapshot.valid.json";
import outlookFixture from "@/tests/fixtures/external-event-snapshot.outlook.valid.json";
import icloudFixture from "@/tests/fixtures/external-event-snapshot.icloud.valid.json";

const google = validateExternalEventSnapshot(googleFixture).events;
const outlook = validateVersionedExternalEventSnapshot(outlookFixture).events;
const icloud = validateVersionedExternalEventSnapshot(icloudFixture).events;
const timed = google[0]! as Extract<NormalizedExternalEvent, { kind: "timed" }>;
const allDay = google[1]! as Extract<NormalizedExternalEvent, { kind: "all_day" }>;
const openEnded = icloud[1]!;

const EMPTY_ROW_STRINGS = ["No detail available.", "Not provided.", "Restricted by the source.", "The source omitted this detail."];
const DEVELOPMENT_LABELS = ["State", "Source timezone", "Recurrence", "Updated"];
const RAW_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const full: NormalizedExternalEvent = { ...timed, location: "12 Harbor Street", description: "Bring the signed form",
  organizer: { displayName: "Ana Ruiz", email: "ana@example.com", self: false },
  conference: { name: "Video call", notes: null, entryPoints: [{ type: "video", uri: "https://meet.example.com/a", label: "Join" }] },
  attachments: [{ title: "Agenda", url: "https://example.com/agenda", mimeType: null }] };

const unavailableFields: NormalizedExternalEvent = { ...timed, description: "", location: "", organizer: null, attendees: null, conference: null, attachments: null,
  fieldAvailability: { description: "restricted", location: "provider_omitted", organizer: "not_provided", attendees: "restricted", conference: "provider_omitted", attachments: "unsupported" },
  detailCompleteness: { attendees: "restricted" } };

const provenance = { originRef: "base", originSource: "saved_base", originRevision: "1", destinationRef: full.id, destinationSource: "calendar",
  destinationRevision: "1", grantRevision: "g" } as const;
const travel: Omit<TravelEvidenceResult, "modelProjection"> = { version: "1.0", journeyRef: "journey", segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null,
  legs: [{ leg: { id: "leg-1", role: "outbound", journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: full.id, mode: "walking",
    readyAt: "2026-11-01T04:00:00Z", provenance }, state: "current", reason: null,
  estimate: { durationSeconds: 600, departureAt: "2026-11-01T05:10:00Z", arrivalAt: "2026-11-01T05:20:00Z", warnings: [], fallback: false,
    attribution: "Google Maps", observedAt: "2026-11-01T04:00:00Z", expiresAt: "2026-11-01T04:05:00Z" } }] };
const NOW = "2026-11-01T04:00:00Z";
/** Ticket 261: the dialog's travel lines come from the departure model. */
const departureFor = (evidence: Omit<TravelEvidenceResult, "modelProjection">) => resolveDepartureModel({ evidence, now: NOW, timezone: "America/New_York",
  arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null,
  stops: [{ ref: full.id, label: full.title, startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z" }] });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

type DialogOptions = Readonly<{ development?: boolean; timezone?: string; onDismissAllDay?: (id: string) => void; onTravelCorrection?: () => void; withTravel?: boolean }>;
async function open(event: NormalizedExternalEvent, options: DialogOptions = {}) {
  await act(() => root.render(<DevelopmentBuildProvider value={options.development ?? false}>
    <ExternalEventDetails event={event} timezone={options.timezone ?? "America/New_York"} onClose={() => undefined} onDismissAllDay={options.onDismissAllDay ?? (() => undefined)}
      onTravelCorrection={options.onTravelCorrection} travel={options.withTravel ? travel : null}
      departure={options.withTravel ? departureFor(travel) : null} now={NOW} />
  </DevelopmentBuildProvider>));
  return container.querySelector("dialog")!;
}
const labels = (scope: Element) => [...scope.querySelectorAll("dt")].map((item) => item.textContent);
const row = (scope: Element, label: string) => [...scope.querySelectorAll("dt")].find((item) => item.textContent === label)?.nextElementSibling?.textContent;

describe("Calendar details order", () => {
  it("leads with the leave line and the Maps link, then time, place, the source and people (Ticket 271)", async () => {
    const dialog = await open(full, { withTravel: true, onTravelCorrection: () => undefined });
    expect(labels(dialog)).toEqual(["Time", "Location", "Calendar", "Attendees", "Organizer", "Conference", "Attachments"]);
    expect(dialog.querySelector("article")!.firstElementChild?.getAttribute("aria-label")).toBe("Travel timing");
    const text = dialog.querySelector("article")!.textContent!;
    const positions = ["Leave by", "Search in Google Maps", "Change for this trip", "Time", "12 Harbor Street", "Google Calendar · Work", "Attendees", "Organizer", "Conference", "Attachments", "Bring the signed form"]
      .map((part) => text.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("puts source and calendar on one line", async () => {
    expect(row(await open(full), "Calendar")).toBe("Google Calendar · Work");
    expect(row(await open(outlook[0]!), "Calendar")).toBe("Outlook Calendar · Personal");
    expect(row(await open(icloud[0]!), "Calendar")).toBe("iCloud Calendar · Personal");
  });

  it("puts Directions directly after the travel lines", async () => {
    const dialog = await open(full, { withTravel: true });
    const timing = dialog.querySelector('[aria-label="Travel timing"]')!;
    expect(timing.nextElementSibling?.textContent).toMatch(/Google Maps|Apple Maps/);
  });
});

describe.each([{ build: "production", development: false }, { build: "development", development: true }])("Calendar details in a $build build", ({ development }) => {
  it.each([
    ["Google timed", timed], ["Google all-day", allDay], ["Google every field", full], ["fields unavailable", unavailableFields],
    ["Outlook timed", outlook[0]!], ["Outlook all-day", outlook[1]!], ["iCloud recurring", icloud[0]!], ["iCloud end unknown", openEnded],
  ])("shows no empty row and no raw instant: %s", async (_name, event) => {
    const dialog = await open(event, { development });
    for (const hidden of EMPTY_ROW_STRINGS) expect(dialog.textContent).not.toContain(hidden);
    expect(dialog.textContent).not.toMatch(RAW_INSTANT);
    const values = [...dialog.querySelectorAll("dd")];
    expect(values.every((value) => value.textContent?.trim())).toBe(true);
    expect(dialog.querySelectorAll("dt")).toHaveLength(values.length);
    for (const list of dialog.querySelectorAll("dl")) expect(list.children.length % 2).toBe(0);
  });
});

describe("Calendar details rows with no value", () => {
  it("removes every empty row and the description, leaving only time and source", async () => {
    const dialog = await open(unavailableFields);
    expect(labels(dialog)).toEqual(["Time", "Calendar"]);
    expect(dialog.querySelectorAll("article > p")).toHaveLength(0);
  });

  it("treats blank text as no value", async () => {
    const dialog = await open({ ...full, description: "   ", location: "  ", organizer: { displayName: null, email: null, self: false }, attendees: [], attachments: [], conference: { name: "", notes: null, entryPoints: [] } });
    expect(labels(dialog)).toEqual(["Time", "Calendar"]);
    expect(dialog.querySelectorAll("article > p")).toHaveLength(0);
  });

  it("keeps a description that has text", async () => {
    expect((await open(full)).textContent).toContain("Bring the signed form");
  });
});

describe("Calendar details development fields", () => {
  it("hides state, zone, recurrence, updated and completeness in production", async () => {
    const dialog = await open(unavailableFields);
    for (const label of DEVELOPMENT_LABELS) expect(labels(dialog)).not.toContain(label);
    for (const text of ["confirmed", "America/New_York", "series-1", "attendees: restricted", "Development"]) expect(dialog.textContent).not.toContain(text);
    expect(dialog.querySelector("[data-calendar-development-details]")).toBeNull();
  });

  it("shows them in development, formatted in the account timezone", async () => {
    const block = (await open(unavailableFields, { development: true })).querySelector("[data-calendar-development-details]")!;
    expect(labels(block)).toEqual(DEVELOPMENT_LABELS);
    expect(row(block, "State")).toBe("confirmed · busy");
    expect(row(block, "Source timezone")).toBe("America/New_York");
    expect(row(block, "Recurrence")).toBe("series-1 · Nov 1, 2026, 1:00 AM");
    expect(row(block, "Updated")).toBe("Nov 1, 2026, 7:00 AM");
    expect(block.textContent).toContain("attendees: restricted");
  });

  it("follows the account timezone, not the source timezone", async () => {
    const block = (await open(timed, { development: true, timezone: "Asia/Tokyo" })).querySelector("[data-calendar-development-details]")!;
    expect(row(block, "Updated")).toBe("Nov 1, 2026, 9:00 PM");
    expect(row(block, "Recurrence")).toBe("series-1 · Nov 1, 2026, 2:00 PM");
  });

  it("formats an all-day recurrence as a date and drops rows with no value", async () => {
    const recurring: NormalizedExternalEvent = { ...allDay, recurrence: { seriesId: "series-2", originalStart: { kind: "all_day", startLocalDate: "2026-11-01" } } };
    const block = (await open(recurring, { development: true })).querySelector("[data-calendar-development-details]")!;
    expect(row(block, "Recurrence")).toBe("series-2 · Nov 1, 2026");
    expect(labels(block)).not.toContain("Updated");
    const plain = (await open(outlook[0]!, { development: true })).querySelector("[data-calendar-development-details]")!;
    expect(labels(plain)).not.toContain("Recurrence");
  });
});

describe("Calendar details duration and time", () => {
  it("hides Duration when the time row shows the span", async () => {
    for (const event of [timed, full, outlook[0]!, icloud[0]!, allDay, outlook[1]!]) expect(labels(await open(event))).not.toContain("Duration");
  });

  it("drops Duration when the end is unspecified too: the time row already says End unknown (Ticket 271)", async () => {
    const dialog = await open(openEnded);
    expect(row(dialog, "Time")).toContain("End unknown");
    expect(labels(dialog)).not.toContain("Duration");
  });

  it("keeps the all-day label and its dismiss control", async () => {
    const dismissed = vi.fn();
    const dialog = await open(allDay, { onDismissAllDay: dismissed });
    expect(row(dialog, "Time")).toContain(allDayRangeLabel(allDay.startLocalDate, allDay.endLocalDate));
    expect(row(dialog, "Time")).not.toContain("exclusive");
    const dismiss = [...dialog.querySelectorAll("button")].find((item) => item.textContent === "Dismiss from timeline")!;
    await act(() => dismiss.click());
    expect(dismissed).toHaveBeenCalledWith(allDay.id);
  });

  it("offers no dismiss control on a timed event", async () => {
    expect((await open(timed)).textContent).not.toContain("Dismiss from timeline");
  });
});

describe("Ticket 261 wording", () => {
  it("shows an all-day range in plain words, the last day inclusive", () => {
    expect(allDayRangeLabel("2026-11-01", "2026-11-03")).toBe("Nov 1 – Nov 2");
    expect(allDayRangeLabel("2026-11-01", "2026-11-02")).toBe("Nov 1");
    expect(allDayRangeLabel("2026-10-31", "2026-11-02")).toBe("Oct 31 – Nov 1");
    expect(allDayRangeLabel("2026-12-31", "2027-01-02")).toBe("Dec 31 – Jan 1");
  });

  it("names a tentative or cancelled event beside the time, and says nothing for confirmed", async () => {
    const time = (state: NormalizedExternalEvent["state"]) => open({ ...timed, state }).then((dialog) => row(dialog, "Time"));
    expect(await time("tentative")).toMatch(/ · Tentative$/);
    expect(await time("cancelled")).toMatch(/ · Cancelled$/);
    expect(await time("confirmed")).not.toMatch(/Tentative|Cancelled|·/);
  });

  it("says how long a journey correction applies in plain words", async () => {
    const dialog = await open(full, { onTravelCorrection: () => undefined });
    expect(dialog.textContent).toContain("Applies to this event until you close the Timeline.");
    expect(dialog.textContent).not.toContain("revision");
  });
});

describe("Calendar details actions", () => {
  it("keeps Open source event, conference and attachment links", async () => {
    const dialog = await open(full);
    const names = [...dialog.querySelectorAll("a")].map((item) => item.textContent);
    expect(names).toContain("Open source event ");
    expect(names).toContain("Join");
    expect(names).toContain("Agenda");
  });

  it("omits Open source event when the source gives no link", async () => {
    expect((await open(outlook[1]!)).textContent).not.toContain("Open source event");
  });

  it("keeps the journey mode choice with the travel lines", async () => {
    const save = vi.fn(async () => undefined);
    const withPlace = { ...travel, legs: travel.legs.map((item) => ({ ...item, leg: { ...item.leg, destinationPlaceKey: "place-1" } })) };
    await act(() => root.render(<ExternalEventDetails event={full} timezone="UTC" onClose={() => undefined} onDismissAllDay={() => undefined} travel={withPlace} departure={departureFor(withPlace)} now={NOW}
      travelHabits={{ settings: { enabled: true, baseLocationText: "Home", mode: "walking", navigationPreference: null, routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-11-01T00:00:00Z" }, save } as never} />));
    const text = container.querySelector("article")!.textContent!;
    expect(text.indexOf("Travel by")).toBeGreaterThan(text.indexOf("Leave by"));
    expect(text.indexOf("Travel by")).toBeLessThan(text.indexOf("Google Calendar · Work"));
  });

  it("keeps the correction form working", async () => {
    const corrected = vi.fn();
    const dialog = await open(full, { onTravelCorrection: corrected });
    dialog.querySelector<HTMLSelectElement>('select[name="travel_attendance"]')!.value = "physical";
    await act(() => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(corrected).toHaveBeenCalledWith(expect.objectContaining({ eventId: full.id, attendance: "physical", locationText: "12 Harbor Street" }));
  });
});

/**
 * Ticket 271: the drawer and the dialog lead with the departure model's phrase. The fixture event
 * starts 1:30 AM (05:30Z) with a 10-minute arrival buffer; the walk leaves 05:10Z and arrives 05:20Z.
 */
describe("Ticket 271: the leave line comes first", () => {
  type Estimate = NonNullable<TravelEvidenceResult["legs"][number]["estimate"]>;
  const withEstimate = (estimate: Partial<Estimate>, extra: Partial<TravelEvidenceResult["legs"][number]> = {}): Omit<TravelEvidenceResult, "modelProjection"> =>
    ({ ...travel, legs: travel.legs.map((item) => ({ ...item, ...extra, estimate: { ...item.estimate!, ...estimate } })) });
  const modelAt = (evidence: Omit<TravelEvidenceResult, "modelProjection">, now: string) => resolveDepartureModel({ evidence, now, timezone: "America/New_York",
    arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null,
    stops: [{ ref: full.id, label: full.title, startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z" }] });
  const states = [
    { name: "soon", now: "2026-11-01T04:50:00Z", evidence: withEstimate({ observedAt: "2026-11-01T04:48:00Z", expiresAt: "2026-11-01T04:53:00Z" }),
      state: "soon", lead: /^Leave in 20 minutes, by 1:10 AM from Home · walking, arrive 1:20 AM\.$/ },
    { name: "leave now", now: "2026-11-01T05:11:00Z", evidence: withEstimate({ observedAt: "2026-11-01T05:09:00Z", expiresAt: "2026-11-01T05:14:00Z" }),
      state: "leave_now", lead: /^Leave now from Home · walking, arrive 1:21 AM\.$/ },
    { name: "last estimate", now: "2026-11-01T04:30:00Z", evidence: travel,
      state: "upcoming", lead: /^Last estimate: leave by 1:10 AM · checked 12:00 AM\.$/ },
    { name: "late from the route", now: "2026-11-01T04:58:00Z",
      evidence: withEstimate({ arrivalAt: "2026-11-01T05:25:00Z", observedAt: "2026-11-01T04:57:00Z", expiresAt: "2026-11-01T05:02:00Z" }, { late: true }),
      state: "late", lead: /^You may arrive late: leave by 1:10 AM from Home · walking, arrive 1:25 AM\.$/ },
    { name: "late by the clock only", now: "2026-11-01T05:20:00Z", evidence: withEstimate({ observedAt: "2026-11-01T05:19:00Z", expiresAt: "2026-11-01T05:24:00Z" }),
      state: "late", lead: /^If you haven't left yet, you'd arrive about 1:30 AM\.$/ },
  ] as const;

  const first = (view: Element) => view.querySelector("[data-departure-lead]")!.textContent!;

  async function renderBoth(evidence: Omit<TravelEvidenceResult, "modelProjection">, now: string, extra: Readonly<{ mode?: "walking" | null }> = {}) {
    const departure = modelAt(evidence, now);
    await act(() => root.render(<>
      <ExternalEventPreview id="preview" events={[full]} timezone="America/New_York" onDismiss={() => undefined} onOpen={() => undefined}
        travel={evidence} departure={departure} now={now} navigationPreference="google_maps" travelMode={extra.mode ?? null} />
      <ExternalEventDetails event={full} timezone="America/New_York" onClose={() => undefined} onDismissAllDay={() => undefined}
        travel={evidence} departure={departure} now={now} navigationPreference="google_maps" travelMode={extra.mode ?? null} />
    </>));
    return { drawer: container.querySelector('[data-calendar-drawer="preview"]')!, dialog: container.querySelector("dialog")! };
  }

  it.each(states)("puts the $name line first in the drawer and the dialog", async ({ now, evidence, state, lead }) => {
    const { drawer, dialog } = await renderBoth(evidence, now);
    for (const view of [drawer, dialog]) {
      const first = view.querySelector("[data-departure-lead]")!;
      expect(first.getAttribute("data-departure-state")).toBe(state);
      expect(first.textContent).toMatch(lead);
      // Regular weight: emphasis comes from position and wording, never from bold.
      expect(first.className).not.toMatch(/font-(bold|semibold|medium)/);
    }
    // The drawer answers under the title, before the calendar line.
    expect(drawer.querySelector("h3")!.nextElementSibling?.querySelector('[aria-label="Travel timing"]')).not.toBeNull();
    expect(drawer.textContent!.indexOf(first(drawer))).toBeLessThan(drawer.textContent!.indexOf("Work · "));
    expect(dialog.querySelector("[data-departure-lead]")!.className).toContain("text-base");
    expect(drawer.querySelector("[data-departure-lead]")!.className).toContain("text-sm");
  });

  it("keeps Directions after the estimate expires, for a place a route reached (correction C2)", async () => {
    const { drawer, dialog } = await renderBoth(travel, "2026-11-01T04:30:00Z", { mode: "walking" });
    for (const view of [drawer, dialog]) {
      expect(view.querySelector("[data-departure-lead]")!.textContent).toMatch(/^Last estimate/);
      const link = view.querySelector<HTMLAnchorElement>("[data-travel-navigation]")!;
      expect(link.textContent).toBe("Directions in Google Maps");
      const url = new URL(link.href);
      expect(url.pathname).toBe("/maps/dir/");
      expect(url.searchParams.get("destination")).toBe("12 Harbor Street");
      expect(url.searchParams.get("travelmode")).toBe("walking");
    }
    expect(drawer.textContent!.indexOf("Directions in Google Maps")).toBeLessThan(drawer.textContent!.indexOf("View details"));
  });

  it("says Search for a place no route has reached, and carries only the source text", async () => {
    const unrouted: Omit<TravelEvidenceResult, "modelProjection"> = { ...travel, legs: travel.legs.map((item) => ({ ...item, state: "unavailable", estimate: null, reason: "Route result is missing." })) };
    for (const evidence of [unrouted, withEstimate({}, { state: "rejected_revision" })]) {
      const { drawer, dialog } = await renderBoth(evidence, "2026-11-01T04:30:00Z", { mode: "walking" });
      for (const view of [drawer, dialog]) {
        const link = view.querySelector<HTMLAnchorElement>("[data-travel-navigation]")!;
        expect(link.textContent).toBe("Search in Google Maps");
        expect([...new URL(link.href).searchParams.values()]).toEqual(["1", "12 Harbor Street"]);
      }
    }
  });

  it("opens, saves and closes the correction from one keyboard-reachable control (INT-TRAVEL-003)", async () => {
    const corrected = vi.fn();
    const dialog = await open(full, { onTravelCorrection: corrected });
    const details = dialog.querySelector<HTMLDetailsElement>("[data-travel-correction]")!;
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe("Change for this trip");
    expect(details.open).toBe(false);
    // A native summary is in the tab order and opens with Enter or Space.
    summary.focus();
    expect(document.activeElement).toBe(summary);
    await act(() => summary.click());
    expect(details.open).toBe(true);
    details.querySelector<HTMLSelectElement>('select[name="travel_attendance"]')!.value = "remote";
    const save = [...details.querySelectorAll("button")].find((item) => item.textContent === "Use for this journey")!;
    expect(save.type).toBe("submit");
    await act(() => details.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(corrected).toHaveBeenCalledWith(expect.objectContaining({ eventId: full.id, attendance: "remote", locationText: "12 Harbor Street" }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("keeps the correction closed and unsaved until the form is complete", async () => {
    const corrected = vi.fn();
    const dialog = await open(full, { onTravelCorrection: corrected });
    const details = dialog.querySelector<HTMLDetailsElement>("[data-travel-correction]")!;
    await act(() => details.querySelector("summary")!.click());
    await act(() => details.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(corrected).not.toHaveBeenCalled();
    expect(details.open).toBe(true);
  });
});
