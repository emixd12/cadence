import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@/lib/supabase/proxy";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

describe("Supabase proxy session update", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("redirects anonymous protected route requests without creating a Supabase client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    const response = await updateSession(
      new NextRequest("http://localhost:3000/timeline"),
    );

    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Ftimeline",
    );
  });

  it("lets anonymous login requests continue without creating a Supabase client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    const response = await updateSession(
      new NextRequest("http://localhost:3000/login"),
    );

    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets authenticated protected route requests continue after claims validation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: "user-1",
        },
      },
      error: null,
    });

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims,
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/timeline"),
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBeNull();
  });

  it("forwards refreshed auth cookies for authenticated export API requests", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getClaims = vi.fn().mockImplementation(async () => ({
      data: {
        claims: {
          sub: "user-1",
        },
      },
      error: null,
    }));

    vi.mocked(createServerClient).mockImplementation(
      ((...args: unknown[]) => {
        const options = args[2] as {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string;
                value: string;
                options: { path: string };
              }>,
              headers: Record<string, string>,
            ) => void;
          };
        };
        getClaims.mockImplementationOnce(async () => {
          options.cookies.setAll(
            [
              {
                name: "sb-test-auth-token",
                value: "refreshed-token",
                options: { path: "/" },
              },
            ],
            { "cache-control": "private, no-store" },
          );
          return {
            data: {
              claims: {
                sub: "user-1",
              },
            },
            error: null,
          };
        });
        return {
          auth: {
            getClaims,
          },
        };
      }) as never,
    );

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/api/export/json"),
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe(
      "refreshed-token",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });

  it("leaves anonymous export API authentication to the route response", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    const response = await updateSession(
      new NextRequest("http://localhost:3000/api/export/json"),
    );

    expect(createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    { label: "continuing an authenticated request", authenticated: true },
    { label: "redirecting an invalid session", authenticated: false },
  ])("preserves cookie batches and cache headers when $label", async ({ authenticated }) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const verifierName = "sb-test-auth-token-flow-0123456789abcdef-code-verifier";
    const indexName = "sb-test-auth-token-flows-code-verifier";
    const sessionName = "sb-test-auth-token";
    const request = requestWithAuthCookie("http://localhost:3000/timeline");
    request.cookies.set(verifierName, "pending-verifier");
    request.cookies.set(indexName, "pending-flow-index");

    vi.mocked(createServerClient).mockImplementation(
      ((...args: unknown[]) => {
        const options = args[2] as {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string;
                value: string;
                options: { path: string; maxAge?: number };
              }>,
              headers: Record<string, string>,
            ) => void;
          };
        };

        return {
          auth: {
            async getClaims() {
              // SSR sends cache headers once, even when PKCE cleanup writes
              // several batches before the final session update.
              options.cookies.setAll(
                [{ name: verifierName, value: "", options: { path: "/", maxAge: 0 } }],
                { "Cache-Control": "no-store", Expires: "0", Pragma: "no-cache" },
              );
              options.cookies.setAll(
                [{ name: indexName, value: "", options: { path: "/", maxAge: 0 } }],
                {},
              );
              options.cookies.setAll(
                [{
                  name: sessionName,
                  value: authenticated ? "refreshed-token" : "",
                  options: authenticated ? { path: "/" } : { path: "/", maxAge: 0 },
                }],
                {},
              );
              return authenticated
                ? { data: { claims: { sub: "user-1" } }, error: null }
                : { data: null, error: new Error("invalid token") };
            },
          },
        };
      }) as never,
    );

    const response = await updateSession(request);

    expect(response.status).toBe(authenticated ? 200 : 307);
    expect(response.headers.get("location")).toBe(
      authenticated ? null : "http://localhost:3000/login?next=%2Ftimeline",
    );
    expect(response.cookies.getAll()).toHaveLength(3);
    for (const name of [verifierName, indexName]) {
      expect(response.cookies.get(name)).toMatchObject({ value: "", path: "/", maxAge: 0 });
    }
    expect(response.cookies.get(sessionName)?.value).toBe(authenticated ? "refreshed-token" : "");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    if (authenticated) {
      expect(response.headers.get("x-middleware-request-cookie")).toContain(`${sessionName}=refreshed-token`);
    }
  });

  it("does not redirect invalid export API sessions to the login document", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getClaims = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("invalid token"),
    });

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims,
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/api/export/json"),
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects protected route requests when claims validation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getClaims = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("invalid token"),
    });

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims,
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/timeline?from=test"),
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Ftimeline%3Ffrom%3Dtest",
    );
  });

  it("redirects authenticated login requests to the requested app route", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "user-1",
            },
          },
          error: null,
        }),
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/login?next=%2Fsettings"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings",
    );
  });

  it("lets authenticated login preview requests continue", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: "user-1",
        },
      },
      error: null,
    });

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims,
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie(
        "http://localhost:3000/login?preview=1&next=%2Fsettings",
      ),
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets authenticated production login preview requests continue", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "user-1",
            },
          },
          error: null,
        }),
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie(
        "https://cadence-blush-three.vercel.app/login?preview=1&next=%2Fsettings",
      ),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects ordinary authenticated login requests in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "user-1",
            },
          },
          error: null,
        }),
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("https://cadence.example/login?next=%2Fsettings"),
    );

    expect(response.headers.get("location")).toBe(
      "https://cadence.example/settings",
    );
  });

  it("redirects authenticated root requests to the default app route", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "user-1",
            },
          },
          error: null,
        }),
      },
    } as never);

    const response = await updateSession(
      requestWithAuthCookie("http://localhost:3000/"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/timeline",
    );
  });
});

function requestWithAuthCookie(url: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      cookie: "sb-test-auth-token=header.payload.signature",
    },
  });
}

