"use client";

import { useActionState } from "react";
import { OAUTH_PERMISSION_LABELS, type ConsentView, type OAuthFormAction } from "@/lib/types/oauth-ui";

export function ConsentForm({ consent, action }: { consent: ConsentView; action: OAuthFormAction }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" as const, message: "" });
  return (
    <form action={formAction} className="grid min-w-0 gap-6">
      <input type="hidden" name="request_id" value={consent.requestId} />
      <input type="hidden" name="account_id" value={consent.accountId} />
      <div className="flex min-w-0 items-start gap-3">
        {consent.logoUri ? (
          // Client metadata stays in a browser image, never a server-side image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={consent.logoUri} alt="" width={40} height={40} referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 object-contain" />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight [overflow-wrap:anywhere]">Connect {consent.clientName}</h1>
          <p className="mt-2 text-sm text-muted-readable">{consent.verified ? "Verified client" : "Unverified client"}</p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm leading-6">
        <div><dt className="font-bold">Cadence account</dt><dd className="[overflow-wrap:anywhere]">{consent.email}</dd></div>
        <div><dt className="font-bold">Return to</dt><dd className="[overflow-wrap:anywhere]">{consent.redirectHost}</dd></div>
      </dl>
      {!consent.verified ? <p className="text-sm leading-6 text-muted-readable">Cadence has not verified this client’s identity. Only connect an app you trust.</p> : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-3 border-y border-line py-4">
        <legend className="text-lg">Permissions</legend>
        <input type="hidden" name="scope" value="cadence.read" />
        <div>
          <p>{OAUTH_PERMISSION_LABELS["cadence.read"]} <span className="text-sm text-muted-readable">(required)</span></p>
          <p className="mt-1 text-sm leading-6 text-muted-readable">Includes Behaviors, schedules, categories, Occurrences, notes, status history, tracked time, reminder settings, and timezone. Notes may contain sensitive information.</p>
        </div>
        {consent.scopes.filter((scope) => scope !== "cadence.read").map((scope) => (
          <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm leading-6">
            <input type="checkbox" name="scope" value={scope} defaultChecked className="h-4 w-4 shrink-0 accent-primary" />
            <span>{OAUTH_PERMISSION_LABELS[scope]}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-2 text-sm leading-6 text-muted-readable">
        <p>Google Calendar, travel, Daily Brief, and your email address are not shared. Apps cannot delete Behaviors or Occurrences.</p>
        {consent.offlineAccess ? <p>This app can stay connected between visits until you disconnect it or its access expires.</p> : null}
        <p>You can disconnect this app in Settings → Connected apps.</p>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <button name="decision" value="allow" type="submit" disabled={pending} className="product-action product-action-primary min-h-11 py-2">Allow</button>
        <button name="decision" value="deny" type="submit" disabled={pending} className="product-action product-action-secondary min-h-11 py-2">Deny</button>
      </div>
      {pending ? <p role="status" className="text-sm text-muted-readable">Saving your choice…</p> : null}
      {state.message ? <p role="alert" className="text-sm leading-6 text-accent">{state.message}</p> : null}
    </form>
  );
}
