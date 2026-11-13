import { DEFAULT_APP_ROUTE } from "@/lib/navigation";

export const LOGIN_ROUTE = "/login";
export const AUTH_CALLBACK_ROUTE = "/auth/callback";
export const MISSING_CONFIG_ERROR = "missing_supabase_config";

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
    const parsed = new URL(nextPath, "http://local.invalid");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
