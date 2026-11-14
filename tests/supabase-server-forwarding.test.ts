import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 340: the cookie client (lib/supabase/server.ts) forwards the person's address
// with the secret key on the refresh and the sign-in callback's code exchange only.
// Real @supabase/ssr and auth-js; the network and Next's request store are stubbed.
//
// What can go wrong:
// 1. With forwarding off (a variable unset, off Vercel, no address), the client
//    changes: another fetch, another key, an extra header, or a read of the headers.
// 2. With forwarding on, the secret key or the address reaches any other call:
//    PostgREST, /user, /logout.
// 3. The exchange stops reading or removing the code-verifier cookie, or writes the
//    session cookies differently with forwarding on.

const store = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  writes: [] as Array<{ name: string; value: string }>,
  headers: new Headers(),
  headersRead: 0,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [...store.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      store.writes.push({ name, value });
      if (value) store.cookies.set(name, value);
      else store.cookies.delete(name);
    },
  })),
  headers: vi.fn(async () => {
    store.headersRead += 1;
    return store.headers;
  }),
}));

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return { ...actual, createServerClient: vi.fn(actual.createServerClient) };
});

import { createServerClient } from "@supabase/ssr";
import { createClient, fetchWithJwtIssuedAtFutureRetry } from "@/lib/supabase/server";

const SUPABASE_URL = "https://supabase.example";
const SESSION_COOKIE = "sb-supabase-auth-token";
const VERIFIER_COOKIE = `${SESSION_COOKIE}-code-verifier`;
const SECRET = "sb_secret_test";
const ADDRESS = "198.51.100.7";
const encode = (value: unknown) => `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;

function jwt(expiresAt: number) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "user-1", exp: expiresAt, aud: "authenticated", role: "authenticated" })}.signature`;
}

function sessionBody() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: jwt(expiresAt),
    refresh_token: "new-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: "user-1", aud: "authenticated", role: "authenticated", email: "person@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-11-13T00:00:00Z" },
  };
}

type Call = { url: string; headers: Record<string, string>; body: string | null };

function stubNetwork() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (url.includes("/auth/v1/token")) return Response.json(sessionBody());
      if (url.includes("/auth/v1/user")) return Response.json(sessionBody().user);
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      return Response.json([]);
    }),
  );
  return calls;
}

const forwardingEnv = { VERCEL: "1", SUPABASE_SECRET_KEY: SECRET, CADENCE_TURNSTILE_SECRET_KEY: "turnstile" };
const offCases = [
  { label: "with no variables", env: {}, address: true },
  { label: "off Vercel", env: { SUPABASE_SECRET_KEY: SECRET, CADENCE_TURNSTILE_SECRET_KEY: "turnstile" }, address: true },
  { label: "without the Turnstile secret", env: { VERCEL: "1", SUPABASE_SECRET_KEY: SECRET }, address: true },
  { label: "without the secret key", env: { VERCEL: "1", CADENCE_TURNSTILE_SECRET_KEY: "turnstile" }, address: true },
  { label: "without an address", env: forwardingEnv, address: false },
];

function setUp(env: Record<string, string>, address: boolean) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  for (const name of ["VERCEL", "SUPABASE_SECRET_KEY", "CADENCE_TURNSTILE_SECRET_KEY"]) vi.stubEnv(name, env[name as keyof typeof env] ?? "");
  store.headers = new Headers(address ? { "x-real-ip": ADDRESS, "x-forwarded-for": ADDRESS } : {});
}

async function exchange(env: Record<string, string>, address: boolean) {
  setUp(env, address);
  store.cookies = new Map([[VERIFIER_COOKIE, encode("the-code-verifier")]]);
  store.writes = [];
  const calls = stubNetwork();
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession("the-auth-code");
  expect(error).toBeNull();
  return { calls, writes: store.writes.map(({ name, value }) => ({ name, set: value !== "" })) };
}

const without = (headers: Record<string, string>, names: string[]) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !names.includes(name)));

