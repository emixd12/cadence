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
