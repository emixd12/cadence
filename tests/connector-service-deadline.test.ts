import { describe, expect, it, vi } from "vitest";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";
import { getHevyActivities } from "@/lib/services/hevy.service";
import { getIcloudCalendarEventsForCaller } from "@/lib/services/icloud-calendar.service";
import { getOutlookCalendarEventsForCaller } from "@/lib/services/outlook-calendar.service";

const reads = [
  ["Hevy", getHevyActivities],
  ["Outlook Calendar", getOutlookCalendarEventsForCaller],
  ["iCloud Calendar", getIcloudCalendarEventsForCaller],
] as const;

describe.each(reads)("%s service deadline", (_provider, read) => {
  it.each(["deadline", "caller abort"])("%s settles a stalled profile query", async (cause) => {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => new Promise(() => {}) }) }) }),
    };
    const fetch = vi.fn();
    const result = read(
      { client, user: { id: "synthetic-owner" } } as unknown as ConnectorCaller,
      "2026-11-01", "2026-11-01",
      { deadlineMs: cause === "deadline" ? 20 : 1_000,
        signal: cause === "caller abort" ? AbortSignal.timeout(20) : undefined, fetch },
    ).then(() => "success", (error) => error.code);
    expect(await Promise.race([
      result, new Promise((resolve) => setTimeout(() => resolve("still_pending"), 100)),
    ])).toBe("timeout");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("late profile completion cannot start credential or provider work", async () => {
    let release!: (value: unknown) => void;
    const profile = new Promise((resolve) => { release = resolve; });
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single: () => profile }) }) }));
    const fetch = vi.fn();
    const result = read(
      { client: { from }, user: { id: "synthetic-owner" } } as unknown as ConnectorCaller,
      "2026-11-01", "2026-11-01", { deadlineMs: 20, fetch },
    ).then(() => "success", (error) => error.code);
    expect(await Promise.race([
      result, new Promise((resolve) => setTimeout(() => resolve("still_pending"), 100)),
    ])).toBe("timeout");
    release({ data: { timezone: "America/New_York" }, error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(from).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
