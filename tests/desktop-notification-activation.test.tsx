import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "./helpers/render-with-refresh";
import { latestNotificationOccurrenceId, loadNotificationOccurrence, notificationOccurrenceId } from "../apps/desktop/src/notification-activation";
import { TimelineScreen } from "../apps/desktop/src/timeline-screen";
import { OccurrenceRow } from "../components/timeline/OccurrenceRow";
import { localCommand } from "../apps/desktop/src/local-store";
import { resolvePersistedTimeline, resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import { storedBehavior, USER_ID } from "./helpers/export-row-fixture";

vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: vi.fn() }));

const NOW = Temporal.Instant.from("2026-08-30T16:00:00Z");
const ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const profile = { id: USER_ID, timezone: "America/New_York" };
const behavior = storedBehavior();
const actions = {
  statusAction: async () => ({ status: "success" as const, message: "" }),
  noteAction: async () => ({ status: "success" as const, message: "" }),
  startTimeTrackingAction: async () => ({ status: "success" as const, message: "" }),
  stopTimeTrackingAction: async () => ({ status: "success" as const, message: "" }),
  resetTimeTrackingAction: async () => ({ status: "success" as const, message: "" }),
};
function row(overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord {
  return {
    id: ID, user_id: USER_ID, behavior_id: behavior.id, behavior_configuration_event_id: null,
    behavior_schedule_slot_id: null, scheduled_for: "2026-08-30T13:00:00Z", local_date: "2026-08-30",
    schedule_kind: "exact", schedule_preset: null, schedule_start_time: "09:00", schedule_end_time: null,
    schedule_range_identity: null, status: "unresolved", completed_at: null, status_marked_at: null,
    note: "Saved context", created_at: NOW.toString(), updated_at: NOW.toString(), ...overrides,
  };
}
function timeline(occurrences: OccurrenceRecord[] = []) {
  return resolvePersistedTimeline({ behaviors: [behavior], occurrences, timeSessions: [], now: NOW, timezone: profile.timezone });
}
function view(occurrence: OccurrenceRecord) {
  return resolvePersistedTimelineOccurrence({ behavior, occurrence, timeSessions: [], now: NOW, timezone: profile.timezone })!;
}

describe("native reminder activation", () => {
  beforeEach(() => vi.mocked(localCommand).mockReset());

  it("accepts only the product prefix and one complete UUID", () => {
    expect(notificationOccurrenceId(`cadence.local.${ID}`)).toBe(ID);
    for (const invalid of [undefined, null, 3, ID, `cadence-spike.${ID}`, `Cadence.local.${ID}`,
      `cadence.local.${ID}\n`, `cadence.local.${ID}/extra`, `cadence.local.${ID}?target=other`,
      "cadence.local.not-a-uuid", `prefix.cadence.local.${ID}`]) {
      expect(notificationOccurrenceId(invalid)).toBeNull();
    }
  });

  it("uses the latest valid activation and ignores delivery, bench, and malformed events", () => {
    expect(latestNotificationOccurrenceId([
      { kind: "notificationActivated", id: `cadence.local.${ID}`, at: "first" },
      { kind: "notificationActivated", id: `cadence.local.${OTHER_ID}`, at: "second" },
      { kind: "notificationDelivered", id: `cadence.local.${ID}`, at: "third" },
      { kind: "notificationActivated", id: "cadence-spike.1", at: "fourth" },
    ])).toBe(OTHER_ID);
    expect(latestNotificationOccurrenceId([{ kind: "notificationActivated", id: "cadence.local.invalid", at: "now" }])).toBeNull();
  });

  it("loads an archived, old resolved Occurrence directly without widening or regenerating the feed", async () => {
    const occurrence = row({ local_date: "2026-06-01", scheduled_for: "2026-06-01T13:00:00Z",
      status: "completed", status_marked_at: "2026-06-01T13:01:00Z", completed_at: "2026-06-01T13:01:00Z" });
    vi.mocked(localCommand).mockResolvedValueOnce(occurrence).mockResolvedValueOnce({ statusEvents: [], timeSessions: [{
      id: "session", user_id: USER_ID, behavior_id: behavior.id, occurrence_id: ID,
      started_at: "2026-06-01T13:00:00Z", stopped_at: "2026-06-01T13:01:00Z",
      created_at: NOW.toString(), updated_at: NOW.toString(),
    }] }).mockResolvedValueOnce([]);
    const result = await loadNotificationOccurrence({ occurrenceId: ID, profile,
      behaviors: [{ ...behavior, active: false, archived_at: NOW.toString() }], now: NOW });
    expect(result).toMatchObject({ id: ID, localDate: "2026-06-01", status: "completed", note: "Saved context",
      canStartTimeTracking: false, timeTracking: { recordedSeconds: 60, runningStartedAt: null } });
    expect(localCommand).toHaveBeenNthCalledWith(1, "readOccurrence", { profileId: USER_ID, occurrenceId: ID });
    expect(localCommand).toHaveBeenNthCalledWith(2, "readOccurrenceHistory", { profileId: USER_ID, occurrenceIds: [ID] });
    expect(localCommand).toHaveBeenNthCalledWith(3, "readOccurrenceMoves", { profileId: USER_ID, occurrenceIds: [ID] });
    expect(localCommand).toHaveBeenCalledTimes(3);
  });

  it("preserves eligibility for a target beyond the 30-day feed limit", () => {
    const occurrence = row({ local_date: "2026-11-01", scheduled_for: "2026-11-01T14:00:00Z" });
    expect(view(occurrence)).toMatchObject({ id: ID, localDate: "2026-11-01", canStartTimeTracking: false, showDecisionActions: false });
    expect(timeline([occurrence]).daySections.flatMap((section) => section.occurrences)).toHaveLength(0);
  });

  it("uses exactly the normal row view for a target already in the feed", () => {
    const occurrence = row();
    expect(view(occurrence)).toEqual(timeline([occurrence]).daySections[0].occurrences[0]);
  });

  it("reports a deleted target without querying unrelated history", async () => {
    vi.mocked(localCommand).mockResolvedValueOnce(null);
    expect(await loadNotificationOccurrence({ occurrenceId: ID, profile, behaviors: [behavior], now: NOW })).toBeNull();
    expect(localCommand).toHaveBeenCalledTimes(1);
  });

  it("does not hide a storage error as a deleted target", async () => {
    vi.mocked(localCommand).mockRejectedValueOnce(new Error("SQLite read failed"));
    await expect(loadNotificationOccurrence({ occurrenceId: ID, profile, behaviors: [behavior], now: NOW })).rejects.toThrow("SQLite read failed");
  });

  it.each([true, false])("renders one actionable target when the feed contains it: %s", (inFeed) => {
    const occurrence = row(inFeed ? {} : { local_date: "2026-06-01", scheduled_for: "2026-06-01T13:00:00Z", status: "completed" });
    const html = renderToStaticMarkup(<TimelineScreen timeline={timeline(inFeed ? [occurrence] : [])}
      {...actions} onRefresh={vi.fn()} onShowMore={vi.fn()}
      notificationTarget={{ requestKey: 1, status: "available", occurrence: view(occurrence) }} />);
    expect(html).toContain("Opened reminder for Brush teeth");
    expect(html.match(new RegExp(`data-occurrence-id="${ID}"`, "g"))).toHaveLength(1);
    expect(html).toContain('name="expected_note" value="Saved context"');
  });

  it("uses unique disclosure IDs when the same target also appears in Needs decision", () => {
    const occurrence = view(row());
    const html = renderToStaticMarkup(<><OccurrenceRow occurrence={occurrence} {...actions} /><OccurrenceRow occurrence={occurrence} {...actions} /></>);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`aria-controls="${id}"`);
  });

  it("shows a factual unavailable target without invented row actions", () => {
    const html = renderToStaticMarkup(<TimelineScreen timeline={timeline()} {...actions}
      onRefresh={vi.fn()} onShowMore={vi.fn()} notificationTarget={{ requestKey: 2, status: "unavailable" }} />);
    expect(html).toContain("no longer available in this local profile");
    expect(html).not.toContain("data-occurrence-id");
  });
});
