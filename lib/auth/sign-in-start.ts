import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_CALLBACK_ROUTE,
  authRequestUrl,
  buildLoginPath,
  MISSING_CONFIG_ERROR,
  normalizeRedirectPath,
} from "@/lib/auth/redirects";
import {
  findEnabledSignInMethod,
  SIGN_IN_METHOD_UNAVAILABLE_ERROR,
  SIGN_IN_METHODS,
  type SignInMethod,
} from "@/lib/auth/sign-in-methods";
import { DEFAULT_APP_ROUTE } from "@/lib/navigation";
import { readSupabaseRuntimeConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Ticket 331: one start for every sign-in method. `/auth/google` and
// `/auth/sign-in/[method]` both call it. Every OAuth method returns through
// `/auth/callback`.
export async function startSignIn(
  request: NextRequest,
  methodId: string,
  methods: readonly SignInMethod[] = SIGN_IN_METHODS,
): Promise<NextResponse> {
  const requestUrl = authRequestUrl(request);
  const nextPath = normalizeRedirectPath(
    requestUrl.searchParams.get("next"),
    DEFAULT_APP_ROUTE,
  );
  const backToLogin = (error: string) =>
    NextResponse.redirect(new URL(buildLoginPath(nextPath, error), requestUrl));

  const method = findEnabledSignInMethod(methodId, process.env, methods);

  if (method?.start?.kind !== "oauth") {
    return backToLogin(SIGN_IN_METHOD_UNAVAILABLE_ERROR);
  }

  if (!readSupabaseRuntimeConfig()) {
    return backToLogin(MISSING_CONFIG_ERROR);
  }

  const redirectTo = new URL(AUTH_CALLBACK_ROUTE, requestUrl);
  redirectTo.searchParams.set("next", nextPath);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: method.start.provider,
    options: {
      redirectTo: redirectTo.toString(),
    },
  });

  if (error || !data.url) {
    return backToLogin("oauth_start_failed");
  }

  return NextResponse.redirect(data.url);
}
