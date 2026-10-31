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
  expect(render(null)).toContain("No apps connected."); expect(render(null)).toContain("No recent activity.");
  expect(render("Could not load.")).toContain('role="alert"'); expect(render("Could not load.")).not.toContain("No apps connected.");
});
