import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { authenticateCalendarRequest } from "@/lib/services/google-calendar-request";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner" } },
    error: null,
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
});
afterEach(() => vi.unstubAllEnvs());

describe("Calendar and Daily Brief request authentication", () => {
  it.each(["127.0.0.1", "localhost"])(
    "accepts same-origin local writes on %s",
    async (host) => {
      const request = new NextRequest(
        "http://127.0.0.1:4324/api/advisor/preferences",
        {
          method: "PUT",
          headers: { host: `${host}:4324`, origin: `http://${host}:4324` },
        },
      );
      await expect(authenticateCalendarRequest(request)).resolves.toMatchObject(
        { user: { id: "owner" } },
      );
      expect(mocks.getUser).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["127.0.0.1:4324", "http://localhost:4324"],
    ["127.0.0.1:4324", "http://127.0.0.1:4325"],
    ["127.0.0.1:4324", "https://attacker.invalid"],
    ["attacker.invalid", "https://attacker.invalid"],
    ["127.0.0.1:4324", ""],
  ])(
    "rejects cross-origin or missing-origin writes: %s %s",
    async (host, origin) => {
      const request = new NextRequest(
        "http://localhost:4324/api/advisor/preferences",
        {
          method: "PUT",
          headers: { host, origin },
        },
      );
      await expect(authenticateCalendarRequest(request)).rejects.toMatchObject({
        code: "unauthenticated",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("keeps production host overrides untrusted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest(
      "https://app.cadence-me.com/api/advisor/preferences",
      {
        method: "PUT",
        headers: { host: "127.0.0.1:4324", origin: "http://127.0.0.1:4324" },
      },
    );
    await expect(authenticateCalendarRequest(request)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});


it("rejects agent and invalid purposes at the Timeline event endpoint", async () => {
  const { GET } = await import("@/app/api/google-calendar/events/route");
  const { calendarRequestPurpose } = await import("@/lib/services/google-calendar-request");
  expect(calendarRequestPurpose(new Request("https://cadence.example/api/google-calendar/connection"))).toBe("standard");
  expect(calendarRequestPurpose(new Request("https://cadence.example/api/google-calendar/connection?purpose=agent"))).toBe("agent");
  for (const purpose of ["agent", "unknown"]) {
    const response = await GET(new Request(`https://cadence.example/api/google-calendar/events?purpose=${purpose}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  }
});
