import { createServiceRoleClient } from "@/lib/supabase/admin";

// Ticket 333 (L-025): the sealed Apple refresh token lives in the private schema.
// Only these three service-role RPCs touch it. The owner ID always comes from the
// signed-in session, never from request input. Errors carry no database text.

export type SealedAppleToken = Readonly<{
  subjectDigest: string;
  sealedRefreshToken: string;
}>;

export class AppleSignInTokenError extends Error {
  constructor(code: "store_failed" | "read_failed" | "forget_failed") {
    super(code);
    this.name = "AppleSignInTokenError";
  }
}

export async function storeAppleSignInToken(
  ownerId: string,
  subjectDigest: string,
  sealedRefreshToken: string,
): Promise<void> {
  const { error } = await createServiceRoleClient().rpc(
    "apple_sign_in_keep_token",
    {
      owner_id: ownerId,
      apple_subject_digest: subjectDigest,
      token_ciphertext: sealedRefreshToken,
    },
  );
  if (error) throw new AppleSignInTokenError("store_failed");
}

export async function readAppleSignInTokens(
  ownerId: string,
): Promise<SealedAppleToken[]> {
  const { data, error } = await createServiceRoleClient().rpc(
    "apple_sign_in_read_tokens",
    { owner_id: ownerId },
  );
  if (error || !Array.isArray(data)) {
    throw new AppleSignInTokenError("read_failed");
  }
  return data.map((row) => ({
    subjectDigest: row.subject_digest,
    sealedRefreshToken: row.sealed_refresh_token,
  }));
}

/** Ticket 334: drops the kept token for one Apple identity after it is removed. */
export async function forgetAppleSignInToken(
  ownerId: string,
  subjectDigest: string,
): Promise<void> {
  const { error } = await createServiceRoleClient().rpc(
    "apple_sign_in_forget_token",
    { owner_id: ownerId, apple_subject_digest: subjectDigest },
  );
  if (error) throw new AppleSignInTokenError("forget_failed");
}