beforeEach(() => {
  store.headersRead = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createClient with forwarding off (Ticket 340)", () => {
  it.each(offCases)("keeps the earlier fetch and key $label", async ({ env, address }) => {
    const { calls } = await exchange(env, address);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`);
    expect(calls[0].headers.apikey).toBe("publishable-key");
    expect(calls[0].headers.authorization).toBe("Bearer publishable-key");
    expect(calls[0].headers["sb-forwarded-for"]).toBeUndefined();
    expect(JSON.parse(calls[0].body!)).toEqual({ auth_code: "the-auth-code", code_verifier: "the-code-verifier" });
  });

  it("passes the earlier fetch function itself to Supabase and never reads the headers without the variables", async () => {
    const spy = vi.mocked(createServerClient);
    spy.mockClear();
    setUp({}, true);
    await createClient();
    const options = spy.mock.calls[0][2] as { global: { fetch: unknown; headers?: unknown } };
    expect(options.global.fetch).toBe(fetchWithJwtIssuedAtFutureRetry);
    expect(options.global.headers).toBeUndefined();
    expect(spy.mock.calls[0][1]).toBe("publishable-key");
    expect(store.headersRead).toBe(0);
  });
});

describe("createClient with forwarding on (Ticket 340)", () => {
  it("sends the secret key and the address with the code exchange, and nothing else changes", async () => {
    const off = await exchange({}, true);
    const on = await exchange(forwardingEnv, true);

    expect(on.calls).toHaveLength(1);
    expect(on.calls[0].url).toBe(off.calls[0].url);
    expect(on.calls[0].body).toBe(off.calls[0].body);
    expect(on.calls[0].headers.apikey).toBe(SECRET);
    expect(on.calls[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(on.calls[0].headers["sb-forwarded-for"]).toBe(ADDRESS);
    const forwarded = ["apikey", "authorization", "sb-forwarded-for"];
    expect(without(on.calls[0].headers, forwarded)).toEqual(without(off.calls[0].headers, forwarded));

    // The verifier cookie is removed and the session written, the same both ways.
    expect(on.writes).toEqual(off.writes);
    expect(on.writes).toContainEqual({ name: VERIFIER_COOKIE, set: false });
    expect(on.writes.some(({ name, set }) => name.startsWith(SESSION_COOKIE) && name !== VERIFIER_COOKIE && set)).toBe(true);
  });

  it("forwards a refresh of an expired session, but not /user, /logout or PostgREST", async () => {
    setUp(forwardingEnv, true);
    const expired = { ...sessionBody(), expires_at: Math.floor(Date.now() / 1000) - 10, refresh_token: "old-refresh-token" };
    store.cookies = new Map([[SESSION_COOKIE, encode(expired)]]);
    const calls = stubNetwork();
    const supabase = await createClient();

    await supabase.auth.getUser();
    await supabase.from("profiles").select("id");
    await supabase.auth.signOut({ scope: "local" });

    const refresh = calls.filter((c) => c.url.endsWith("/auth/v1/token?grant_type=refresh_token"));
    expect(refresh).toHaveLength(1);
    expect(refresh[0].headers).toMatchObject({ apikey: SECRET, authorization: `Bearer ${SECRET}`, "sb-forwarded-for": ADDRESS });

    const others = calls.filter((c) => c !== refresh[0]);
    expect(others.map((c) => new URL(c.url).pathname)).toEqual(["/auth/v1/user", "/rest/v1/profiles", "/auth/v1/logout"]);
    for (const call of others) {
      expect(call.headers.apikey).toBe("publishable-key");
      expect(call.headers.authorization).not.toContain(SECRET);
      expect(call.headers["sb-forwarded-for"]).toBeUndefined();
    }
  });

  it("makes no Auth call for a request without a person's cookies, as a job's", async () => {
    setUp(forwardingEnv, true);
    store.cookies = new Map();
    const calls = stubNetwork();
    const supabase = await createClient();
    await supabase.auth.getUser();
    expect(calls.filter((c) => c.url.includes("/auth/v1/"))).toEqual([]);
  });
});
