import { it, expect, vi } from "vitest";
import { icloudCalDavRequest } from "@/lib/services/icloud-calendar-request";
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
