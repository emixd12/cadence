"use client";

import { useActionState } from "react";
import { formatUserDateTime } from "@/lib/ui/date-time";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { OAUTH_PERMISSION_LABELS, type ConnectedAppsView, type OAuthFormAction } from "@/lib/types/oauth-ui";

export function ConnectedAppsPanel({ view, timezone, action }: { view: ConnectedAppsView; timezone: string; action: OAuthFormAction }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" as const, message: "" });
  const date = (value: string) => formatUserDateTime(value, timezone);
  return (
    <SettingsPanel id="connected-apps" title="Connected apps" className="scroll-mt-20">
      <div className="grid min-w-0 gap-4">
        <p className="text-sm leading-6 text-muted-readable">AI clients with access to this Cadence account. Disconnect stops their access immediately.</p>
        {view.error ? <p role="alert" className="text-sm text-accent">{view.error}</p> : <>
          {view.grants.length === 0 ? <p className="text-sm leading-6 text-muted-readable">No apps connected. Start a connection from an AI client to review its permissions here.</p> : (
            <ul className="grid min-w-0 divide-y divide-line">
              {view.grants.map((grant) => <li key={grant.grantId} className="grid min-w-0 gap-3 py-4 first:pt-0">
                <h3 className="text-lg [overflow-wrap:anywhere]">{grant.clientName}</h3>
                <p className="text-sm text-muted-readable">{grant.verifiedClient ? "Verified client" : "Unverified client"}</p>
                <ul className="grid gap-1 text-sm leading-6">{grant.scopes.map((scope) => <li key={scope}>{OAUTH_PERMISSION_LABELS[scope]}</li>)}</ul>
                <dl className="grid gap-1 text-sm leading-6 text-muted-readable">
                  <div><dt className="inline">Connected: </dt><dd className="inline"><time dateTime={grant.createdAt}>{date(grant.createdAt)}</time></dd></div>
                  <div><dt className="inline">Last used: </dt><dd className="inline">{grant.lastUsedAt ? <time dateTime={grant.lastUsedAt}>{date(grant.lastUsedAt)}</time> : "Not used yet"}</dd></div>
                </dl>
                <form action={formAction}>
                  <input name="grant_id" type="hidden" value={grant.grantId} />
                  <button type="submit" disabled={pending} aria-label={`Disconnect ${grant.clientName}`} className="product-action product-action-danger min-h-11 py-2">Disconnect</button>
                </form>
              </li>)}
            </ul>
          )}
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">Recent activity</summary>
            {view.activity.length ? <ul className="grid min-w-0 divide-y divide-line text-sm leading-6">
              {view.activity.map((entry) => <li key={entry.activityId} className="grid min-w-0 gap-1 py-3">
                <p className="[overflow-wrap:anywhere]">{entry.clientName}: {entry.operation.replaceAll("_", " ")}</p>
                <p className="text-muted-readable"><time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time> · {entry.outcome.replaceAll("_", " ")}</p>
              </li>)}
            </ul> : <p className="py-2 text-sm text-muted-readable">No recent activity.</p>}
          </details>
        </>}
        {pending ? <p role="status" className="text-sm">Disconnecting…</p> : null}
        {state.message ? <p role={state.status === "error" ? "alert" : "status"} className="text-sm leading-6">{state.message}</p> : null}
      </div>
    </SettingsPanel>
  );
}
