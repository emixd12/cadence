import { it, expect, vi } from "vitest";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";
import { getIcloudCalendarEventsForCaller } from "@/lib/services/icloud-calendar.service";
import { icloudCalDavRequest } from "@/lib/services/icloud-calendar-request";
it.each(["deadline", "caller abort"])(
  "%s settles a stalled profile read",
  async (cause) => {
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ single: () => new Promise(() => {}) }) }),
      }),
    };
    const fetch = vi.fn();
    const work = getIcloudCalendarEventsForCaller(
      { client, user: { id: "synthetic-owner" } } as unknown as ConnectorCaller,
      "2026-11-01",
      "2026-11-01",
      {
        deadlineMs: cause === "deadline" ? 20 : 1000,
        signal: cause === "caller abort" ? AbortSignal.timeout(20) : undefined,
        fetch,
      },
    ).then(
      () => "success",
      (e) => e.code,
    );
    expect(
      await Promise.race([
        work,
        new Promise((resolve) =>
          setTimeout(() => resolve("still_pending_after_100ms"), 100),
        ),
      ]),
    ).toBe("timeout");
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("D2 caller abort settles an unresponsive provider request", async () => {
  const abort = new AbortController();
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  const work = icloudCalDavRequest(
    {
      method: "REPORT",
      url: new URL("https://p42-caldav.icloud.com/1/cal/"),
      depth: "1",
      body: "",
      calendarId: "calendar-1",
    },
    {
      login: {
        appleId: "synthetic@example.invalid",
        appPassword: "abcd-efgh-ijkl-mnop",
      },
      deadlineAt: Date.now() + 25000,
      signal: abort.signal,
      fetch,
    },
  );
  setTimeout(() => abort.abort(), 10);
  await expect(work).rejects.toMatchObject({ failure: { code: "timeout" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("late profile completion cannot start credentials or provider work after timeout", async () => {
  let release!: (value: unknown) => void;
  const profile = new Promise((resolve) => {
    release = resolve;
  });
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: () => profile }) }),
  }));
  const fetch = vi.fn();
  await expect(
    getIcloudCalendarEventsForCaller(
      { client: { from }, user: { id: "owner" } } as unknown as ConnectorCaller,
      "2026-11-01",
      "2026-11-01",
      { deadlineMs: 20, fetch },
    ),
  ).rejects.toMatchObject({ code: "timeout" });
  release({ data: { timezone: "America/New_York" }, error: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(from).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
