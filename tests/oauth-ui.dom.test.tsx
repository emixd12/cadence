// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ConsentForm } from "@/components/oauth/ConsentForm";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import type { ConsentView } from "@/lib/types/oauth-ui";

const consent: ConsentView = { requestId: "request", accountId: "account", email: "fixture@example.test", clientName: "Fixture app", logoUri: "https://client.example/logo.png", verified: false, redirectHost: "client.example", scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"], grantedScopes: [], offlineAccess: true };
const action = vi.fn(async () => ({ status: "error" as const, message: "Try again." }));
it("discloses account, redirect host, verification and sensitive read permissions", () => {
  const html = renderToStaticMarkup(<ConsentForm consent={consent} action={action} />);
  for (const text of ["fixture@example.test", "client.example", "Unverified client", "required", "Notes may contain sensitive", "Google Calendar", "Daily Brief", "Allow", "Deny"]) expect(html).toContain(text);
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(renderToStaticMarkup(<ConsentForm consent={{ ...consent, verified: true, scopes: ["cadence.read"], logoUri: null }} action={action} />)).not.toContain('type="checkbox"');
});
// Ticket 379: before the page hydrates the browser has only this markup. Everything
// Allow and Deny need must be in it, with no script.
it("Ticket 379: the server-rendered form posts request, account, scopes and the pressed button without any script", () => {
  // A Server Action reaches React with this hook; React then renders a form a browser can post.
  const reference = <T extends object>(fn: T): T => Object.assign(fn, {
    $$FORM_ACTION: (prefix: string) => { const data = new FormData(); data.set(`$ACTION_${prefix}:0`, "fixture"); return { name: `$ACTION_REF_${prefix}`, method: "POST", encType: "multipart/form-data", data }; },
    // Like a real reference, a bound copy is still a reference.
    bind: () => reference(async () => ({ status: "idle" as const, message: "" })),
  });
  const serverAction = reference(async () => ({ status: "idle" as const, message: "" }));
  const container = document.createElement("div"); document.body.append(container);
  try {
    container.innerHTML = renderToStaticMarkup(<ConsentForm consent={consent} action={serverAction} />);
    const form = container.querySelector("form")!;
    // An empty action posts to the page's own URL, which keeps the request in the query.
    expect(form.getAttribute("action")).toBe(""); expect(form.enctype).toBe("multipart/form-data");
    expect([...new FormData(form).keys()].filter((key) => key.startsWith("$ACTION_")).length).toBeGreaterThan(0);
    const allow = form.querySelector<HTMLButtonElement>('button[name="decision"][value="allow"]')!;
    const deny = form.querySelector<HTMLButtonElement>('button[name="decision"][value="deny"]')!;
    const posted = (submitter: HTMLButtonElement) => { const data = new FormData(form, submitter); return { request: data.get("request_id"), account: data.get("account_id"), decision: data.getAll("decision"), scopes: data.getAll("scope") }; };
    expect(form.method).toBe("post");
    for (const button of [allow, deny]) { expect(button.type).toBe("submit"); expect(button.disabled).toBe(false); }
    expect(form.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false);
    expect(posted(allow)).toEqual({ request: "request", account: "account", decision: ["allow"], scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] });
    expect(posted(deny).decision).toEqual(["deny"]);
    // A write switched off before hydration is not posted.
    form.querySelector<HTMLInputElement>('input[type="checkbox"][value="cadence.occurrences.write"]')!.click();
    expect(posted(allow).scopes).toEqual(["cadence.read", "cadence.behaviors.write"]);
  } finally { container.remove(); }
});
it("Ticket 379: hydration keeps a write the person switched off before it, and one press disables both buttons", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { hydrateRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  let finish: (state: { status: "error"; message: string }) => void = () => {};
  const slow = vi.fn(() => new Promise<{ status: "error"; message: string }>((resolve) => { finish = resolve; }));
  const container = document.createElement("div"); document.body.append(container);
  container.innerHTML = renderToString(<ConsentForm consent={consent} action={slow} />);
  container.querySelector<HTMLInputElement>('input[type="checkbox"][value="cadence.occurrences.write"]')!.click();
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(() => { root = hydrateRoot(container, <ConsentForm consent={consent} action={slow} />); });
    const form = container.querySelector("form")!;
    expect(new FormData(form).getAll("scope")).toEqual(["cadence.read", "cadence.behaviors.write"]);
    const allow = form.querySelector<HTMLButtonElement>('button[value="allow"]')!;
    await act(async () => { allow.click(); });
    expect(slow).toHaveBeenCalledOnce();
    const sent = (slow.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(sent.get("decision")).toBe("allow"); expect(sent.getAll("scope")).toEqual(["cadence.read", "cadence.behaviors.write"]);
    // The hydrated form blocks a second press while the first is saving.
    expect(allow.disabled).toBe(true); expect(form.querySelector<HTMLButtonElement>('button[value="deny"]')!.disabled).toBe(true);
    await act(async () => { allow.click(); });
    expect(slow).toHaveBeenCalledOnce();
    await act(async () => { finish({ status: "error", message: "Try again." }); });
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Try again.");
  } finally { await act(() => root?.unmount()); container.remove(); }
});
it("lets each optional write permission change independently while read remains submitted", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(() => root.render(<ConsentForm consent={consent} action={action} />));
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    await act(() => inputs[0].click());
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read", "cadence.behaviors.write"]);
    await act(() => inputs[1].click());
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read"]);
    expect(container.querySelector('button[value="deny"]')).not.toBeNull();
  } finally { await act(() => root.unmount()); container.remove(); }
});
it("shows step-up scopes already granted as selected, and lets the user clear them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const stepUp: ConsentView = { ...consent, grantedScopes: ["cadence.read", "cadence.occurrences.write"] };
  expect(renderToStaticMarkup(<ConsentForm consent={stepUp} action={action} />)).toContain("(already granted)");
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(() => root.render(<ConsentForm consent={stepUp} action={action} />));
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(inputs[0].closest("label")!.textContent).toContain("already granted");
    expect(inputs[1].closest("label")!.textContent).not.toContain("already granted");
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"]);
    await act(() => inputs[0].click());
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read", "cadence.behaviors.write"]);
  } finally { await act(() => root.unmount()); container.remove(); }
});
it("Ticket 259: a read-only request shows all three permissions with both writes on, and a switched-off write is not submitted", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // The view getConsentPageData builds for a client that requested only cadence.read.
  const readOnlyRequest: ConsentView = { ...consent, clientName: "ChatGPT", verified: true, redirectHost: "chatgpt.com" };
  const html = renderToStaticMarkup(<ConsentForm consent={readOnlyRequest} action={action} />);
  for (const text of ["Read tracking data", "Change Occurrence statuses and notes", "Create, edit, archive, and restore Behaviors"]) expect(html).toContain(text);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(() => root.render(<ConsentForm consent={readOnlyRequest} action={action} />));
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...inputs].map((input) => [input.value, input.checked])).toEqual([["cadence.occurrences.write", true], ["cadence.behaviors.write", true]]);
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"]);
    await act(() => inputs[1].click());
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["cadence.read", "cadence.occurrences.write"]);
  } finally { await act(() => root.unmount()); container.remove(); }
});
it("shows grant metadata, accessible Disconnect and activity without payloads", () => {
  const html = renderToStaticMarkup(<ConnectedAppsPanel timezone="UTC" action={action} view={{ error: null, grants: [{ grantId: "grant", clientId: "client", clientName: "Fixture app", clientUri: null, logoUri: null, verifiedClient: null, scopes: ["cadence.read"], createdAt: "2026-10-18T12:00:00Z", lastUsedAt: null }], activity: [{ activityId: 1, grantId: "grant", clientName: "Fixture app", operation: "get_timeline", outcome: "success", errorCode: null, occurredAt: "2026-10-18T12:00:00Z" }] }} />);
  for (const text of ["Read tracking data", "Connected:", "Not used yet", 'aria-label="Disconnect Fixture app"', "Recent activity", "get timeline", "success"]) expect(html).toContain(text);
  expect(html).toContain("<details>"); expect(html).not.toContain("<details open");
});
it("distinguishes empty accounts and load failures", () => {
  const render = (error: string | null) => renderToStaticMarkup(<ConnectedAppsPanel timezone="UTC" action={action} view={{ error, grants: [], activity: [] }} />);
  expect(render(null)).toContain("No apps connected yet."); expect(render(null)).toContain("No recent activity.");
  expect(render("Could not load.")).toContain('role="alert"'); expect(render("Could not load.")).not.toContain("No apps connected yet.");
});
