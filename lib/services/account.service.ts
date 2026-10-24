import { prepareCalendarRevocation } from "./google-calendar.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  clearSupabaseAuthCookies,
  createClient,
} from "@/lib/supabase/server";
import { invalidateStableUserData } from "@/lib/cache/stable-user-data.cache";
import type { AccountDeletionActionState } from "@/lib/types/account";

export class AccountDeletionUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionUserError";
  }
}

const ACCOUNT_DELETION_FAILURE_MESSAGE =
  "Unable to delete this account. Your account and session are unchanged. Try again.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteCurrentAccountFromFormData(
  formData: FormData,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AccountDeletionUserError(
      "Sign in again before deleting this account.",
    );
  }

  const expectedConfirmation = user.email?.trim() || "DELETE";

  assertExportAcknowledged(formData);
  assertConfirmationMatches(formData, expectedConfirmation);

  const serviceRole = createAccountDeletionClient();
  await verifyAccountDeletionClient(serviceRole, user.id);
  assertDeletionFailureCanaryInactive(user.id);

  const revokeCalendar = await prepareCalendarRevocation({ client: supabase, user }).catch(() => null);
  const { error: deleteError } = await deleteAuthUser(serviceRole, user.id);

  if (deleteError) {
    throw new AccountDeletionUserError(ACCOUNT_DELETION_FAILURE_MESSAGE);
  }

  // Auth deletion cascades local credentials before any external revocation.
  // Hevy, Outlook, and iCloud connections, sealed credentials, and attempts also
  // cascade with the Auth user (Ticket 235). None documents app-side revocation,
  // so no provider call follows; a failed deletion above leaves them intact.
  try { await revokeCalendar?.(); }
  catch { /* A provider outage must not turn completed deletion into a retry. */ }

  try {
    invalidateStableUserData(user.id);
  } catch {
    // The deleted account cannot retry a local cache invalidation failure.
  }

  // Hard Auth deletion removes Auth session rows and refresh capability. This
  // final sign-out best-effort clears the current browser's cookie-backed state.
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    // The account is already deleted. Do not present an impossible retry.
  }

  try {
    await clearSupabaseAuthCookies();
  } catch {
    // Auth deletion succeeded. The issued JWT expires on its configured bound.
  }
}

function assertDeletionFailureCanaryInactive(userId: string): void {
  const configuredUserId =
    process.env.CADENCE_ACCOUNT_DELETION_FAILURE_CANARY_USER_ID;

  if (!configuredUserId) {
    return;
  }

  if (!UUID_PATTERN.test(configuredUserId) || configuredUserId === userId) {
    throw new AccountDeletionUserError(ACCOUNT_DELETION_FAILURE_MESSAGE);
  }
}

export function accountDeletionErrorToActionState(
  error: unknown,
): AccountDeletionActionState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Unable to delete this account.",
  };
}

function assertExportAcknowledged(formData: FormData): void {
  if (formData.get("confirm_export") === "yes") {
    return;
  }

  throw new AccountDeletionUserError(
    "Acknowledge the export reminder before deleting this account.",
  );
}

function assertConfirmationMatches(
  formData: FormData,
  expectedConfirmation: string,
): void {
  const submittedConfirmation = formData.get("confirmation");

  if (
    typeof submittedConfirmation === "string" &&
    submittedConfirmation.trim() === expectedConfirmation
  ) {
    return;
  }

  throw new AccountDeletionUserError(
    `Type ${expectedConfirmation} to confirm account deletion.`,
  );
}

function createAccountDeletionClient(): ReturnType<
  typeof createServiceRoleClient
> {
  try {
    return createServiceRoleClient();
  } catch {
    throw new AccountDeletionUserError(
      "Account deletion is temporarily unavailable. Your account and session are unchanged. Try again later.",
    );
  }
}

async function verifyAccountDeletionClient(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  userId: string,
): Promise<void> {
  try {
    const { data, error } = await serviceRole.auth.admin.getUserById(userId);

    if (error || data.user?.id !== userId) {
      throw error ?? new Error("Authenticated user mismatch.");
    }
  } catch {
    throw new AccountDeletionUserError(
      "Unable to verify account deletion. Your account and session are unchanged. Try again.",
    );
  }
}

async function deleteAuthUser(
  serviceRole: ReturnType<typeof createServiceRoleClient>,
  userId: string,
) {
  try {
    return await serviceRole.auth.admin.deleteUser(userId);
  } catch {
    throw new AccountDeletionUserError(ACCOUNT_DELETION_FAILURE_MESSAGE);
  }
}
