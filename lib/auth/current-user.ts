import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type CurrentUserResult = {
  user: User | null;
  error: Error | null;
};

type CurrentUserClaimsResult = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  error: Error | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUserResult> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return {
    user,
    error: error ?? null,
  };
});

export const getCurrentUserClaims =
  cache(async (): Promise<CurrentUserClaimsResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims: Record<string, unknown> = isRecord(data?.claims)
      ? data.claims
      : {};
    const userId = readNonEmptyString(claims.sub);

    return {
      userId,
      email: readNonEmptyString(claims.email),
      displayName: readDisplayName(claims),
      error: error ?? null,
    };
  });

export async function requireCurrentUser(
  message: string,
): Promise<User> {
  const { user, error } = await getCurrentUser();

  if (error || !user) {
    throw new Error(message);
  }

  return user;
}

export async function requireCurrentUserId(message: string): Promise<string> {
  const { userId, error } = await getCurrentUserClaims();

  if (error || !userId) {
    throw new Error(message);
  }

  return userId;
}

function readDisplayName(claims: Record<string, unknown>): string | null {
  const directName =
    readNonEmptyString(claims.full_name) ??
    readNonEmptyString(claims.name);

  if (directName) {
    return directName;
  }

  const userMetadata = isRecord(claims.user_metadata)
    ? claims.user_metadata
    : null;

  return userMetadata
    ? readNonEmptyString(userMetadata.full_name) ??
        readNonEmptyString(userMetadata.name)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
