import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "reader@example.test" },
  headers: new Headers(), setCookie: vi.fn(), revalidate: vi.fn(), client: { rpc: vi.fn() },
  getConsent: vi.fn(), finishConsent: vi.fn(), requireUser: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => m.headers, cookies: async () => ({ set: m.setCookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ user: m.user, error: null }), requireCurrentUser: m.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => m.client }));
vi.mock("@/lib/services/oauth/consent", () => ({ getOAuthConsent: m.getConsent, completeOAuthConsent: m.finishConsent }));
vi.mock("@/lib/services/oauth/server", () => ({ pendingCookieName: (id: string) => `cadence_oauth_${id}` }));
import { submitOAuthConsent, getConsentPageData, getConnectedApps } from "@/lib/services/oauth-ui.service";
import { consentAction } from "@/app/oauth/consent/actions";
import { disconnectAppAction } from "@/app/(app)/settings/actions";
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idle = { status: "idle" as const, message: "" };
const issuer = "https://app.cadence-me.com";
function form(decision = "allow", scopes = ["cadence.read"]) {
  const f = new FormData();
  f.set("request_id", id); f.set("account_id", m.user.id); f.set("decision", decision);
  scopes.forEach((scope) => f.append("scope", scope)); return f;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CADENCE_OAUTH_ISSUER", issuer); vi.stubEnv("CADENCE_MCP_ENABLED", "true");
  m.headers = new Headers({ origin: issuer, cookie: "browser-bound-secret" });
  m.requireUser.mockResolvedValue(m.user);
  m.finishConsent.mockResolvedValue(new Response(null, { headers: { Location: "https://client.example/callback?code=fixture&iss=" + issuer } }));
  m.client.rpc.mockResolvedValue({ data: true, error: null });
});

describe("consent actions", () => {
  it("passes narrowed permissions and the real origin/cookie to the approved helper", async () => {
    await submitOAuthConsent(form());
    const [request, requestId, scopes, client] = m.finishConsent.mock.calls[0];
    expect(requestId).toBe(id); expect(scopes).toEqual(["cadence.read"]); expect(client).toBe(m.client);
    expect(request.method).toBe("POST"); expect(request.headers.get("origin")).toBe(issuer);
    expect(request.headers.get("cookie")).toBe("browser-bound-secret");
  });
  it("clears only the pending cookie and redirects after approval", async () => {
    await expect(consentAction(idle, form())).rejects.toThrow("REDIRECT:https://client.example/callback");
    expect(m.setCookie).toHaveBeenCalledWith(`cadence_oauth_${id}`, "", expect.objectContaining({ path: "/oauth", httpOnly: true, maxAge: 0, sameSite: "lax", secure: true }));
  });
  it("passes Deny without scopes and preserves the helper's access_denied redirect", async () => {
    m.finishConsent.mockResolvedValue(new Response(null, { headers: { Location: `https://client.example/callback?error=access_denied&iss=${issuer}` } }));
    await expect(consentAction(idle, form("deny", []))).rejects.toThrow("error=access_denied&iss=");
    expect(m.finishConsent.mock.calls[0][2]).toBeNull();
  });
  it.each([[], ["cadence.read", "unknown"], ["cadence.read", "cadence.read"]].map((scopes) => [scopes]))("rejects malformed scope selections: %j", async (scopes) => {
    expect((await consentAction(idle, form("allow", scopes))).status).toBe("error");
    expect(m.finishConsent).not.toHaveBeenCalled();
  });
  it("rejects a switched account, missing session, invalid request and invalid decision", async () => {
    const changed = form(); changed.set("account_id", "other-account");
    const badId = form(); badId.set("request_id", "bad");
    for (const input of [changed, badId, form("anything")]) expect((await consentAction(idle, input)).status).toBe("error");
    m.requireUser.mockRejectedValue(new Error("session expired"));
    expect((await consentAction(idle, form())).status).toBe("error");
    expect(m.finishConsent).not.toHaveBeenCalled();
  });
  it("does not leak errors or clear cookies when the helper rejects CSRF, expiry or replay", async () => {
    m.finishConsent.mockRejectedValue(new Error("private database details"));
    const result = await consentAction(idle, form());
    expect(result.status).toBe("error"); expect(result.message).not.toContain("private"); expect(m.setCookie).not.toHaveBeenCalled();
  });
  it("projects the consent view without request state or redirect path", async () => {
    m.getConsent.mockResolvedValue({ clientName: "App", logoUri: "https://client.example/logo.png", verifiedClient: null, redirectUri: "https://client.example/callback?private=1", scopes: ["cadence.read"], grantedScopes: [], offlineAccess: true, state: "private-state" });
    expect(await getConsentPageData(id)).toEqual({ requestId: id, accountId: m.user.id, email: m.user.email, clientName: "App", logoUri: "https://client.example/logo.png", verified: false, redirectHost: "client.example", scopes: ["cadence.read"], grantedScopes: [], offlineAccess: true });
  });
  it("shows a step-up request with the active grant's scopes, in canonical order", async () => {
    m.getConsent.mockResolvedValue({ clientName: "App", logoUri: null, verifiedClient: "claude", redirectUri: "https://claude.ai/api/mcp/auth_callback", scopes: ["cadence.read", "cadence.behaviors.write"], grantedScopes: ["cadence.read", "cadence.occurrences.write"], offlineAccess: true, state: null });
    expect(await getConsentPageData(id)).toMatchObject({ scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"], grantedScopes: ["cadence.read", "cadence.occurrences.write"] });
  });
});

describe("Connected apps actions", () => {
  it("uses the authenticated grant-revocation RPC and revalidates Settings only after success", async () => {
    const f = new FormData(); f.set("grant_id", id);
    expect((await disconnectAppAction(idle, f)).status).toBe("success");
    expect(m.client.rpc).toHaveBeenCalledWith("oauth_revoke_grant", { p_grant_id: id });
    expect(m.revalidate).toHaveBeenCalledWith("/settings");
  });
  it("rejects cross-origin, missing-origin and invalid grant inputs without calling the RPC", async () => {
    const f = new FormData(); f.set("grant_id", id);
    for (const origin of ["https://evil.example", ""]) {
      m.headers = new Headers(origin ? { origin } : {});
      expect((await disconnectAppAction(idle, f)).status).toBe("error");
    }
    m.headers = new Headers({ origin: issuer }); f.set("grant_id", "bad");
    expect((await disconnectAppAction(idle, f)).status).toBe("error"); expect(m.client.rpc).not.toHaveBeenCalled();
  });
  it("does not report success for another user's grant or a database error", async () => {
    const f = new FormData(); f.set("grant_id", id);
    for (const result of [{ data: false, error: null }, { data: null, error: { message: "private details", code: "42501" } }]) {
      m.client.rpc.mockResolvedValue(result);
      expect((await disconnectAppAction(idle, f)).status).toBe("error");
    }
    expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("renders a recoverable load failure without leaking errors", async () => {
    m.client.rpc.mockRejectedValue(new Error("private details"));
    expect(await getConnectedApps()).toEqual({ grants: [], activity: [], error: "Connected apps could not load. Reload Settings to try again." });
  });
});
