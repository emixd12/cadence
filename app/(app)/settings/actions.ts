"use server";

import { changeCurrentUserCategory } from "@/lib/services/category.service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  accountDeletionErrorToActionState,
  deleteCurrentAccountFromFormData,
} from "@/lib/services/account.service";
import {
  timezoneErrorToActionState,
  updateCurrentUserTimezoneFromFormData,
} from "@/lib/services/settings.service";
import type { AccountDeletionActionState } from "@/lib/types/account";
import type { TimezoneActionState } from "@/lib/types/settings";
import { disconnectOAuthApp } from "@/lib/services/oauth-ui.service";
import type { OAuthActionState } from "@/lib/types/oauth-ui";

export async function disconnectAppAction(_previous: OAuthActionState, form: FormData): Promise<OAuthActionState> {
  try {
    await disconnectOAuthApp(form);
  } catch {
    return { status: "error", message: "The app could not be disconnected. Reload Settings and try again." };
  }
  revalidatePath("/settings");
  return { status: "success", message: "App disconnected. Its access has stopped." };
}

export async function deleteAccountAction(
  _previousState: AccountDeletionActionState,
  formData: FormData,
): Promise<AccountDeletionActionState> {
  try {
    await deleteCurrentAccountFromFormData(formData);
  } catch (error) {
    return accountDeletionErrorToActionState(error);
  }

  redirect("/login?account_deleted=1");
}

export async function updateTimezoneAction(
  _previousState: TimezoneActionState,
  formData: FormData,
): Promise<TimezoneActionState> {
  try {
    const result = await updateCurrentUserTimezoneFromFormData(formData);

    return {
      status: "success",
      message: timezoneSuccessMessage(result),
      timezone: result.timezone,
      activeBehaviorCount: result.activeBehaviorCount,
    };
  } catch (error) {
    return timezoneErrorToActionState(error);
  }
}

function timezoneSuccessMessage(result: {
  changed: boolean;
  activeBehaviorCount: number;
}): string {
  if (!result.changed) {
    return "Timezone is already saved.";
  }

  if (result.activeBehaviorCount === 0) {
    return "Timezone saved.";
  }

  if (result.activeBehaviorCount === 1) {
    return "Timezone saved. 1 active behavior was updated.";
  }

  return `Timezone saved. ${result.activeBehaviorCount} active behaviors were updated.`;
}

export async function changeCategoryAction(
  _previous: import("@cadence/core/services/category.service").CategoryActionState,
  form: { get(name: string): unknown },
): Promise<import("@cadence/core/services/category.service").CategoryActionState> {
  try {
    await changeCurrentUserCategory(form);
    for (const path of ["/settings", "/behaviors", "/timeline", "/export"]) revalidatePath(path);
    return { status: "success", message: "Categories saved." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to save categories." };
  }
}
