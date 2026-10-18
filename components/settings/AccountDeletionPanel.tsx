"use client";

import { useActionState, useMemo, useState } from "react";

import {
  ACCOUNT_DELETION_INITIAL_STATE,
  type AccountDeletionActionState,
} from "@/lib/types/account";
import { CONNECTOR_REVOCATION_COPY } from "@/lib/ui/connectors";

export type DeleteAccountAction = (
  state: AccountDeletionActionState,
  formData: FormData,
) => Promise<AccountDeletionActionState>;

export function AccountDeletionPanel({
  confirmationLabel,
  deleteAccountAction,
  initialState = ACCOUNT_DELETION_INITIAL_STATE,
}: Readonly<{
  confirmationLabel: string;
  deleteAccountAction: DeleteAccountAction;
  initialState?: AccountDeletionActionState;
}>) {
  const [state, formAction, isPending] = useActionState(
    deleteAccountAction,
    initialState,
  );
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const canSubmit = useMemo(
    () =>
      isAccountDeletionReady({
        exportAcknowledged,
        confirmation,
        confirmationLabel,
      }),
    [confirmation, confirmationLabel, exportAcknowledged],
  );

  return (
    <section className="bg-background py-4 first:pt-0 last:pb-0">
      <h2 className="text-xl leading-tight">Delete account</h2>
      <div className="mt-4 grid gap-5">
        <div className="grid max-w-2xl gap-3 text-sm leading-6 text-muted-readable">
          <p>
            Account deletion removes the signed-in Cadence account and its
            hosted behavior records. This cannot be undone.
          </p>
          <p>
            Download a BehaviorLog or full JSON backup from Export before
            deleting the account.
          </p>
          <div>
            <p>
              Deletion also removes Cadence&apos;s saved access for connected
              sources. Cadence asks Google to revoke Calendar access. Other
              services keep their permission until you remove it there:
            </p>
            <ul className="mt-2 grid list-disc gap-1 pl-5">
              <li>Outlook Calendar: {CONNECTOR_REVOCATION_COPY.microsoft_account_permissions}</li>
              <li>Hevy: {CONNECTOR_REVOCATION_COPY.hevy_api_key}</li>
            </ul>
          </div>
          <p>
            <a
              href="/export"
              className="product-action product-action-primary"
            >
              Open Export
            </a>
          </p>
        </div>

        <form action={formAction} className="grid gap-3">
          <label className="flex items-start gap-3 text-sm leading-6 text-foreground">
            <input
              type="checkbox"
              name="confirm_export"
              value="yes"
              checked={exportAcknowledged}
              onChange={(event) =>
                setExportAcknowledged(event.currentTarget.checked)
              }
              className="mt-0.5 h-5 w-5 accent-foreground"
            />
            <span>I downloaded an export or do not need one.</span>
          </label>

          <label
            htmlFor="delete-account-confirmation"
            className="text-sm leading-6 text-foreground"
          >
            Type {confirmationLabel} to confirm
          </label>
          <input
            id="delete-account-confirmation"
            name="confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.currentTarget.value)}
            className="min-h-11 max-w-md border border-line bg-background px-3 py-2 text-base"
          />
          <p className="text-sm leading-6 text-muted-readable">
            Deletion unlocks after the export acknowledgement and typed
            confirmation match.
          </p>

          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="product-action product-action-danger min-h-11 w-fit py-2 text-sm"
          >
            {isPending ? "Deleting..." : "Delete account"}
          </button>

          {state.message ? (
            <p
              role={state.status === "error" ? "alert" : "status"}
              aria-live={state.status === "error" ? "assertive" : "polite"}
              aria-atomic="true"
              className="text-sm leading-6 text-accent"
            >
              {state.message}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}

export function isAccountDeletionReady({
  exportAcknowledged,
  confirmation,
  confirmationLabel,
}: Readonly<{
  exportAcknowledged: boolean;
  confirmation: string;
  confirmationLabel: string;
}>): boolean {
  return exportAcknowledged && confirmation.trim() === confirmationLabel;
}
