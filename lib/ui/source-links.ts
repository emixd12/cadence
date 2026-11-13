import type { SourceLinkFormState, SourceLinkMode, SourceLinkSaveResult } from "@/lib/services/source-links.service";

export type { SourceLinkFormState, SourceLinkMode, SourceLinkSaveResult };

// Ticket 317: the browser side of a Behavior's source link. Routine titles arrive
// from the hosted route for the picker and are never cached or stored here.

export type SourceLinkCoordinator = Readonly<{
  getState(behaviorId: string): Promise<SourceLinkFormState>;
  save(input: Readonly<{ behaviorId: string; mode: SourceLinkMode; selectorKeys: readonly string[] }>): Promise<SourceLinkSaveResult>;
}>;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw Object.assign(new Error("network_unavailable"), { code: "network_unavailable" });
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object" || "error" in value) {
    const code = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "provider_unavailable";
    throw Object.assign(new Error(code), { code });
  }
  return value as T;
}

export const webSourceLinkCoordinator: SourceLinkCoordinator = {
  getState(behaviorId) {
    return request(`/api/connectors/links?${new URLSearchParams({ behaviorId, source: "hevy" })}`);
  },
  save(input) {
    return request("/api/connectors/links", { method: "PUT",
      body: JSON.stringify({ behaviorId: input.behaviorId, source: "hevy", mode: input.mode, selectorKeys: [...input.selectorKeys] }) });
  },
};
