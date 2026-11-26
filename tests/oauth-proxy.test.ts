import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: session }));
import { config, proxy } from "@/proxy";
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue(new Response(null)); });
it("matches OAuth and refreshes consent cookies with private page headers", async () => {
  expect(config.matcher).toContain("/oauth/:path*");
  const response = await proxy(new NextRequest("https://app.cadence-me.com/oauth/consent?request=fixture"));
  expect(session).toHaveBeenCalledOnce(); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("same-origin"); expect(response.headers.get("x-frame-options")).toBe("DENY");
});
// Ticket 379: "no-referrer" makes a browser send `Origin: null` on the plain form post
// that Allow or Deny sends before the page hydrates, and that post returned 500.
it("Ticket 379: the consent page and its form post keep the Origin header and send no referrer to another origin", async () => {
  for (const method of ["GET", "POST"]) {
    const response = await proxy(new NextRequest("https://app.cadence-me.com/oauth/consent?request=fixture", { method }));
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
  }
});
it.each(["authorize", "token", "register", "revoke"])("keeps %s accessible without browser authentication", async (path) => {
  const response = await proxy(new NextRequest(`https://app.cadence-me.com/oauth/${path}`, { headers: { cookie: "sb-forged-auth-token=invalid" } }));
  expect(session).not.toHaveBeenCalled(); expect(response.headers.get("location")).toBeNull();
});
