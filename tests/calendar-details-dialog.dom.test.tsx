// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { ExternalEventDetails } from "@/components/timeline/ExternalEventDetails";
import { validateExternalEventSnapshot, validateVersionedExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
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
      onTravelCorrection={options.onTravelCorrection} travel={options.withTravel ? travel : null} />
  </DevelopmentBuildProvider>));
  return container.querySelector("dialog")!;
}
const labels = (scope: Element) => [...scope.querySelectorAll("dt")].map((item) => item.textContent);
const row = (scope: Element, label: string) => [...scope.querySelectorAll("dt")].find((item) => item.textContent === label)?.nextElementSibling?.textContent;

describe("Calendar details order", () => {
  it("leads with time, place and travel, then the source and people", async () => {
    const dialog = await open(full, { withTravel: true, onTravelCorrection: () => undefined });
    expect(labels(dialog)).toEqual(["Time", "Location", "Calendar", "Attendees", "Organizer", "Conference", "Attachments"]);
    const text = dialog.querySelector("article")!.textContent!;
    const positions = ["Time", "12 Harbor Street", "Outbound", "Search in Google Maps", "Google Calendar · Work", "Attendees", "Organizer", "Conference", "Attachments", "Bring the signed form", "Travel for this event"]
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

  it("shows Duration when the end is unspecified", async () => {
    const dialog = await open(openEnded);
    expect(row(dialog, "Time")).toContain("End unknown");
    expect(row(dialog, "Duration")).toBe("Unknown");
  });

  it("keeps the all-day label and its dismiss control", async () => {
    const dismissed = vi.fn();
    const dialog = await open(allDay, { onDismissAllDay: dismissed });
    expect(row(dialog, "Time")).toBe(`${allDay.startLocalDate} through ${allDay.endLocalDate} (exclusive)`);
    const dismiss = [...dialog.querySelectorAll("button")].find((item) => item.textContent === "Dismiss from timeline")!;
    await act(() => dismiss.click());
    expect(dismissed).toHaveBeenCalledWith(allDay.id);
  });

  it("offers no dismiss control on a timed event", async () => {
    expect((await open(timed)).textContent).not.toContain("Dismiss from timeline");
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
    await act(() => root.render(<ExternalEventDetails event={full} timezone="UTC" onClose={() => undefined} onDismissAllDay={() => undefined} travel={withPlace}
      travelHabits={{ settings: { enabled: true, baseLocationText: "Home", mode: "walking", navigationPreference: null, routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-11-01T00:00:00Z" }, save } as never} />));
    const text = container.querySelector("article")!.textContent!;
    expect(text.indexOf("Travel by")).toBeGreaterThan(text.indexOf("Outbound"));
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