// Ticket 339: what a refused session refresh does. The real attack runs in
// tests/session-refresh-rate-limit.local-integration.test.ts.
//
// What can go wrong:
// 1. A 429, a 5xx or a network failure clears the cookie or redirects to /login.
// 2. A 400, 401, 403 or 404 (the session has ended) keeps the cookie.
// 3. A retried refresh that ends in 400 is kept because an earlier try was a 503.
// 4. The secret key or the address goes on any call but the refresh, or goes out
//    without Vercel, or without both Ticket 338 secrets.
// 5. Without forwarding, the refresh call changes.
describe("Supabase proxy refused refresh (Ticket 339)", () => {
  const TOKEN_URL = "https://supabase.example/auth/v1/token?grant_type=refresh_token";
  const JWKS_URL = "https://supabase.example/auth/v1/.well-known/jwks.json";
  const SESSION = "sb-test-auth-token";
  type Answer = number | "network";

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubAuth(answers: Answer[], calls: string[] = [TOKEN_URL]) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    const queue = [...answers];
    const network = vi.fn(async () => {
      const answer = queue.shift() ?? 200;
      if (answer === "network") throw new TypeError("fetch failed");
      return new Response("{}", { status: answer });
    });
    vi.stubGlobal("fetch", network);

    vi.mocked(createServerClient).mockImplementation(((...args: unknown[]) => {
      const options = args[2] as {
        global: { fetch: typeof fetch };
        cookies: { setAll: (c: Array<{ name: string; value: string; options: object }>, h: Record<string, string>) => void };
      };
      return {
        auth: {
          async getClaims() {
            // Like auth-js: try each call; a refused refresh removes the session.
            for (const url of calls) {
              try {
                await options.global.fetch(url, {
                  method: url === TOKEN_URL ? "POST" : "GET",
                  headers: { apikey: "publishable-key", Authorization: "Bearer publishable-key" },
                });
              } catch {}
            }
            options.cookies.setAll([{ name: SESSION, value: "", options: { path: "/", maxAge: 0 } }], {});
            return { data: null, error: new Error("refresh failed") };
          },
        },
      };
    }) as never);
    return network;
  }

  it.each([429, 500, 503, 522, "network" as const])("keeps the session when Auth answers %s", async (answer) => {
    stubAuth([answer]);
    const response = await updateSession(requestWithAuthCookie("http://localhost:3000/timeline"));

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toContain("You are still signed in.");
  });

  it.each([400, 401, 403, 404])("ends the session when Auth answers %s", async (answer) => {
    stubAuth([answer]);
    const response = await updateSession(requestWithAuthCookie("http://localhost:3000/timeline"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Ftimeline");
    expect(response.cookies.get(SESSION)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("lets the last Auth answer decide", async () => {
    stubAuth([503, 400], [TOKEN_URL, TOKEN_URL]);
    const ended = await updateSession(requestWithAuthCookie("http://localhost:3000/timeline"));
    expect(ended.status).toBe(307);

    stubAuth([200, 503], [TOKEN_URL, JWKS_URL]);
    const kept = await updateSession(requestWithAuthCookie("http://localhost:3000/timeline"));
    expect(kept.status).toBe(503);
  });

  it("answers the export API in JSON, the root with the page and shows /login unchanged", async () => {
    stubAuth([429]);
    const api = await updateSession(requestWithAuthCookie("http://localhost:3000/api/export/json"));
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "auth_unavailable" });
    expect(api.headers.getSetCookie()).toEqual([]);

    stubAuth([429]);
    expect((await updateSession(requestWithAuthCookie("http://localhost:3000/"))).status).toBe(503);

    stubAuth([429]);
    const login = await updateSession(requestWithAuthCookie("http://localhost:3000/login"));
    expect(login.status).toBe(200);
    expect(login.headers.get("location")).toBeNull();
    expect(login.headers.getSetCookie()).toEqual([]);
    expect(login.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  function forwardingRequest(path = "/timeline") {
    return new NextRequest(`https://app.cadence.example${path}`, {
      headers: { cookie: `${SESSION}=header.payload.signature`, "x-real-ip": "198.51.100.7" },
    });
  }

  const headersOf = (network: ReturnType<typeof vi.fn>, index: number) =>
    new Headers((network.mock.calls[index] as unknown as [string, RequestInit])[1].headers);

  it("sends the secret key and the address with the refresh only, on Vercel with both secrets", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("CADENCE_TURNSTILE_SECRET_KEY", "turnstile");
    const network = stubAuth([400, 200], [TOKEN_URL, JWKS_URL]);
    await updateSession(forwardingRequest());

    const refresh = headersOf(network, 0);
    expect(refresh.get("apikey")).toBe("sb_secret_test");
    expect(refresh.get("authorization")).toBe("Bearer sb_secret_test");
    expect(refresh.get("sb-forwarded-for")).toBe("198.51.100.7");
    const jwks = headersOf(network, 1);
    expect(jwks.get("apikey")).toBe("publishable-key");
    expect(jwks.get("sb-forwarded-for")).toBeNull();
  });

  it.each([
    { label: "off Vercel", env: { SUPABASE_SECRET_KEY: "sb_secret_test", CADENCE_TURNSTILE_SECRET_KEY: "turnstile" } },
    { label: "without the Turnstile secret", env: { VERCEL: "1", SUPABASE_SECRET_KEY: "sb_secret_test" } },
    { label: "without the secret key", env: { VERCEL: "1", CADENCE_TURNSTILE_SECRET_KEY: "turnstile" } },
  ])("sends the refresh unchanged $label", async ({ env }) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const network = stubAuth([400]);
    await updateSession(forwardingRequest());

    const [url, init] = network.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.headers).toEqual({ apikey: "publishable-key", Authorization: "Bearer publishable-key" });
  });
});
