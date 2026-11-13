import { DEFAULT_APP_ROUTE } from "@/lib/navigation";

export const LOGIN_ROUTE = "/login";
export const AUTH_CALLBACK_ROUTE = "/auth/callback";
export const MISSING_CONFIG_ERROR = "missing_supabase_config";

const REDIRECT_PARSE_BASE = "http://local.invalid";

type RedirectParam = string | string[] | null | undefined;

export function authRequestUrl(request: {
  url: string;
  headers: Headers;
}): URL {
  const url = new URL(request.url);
  const host = request.headers.get("host");

  // Next.js normalizes loopback URLs and may substitute the server's bind address.
  // Recover only the same-port, approved local origin; never trust arbitrary hosts.
  if (
    process.env.NODE_ENV === "development" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    host &&
    /^(localhost|127\.0\.0\.1):43(2[1-9]|30)$/.test(host) &&
    host.endsWith(`:${url.port}`)
  ) {
    url.host = host;
  }

  return url;
}

function firstParamValue(value: RedirectParam) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeRedirectPath(
  value: RedirectParam,
  fallbackPath: string = DEFAULT_APP_ROUTE,
) {
  const nextPath = firstParamValue(value);

  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return fallbackPath;
  }

  try {
    const parsed = new URL(nextPath, REDIRECT_PARSE_BASE);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    // "/\host" parses to another host, and "/.//host" to the path "//host",
    // which a browser reads as another site.
    if (parsed.origin !== REDIRECT_PARSE_BASE || path.startsWith("//")) {
      return fallbackPath;
    }

    return path;
  } catch {
    return fallbackPath;
  }
}

export function buildLoginPath(nextPath?: RedirectParam, error?: string) {
  const params = new URLSearchParams();

  if (nextPath) {
    params.set("next", normalizeRedirectPath(nextPath));
  }

  if (error) {
    params.set("error", error);
  }

  const query = params.toString();
  return query ? `${LOGIN_ROUTE}?${query}` : LOGIN_ROUTE;
}

export function getAuthErrorMessage(value: RedirectParam) {
  const error = firstParamValue(value);

  if (!error) return null;

  if (error === MISSING_CONFIG_ERROR) {
    return "Supabase is not configured yet. Add the public Supabase URL and publishable key to .env.local.";
  }

  if (error === "missing_auth_code") {
    return "Sign-in did not return an auth code. Try signing in again.";
  }

  if (error === "auth_callback_failed") {
    return "The sign-in could not be verified. Try signing in again.";
  }

  // Ticket 333: the one error that names a provider, because the fix is in Apple's settings.
  if (error === "apple_email_missing") {
    return "Apple did not share an email address, and Cadence needs one. In your Apple Account settings, stop using Sign in with Apple for Cadence, then try again and share an email.";
  }

  if (error === "reauth_required") {
    return "Sign in again to change how you sign in. Cadence asks when the last sign-in was more than 15 minutes ago.";
  }

  if (error === "sign_in_method_unavailable") {
    return "That sign-in method is not available. Choose another.";
  }

  if (error === "test_login_unavailable") {
    return "Temporary test login is not available in this environment.";
  }

  if (error === "test_login_failed") {
    return "Temporary test login could not be started. Check the local Supabase test login settings.";
  }

  if (error === "test_login_quota_reached") {
    return "Temporary test login reached this app process's 10-user creation limit. Clean up temporary users, then restart the local app.";
  }

  return "Sign-in could not finish. Try again.";
}
