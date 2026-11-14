import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  authForwardingFor,
  isSessionRefreshUrl,
  withTokenGrantForwarding,
  type AuthForwarding,
} from "@/lib/auth/auth-forwarding";
import {
  authRequestUrl,
  buildLoginPath,
  LOGIN_ROUTE,
  MISSING_CONFIG_ERROR,
  normalizeRedirectPath,
} from "@/lib/auth/redirects";
import { DEFAULT_APP_ROUTE, isProtectedAppRoute } from "@/lib/navigation";
import { readSupabaseRuntimeConfig } from "@/lib/supabase/env";

type ClaimsAuthResult = {
  authenticated: boolean;
};

type AuthCallRecord = {
  unavailable: boolean;
  refreshed: boolean;
};

const LOGIN_PREVIEW_PARAM = "preview";
const LOGIN_PREVIEW_VALUE = "1";

function copySessionCookiesAndHeaders(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });

  for (const header of ["Cache-Control", "Expires", "Pragma"]) {
    const value = source.headers.get(header);
    if (value) {
      target.headers.set(header, value);
    }
  }
}

function redirectWithSessionCookies(
  request: NextRequest,
  sessionResponse: NextResponse,
  path: string,
) {
  const redirectResponse = NextResponse.redirect(
    new URL(path, authRequestUrl(request)),
  );
  copySessionCookiesAndHeaders(sessionResponse, redirectResponse);

  return redirectResponse;
}

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(
      ({ name }) => name.startsWith("sb-") && name.includes("auth-token"),
    );
}

function allowsAuthenticatedLoginPreview(request: NextRequest) {
  return (
    request.nextUrl.searchParams.get(LOGIN_PREVIEW_PARAM) ===
    LOGIN_PREVIEW_VALUE
  );
}

/**
 * Ticket 339. Auth answers a refresh of an ended session (signed out, revoked,
 * account deleted, token reused or made up) with 400, 401, 403 or 404. A 429 or a
 * server error (5xx, Cloudflare's 52x), or no answer at all, says nothing about the
 * session: Cadence keeps it and asks the browser to try again.
 */
function isUnavailableStatus(status: number) {
  return status === 429 || status >= 500;
}

function proxyAuthFetch(
  supabaseUrl: string,
  forwarding: AuthForwarding | null,
  record: AuthCallRecord,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const refresh = isSessionRefreshUrl(url, supabaseUrl);
    try {
      const response = await fetch(
        input,
        forwarding && refresh ? withTokenGrantForwarding(init, forwarding) : init,
      );
      // The last Auth answer decides: a retried call that ends in 400 has ended.
      record.unavailable = isUnavailableStatus(response.status);
      if (refresh && response.ok) record.refreshed = true;
      return response;
    } catch (error) {
      record.unavailable = true;
      throw error;
    }
  };
}

const RETRY_AFTER_SECONDS = 5;

/** No cookie is written, so the browser keeps the session it sent. */
function authUnavailableResponse(request: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Retry-After": String(RETRY_AFTER_SECONDS),
  };

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "auth_unavailable" },
      { status: 503, headers },
    );
  }

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}"><title>Cadence</title></head><body style="font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box"><p style="margin:0;max-width:28rem;line-height:1.5">Cadence could not check your sign-in just now. You are still signed in. This page tries again in a few seconds.</p></body></html>`,
    {
      status: 503,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function measureProxyAuth<T>(
  request: NextRequest,
  span: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.CADENCE_PERF_LOG !== "1") {
    return operation();
  }

  const start = performance.now();
  const route = request.nextUrl.pathname;

  try {
    const result = await operation();

    console.info(
      JSON.stringify({
        source: "cadence",
        kind: "performance_timing",
        route,
        span,
        duration_ms: Math.round((performance.now() - start) * 10) / 10,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    console.info(
      JSON.stringify({
        source: "cadence",
        kind: "performance_timing",
        route,
        span,
        duration_ms: Math.round((performance.now() - start) * 10) / 10,
        status: "error",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );

    throw error;
  }
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;
  const protectedRoute = isProtectedAppRoute(pathname);
  const config = readSupabaseRuntimeConfig();

  if (!config) {
    if (protectedRoute || pathname === "/") {
      return NextResponse.redirect(
        new URL(
          buildLoginPath(pathname, MISSING_CONFIG_ERROR),
          authRequestUrl(request),
        ),
      );
    }

    return response;
  }

  if (!hasSupabaseAuthCookie(request)) {
    if (protectedRoute) {
      return NextResponse.redirect(
        new URL(
          buildLoginPath(`${pathname}${search}`),
          authRequestUrl(request),
        ),
      );
    }

    if (pathname === "/") {
      return NextResponse.redirect(
        new URL(LOGIN_ROUTE, authRequestUrl(request)),
      );
    }

    return response;
  }

  const authCalls: AuthCallRecord = { unavailable: false, refreshed: false };
  let wroteSession = false;
  const supabase = createServerClient(config.url, config.publishableKey, {
    global: {
      fetch: proxyAuthFetch(
        config.url,
        authForwardingFor(request.headers),
        authCalls,
      ),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        const nextResponse = NextResponse.next({ request });
        // SSR can write several cookie batches and sends cache headers once.
        // Keep earlier writes while forwarding the latest request cookies.
        copySessionCookiesAndHeaders(response, nextResponse);
        response = nextResponse;

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
          if (value) wroteSession = true;
        });

        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  const authResult = await measureProxyAuth<ClaimsAuthResult>(
    request,
    "proxy.auth.get_claims",
    async () => {
      const { data, error } = await supabase.auth.getClaims();
      const subject = data?.claims?.sub;

      return {
        authenticated:
          !error && typeof subject === "string" && subject.length > 0,
      };
    },
  );

  if (!authResult.authenticated && authCalls.unavailable) {
    // A refused refresh may have written cookie removals; neither response carries
    // them. A refresh that succeeded before a later call failed (the JWKS read) has
    // already rotated the refresh token, so its new cookies go out with the answer.
    const unavailable =
      pathname === LOGIN_ROUTE
        ? NextResponse.next()
        : authUnavailableResponse(request);
    if (authCalls.refreshed && wroteSession) {
      response.cookies.getAll().forEach((cookie) => {
        unavailable.cookies.set(cookie);
      });
    }
    return unavailable;
  }

  if (protectedRoute && !authResult.authenticated) {
    return redirectWithSessionCookies(
      request,
      response,
      buildLoginPath(`${pathname}${search}`),
    );
  }

  if (
    pathname === LOGIN_ROUTE &&
    authResult.authenticated &&
    !allowsAuthenticatedLoginPreview(request)
  ) {
    const nextPath = normalizeRedirectPath(
      request.nextUrl.searchParams.get("next"),
    );
    return redirectWithSessionCookies(request, response, nextPath);
  }

  if (pathname === "/") {
    return redirectWithSessionCookies(
      request,
      response,
      authResult.authenticated ? DEFAULT_APP_ROUTE : LOGIN_ROUTE,
    );
  }

  return response;
}
