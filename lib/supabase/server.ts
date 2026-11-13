import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  forwardedForHeaders,
  type AuthForwarding,
} from "@/lib/auth/auth-forwarding";
import { getSupabaseRuntimeConfig } from "@/lib/supabase/env";

const JWT_CLOCK_SKEW_RETRY_DELAY_MS = 1_000;

/**
 * With `forwarding`, Auth calls carry the person's address and the secret key
 * (Ticket 338). Use it only for the email code and link checks.
 */
export async function createClient(
  options: { forwarding?: AuthForwarding | null } = {},
) {
  const { url, publishableKey } = getSupabaseRuntimeConfig();
  const cookieStore = await cookies();
  const forwarding = options.forwarding ?? null;

  return createServerClient(url, forwarding?.secretKey ?? publishableKey, {
    global: {
      fetch: fetchWithJwtIssuedAtFutureRetry,
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
