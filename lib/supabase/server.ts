import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import {
  authForwardingConfigured,
  authForwardingFor,
  forwardedForHeaders,
  isPersonTokenGrantUrl,
  withTokenGrantForwarding,
  type AuthForwarding,
} from "@/lib/auth/auth-forwarding";
import { getSupabaseRuntimeConfig } from "@/lib/supabase/env";

const JWT_CLOCK_SKEW_RETRY_DELAY_MS = 1_000;

/**
 * With `forwarding`, Auth calls carry the person's address and the secret key
 * (Ticket 338). Use it only for the email code and link checks.
 *
 * Ticket 340: with the same conditions met, the refresh and the code exchange of this
 * client carry the person's address and the secret key too, and nothing else does.
 */
export async function createClient(
  options: { forwarding?: AuthForwarding | null } = {},
) {
  const { url, publishableKey } = getSupabaseRuntimeConfig();
  const cookieStore = await cookies();
  const forwarding = options.forwarding ?? null;
  const tokenGrantForwarding = authForwardingConfigured()
    ? authForwardingFor(await headers())
    : null;

  return createServerClient(url, forwarding?.secretKey ?? publishableKey, {
    global: {
      fetch: tokenGrantForwardingFetch(url, tokenGrantForwarding),
      ...(forwarding ? { headers: forwardedForHeaders(forwarding) } : {}),
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies; proxy.ts writes refreshed auth cookies.
        }
      },
    },
  });
}

/** Without forwarding, the same fetch as before Ticket 340. */
export function tokenGrantForwardingFetch(
  supabaseUrl: string,
  forwarding: AuthForwarding | null,
): typeof fetch {
  if (!forwarding) return fetchWithJwtIssuedAtFutureRetry;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return fetchWithJwtIssuedAtFutureRetry(
      input,
      isPersonTokenGrantUrl(url, supabaseUrl)
        ? withTokenGrantForwarding(init, forwarding)
        : init,
    );
  };
}

export async function fetchWithJwtIssuedAtFutureRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (!(await isJwtIssuedAtFutureResponse(response))) {
    return response;
  }

  await new Promise((resolve) =>
    setTimeout(resolve, JWT_CLOCK_SKEW_RETRY_DELAY_MS),
  );

  return fetch(input, init);
}

async function isJwtIssuedAtFutureResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false;
  }

  try {
    const body = (await response.clone().json()) as {
      code?: unknown;
      message?: unknown;
    } | null;

    return (
      body?.code === "PGRST303" && body.message === "JWT issued at future"
    );
  } catch {
    return false;
  }
}

export async function clearSupabaseAuthCookies(): Promise<void> {
  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (!isSupabaseAuthCookie(cookie.name)) {
      continue;
    }

    cookieStore.set(cookie.name, "", {
      maxAge: 0,
      path: "/",
    });
  }
}

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("auth-token");
}
