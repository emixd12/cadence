import { isIP } from "node:net";

// Ticket 338: Supabase Auth limits sign-in requests and code checks per IP address
// (30 each per 5 minutes). Cadence calls those endpoints from its server, so without
// this every person shares the server's address and one person's wrong codes can
// block everyone. Supabase's supported fix is the Sb-Forwarded-For header sent with a
// secret API key, after the project turns on `security_sb_forwarded_for_enabled`
// (https://supabase.com/docs/guides/auth/rate-limits).
//
// A secret key also counts as an admin call, and Supabase skips its CAPTCHA check
// for admin calls. So forwarding is on only when Cadence can run the Turnstile check
// itself: both secrets must be set. Otherwise Cadence calls Auth as before.

export const SB_FORWARDED_FOR_HEADER = "sb-forwarded-for";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8_000;

export type AuthForwarding = Readonly<{
  secretKey: string;
  turnstileSecret: string;
  clientAddress: string;
}>;

type Env = Readonly<Record<string, string | undefined>>;
type HeaderSource = { get(name: string): string | null };

/**
 * The person's address as the hosting proxy reports it. Vercel sets both headers
 * itself and drops values a client sends, so they cannot be forged there. Any other
 * host must do the same before turning forwarding on.
 */
export function clientAddressOf(headers: HeaderSource): string | null {
  const candidates = [
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0] ?? null,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value;
  }
  return null;
}

/**
 * Null keeps the earlier behaviour: publishable key, Supabase runs the CAPTCHA.
 * Only on Vercel (`VERCEL=1`), the one host where a client cannot set its own address
 * (Ticket 338 verifier, section F row 1). Under `next start` or `next dev` the address
 * headers are whatever the client sends.
 */
export function authForwardingFor(
  headers: HeaderSource,
  env: Env = process.env,
): AuthForwarding | null {
  if (env.VERCEL !== "1") return null;
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const turnstileSecret = env.CADENCE_TURNSTILE_SECRET_KEY?.trim();
  if (!secretKey?.startsWith("sb_secret_") || !turnstileSecret) return null;
  const clientAddress = clientAddressOf(headers);
  if (!clientAddress) return null;
  return { secretKey, turnstileSecret, clientAddress };
}

export function forwardedForHeaders(forwarding: AuthForwarding): Record<string, string> {
  return { [SB_FORWARDED_FOR_HEADER]: forwarding.clientAddress };
}

/**
 * Ticket 339: the session refresh (`POST /auth/v1/token?grant_type=refresh_token`)
 * counts against Auth's per-address limit like `/otp` and `/verify`. Only that call
 * gets the secret key and the person's address; every other Auth call keeps the
 * publishable key.
 */
export function isSessionRefreshUrl(url: URL, supabaseUrl: string): boolean {
  const token = new URL("auth/v1/token", supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`);
  return (
    url.origin === token.origin &&
    url.pathname === token.pathname &&
    url.searchParams.get("grant_type") === "refresh_token"
  );
}

export function withRefreshForwarding(
  init: RequestInit | undefined,
  forwarding: AuthForwarding,
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("apikey", forwarding.secretKey);
  headers.set("authorization", `Bearer ${forwarding.secretKey}`);
  headers.set(SB_FORWARDED_FOR_HEADER, forwarding.clientAddress);
  return { ...init, headers };
}

/**
 * Cloudflare's server-side check of a Turnstile token, the same call Supabase makes
 * when it runs the CAPTCHA. Any failure, including a network error, refuses.
 * Each token passes once.
 */
export async function turnstilePasses(
  token: string | undefined,
  forwarding: AuthForwarding,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: forwarding.turnstileSecret,
        response: token,
        remoteip: forwarding.clientAddress,
      }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}
