"use client";

import { useEffect, useRef, useState } from "react";

import { SettingsRow } from "@/components/settings/SettingsSections";
import { SettingsLiveLine } from "@/components/settings/settings-result";
import {
  SIGN_IN_METHODS_ANCHOR,
  SIGN_IN_METHODS_METHOD_PARAM,
  SIGN_IN_METHODS_RESULT_PARAM,
  signInMethodName,
  type SignInMethodRow,
  type SignInMethodsView,
} from "@/lib/auth/account-sign-in-methods";
import type { SettingsSectionState } from "@/lib/ui/settings-sections";

// Ticket 334 (D31.3): the Account group's Sign-in methods row. Plain forms post to
// /auth/sign-in-methods/*; the server checks every rule again.

const PRIMARY = "product-action product-action-primary min-h-11 w-fit px-3 py-2 text-sm font-bold";
const SECONDARY = "product-action product-action-secondary min-h-11 w-fit px-3 py-2 text-sm font-bold";
const DANGER = "product-action product-action-danger min-h-11 w-fit px-3 py-2 text-sm font-bold";

export type SignInMethodsResult = Readonly<{ text: string; error: boolean }> | null;

function listNames(rows: readonly SignInMethodRow[]): string {
  const unique = [...new Set(rows.map((row) => row.name))];
  const names = unique.map((name, index) => (index === 0 ? name : name.toLowerCase()));
  if (names.length <= 1) return names[0] ?? "None";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function signInMethodsSectionState(view: SignInMethodsView): SettingsSectionState {
  return { text: listNames(view.rows), on: view.rows.length > 0, attention: false };
}

/** The row for Settings, Account and data. */
export function SignInMethodsRow({ view, result }: Readonly<{ view: SignInMethodsView; result: SignInMethodsResult }>) {
  return (
    <SettingsRow title="Sign-in methods" kind="Ways to sign in to this account" state={signInMethodsSectionState(view)}>
      <SignInMethodsPanel view={view} result={result} />
    </SettingsRow>
  );
}

export function SignInMethodsPanel({ view, result }: Readonly<{ view: SignInMethodsView; result: SignInMethodsResult }>) {
  useClearResultFromUrl(result !== null);
  const emailRow = view.rows.find((row) => row.methodId === "email");
  return (
    <section id={SIGN_IN_METHODS_ANCHOR} className="grid min-w-0 gap-4">
      <ul className="grid min-w-0 divide-y divide-line">
        {view.rows.map((row) => (
          <li key={row.identityId ?? row.methodId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm first:pt-0">
            <span className="grid min-w-0 gap-0.5">
              <span className="text-base font-bold leading-6">{row.name}</span>
              {row.detail ? <span className="text-sm leading-6 text-muted-readable [overflow-wrap:anywhere]">{row.detail}</span> : null}
            </span>
            {row.removable && row.identityId ? <RemoveMethod identityId={row.identityId} name={row.name} /> : null}
            {row.methodId === "email" && view.emailEnabled ? <EmailAddressForm toggleLabel="Change address" /> : null}
          </li>
        ))}
      </ul>

      {view.addable.length > 0 || (!emailRow && view.emailEnabled) ? (
        <div className="flex flex-wrap gap-x-3 gap-y-2 text-sm">
          {view.addable.map((methodId) => (
            <form key={methodId} method="post" action="/auth/sign-in-methods/add">
              <input type="hidden" name="method" value={methodId} />
              <button type="submit" className={PRIMARY}>{`Add ${signInMethodName(methodId)}`}</button>
            </form>
          ))}
          {!emailRow && view.emailEnabled ? <EmailAddressForm toggleLabel="Add email" /> : null}
        </div>
      ) : null}

      <SettingsLiveLine text={result?.text} error={result?.error} className="text-sm leading-6" />
    </section>
  );
}

/** Removes the result from the address bar once shown, so a reload does not repeat it. */
function useClearResultFromUrl(shown: boolean) {
  useEffect(() => {
    if (!shown) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(SIGN_IN_METHODS_RESULT_PARAM);
    url.searchParams.delete(SIGN_IN_METHODS_METHOD_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [shown]);
}

function RemoveMethod({ identityId, name }: Readonly<{ identityId: string; name: string }>) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) { cancel.current?.focus(); return; }
    if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [asking]);

  if (!asking) {
    return <button ref={trigger} type="button" className={SECONDARY} onClick={() => setAsking(true)} aria-label={`Remove ${name}`}>Remove</button>;
  }
  return (
    <form method="post" action="/auth/sign-in-methods/remove" onSubmit={() => setPending(true)}
      role="group" aria-label={`Remove ${name}`} className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6">
      <input type="hidden" name="identity_id" value={identityId} />
      <span>{`Remove ${name}? It will no longer sign in to this account.`}</span>
      <button type="submit" className={DANGER} disabled={pending}>{pending ? "Removing…" : `Remove ${name}`}</button>
      <button ref={cancel} type="button" className={SECONDARY} disabled={pending}
        onClick={() => { returnFocus.current = true; setAsking(false); }}>Cancel</button>
    </form>
  );
}

function EmailAddressForm({ toggleLabel }: Readonly<{ toggleLabel: string }>) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (open) { input.current?.focus(); return; }
    if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
  }, [open]);

  // readOnly, not disabled, while sending: a disabled field leaves the form data.
  if (!open) {
    return <button ref={trigger} type="button" className={SECONDARY} onClick={() => setOpen(true)}>{toggleLabel}</button>;
  }
  return (
    <form method="post" action="/auth/sign-in-methods/email" onSubmit={() => setPending(true)} className="grid basis-full gap-2 text-sm">
      <label htmlFor="sign-in-method-email" className="text-sm leading-6">New email address</label>
      <input ref={input} id="sign-in-method-email" name="email" type="email" required autoComplete="email" spellCheck={false}
        autoCapitalize="none" readOnly={pending}
        className="min-h-11 min-w-0 w-full max-w-md border border-line bg-background px-3 py-2" />
      <p className="text-sm leading-6 text-muted-readable">
        Cadence sends a link to confirm it. Sign-in codes and email reminders then go to this address.
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <button type="submit" className={PRIMARY} disabled={pending}>{pending ? "Sending…" : "Send confirmation link"}</button>
        <button type="button" className={SECONDARY} disabled={pending}
          onClick={() => { returnFocus.current = true; setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}
