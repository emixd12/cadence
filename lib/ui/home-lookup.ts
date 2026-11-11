/** Ticket 308: what the hosted Home lookup answered. No position is ever part of a result. */
export type HomeLookupResult =
  | Readonly<{ kind: "address"; address: string }>
  | Readonly<{ kind: "no_result" | "inaccurate" | "travel_off" | "rate_limited" | "unavailable" }>;

export type HomeLookupPosition = Readonly<{ latitude: number; longitude: number; accuracyMeters: number }>;

export type HomeLookupClient = Readonly<{
  lookup: (position: HomeLookupPosition) => Promise<HomeLookupResult>;
}>;

/**
 * One client for web (same-origin session) and a linked Mac (the hosted origin with a bearer
 * token). The position travels in the POST body only, never in a URL, and nothing is stored.
 */
export function createHomeLookupClient(input: Readonly<{ origin?: string; accessToken?: () => Promise<string> }> = {}): HomeLookupClient {
  return {
    lookup: async (position) => {
      try {
        const token = input.accessToken ? await input.accessToken() : null;
        const response = await fetch(`${input.origin ?? ""}/api/travel/home-lookup`, {
          method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ latitude: position.latitude, longitude: position.longitude, accuracyMeters: position.accuracyMeters }),
        });
        const body: unknown = await response.json().catch(() => null);
        const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
        if (response.ok) {
          return typeof record.address === "string" && record.address.trim()
            ? { kind: "address", address: record.address.trim() } : { kind: "no_result" };
        }
        if (record.error === "inaccurate_position") return { kind: "inaccurate" };
        if (record.error === "travel_off") return { kind: "travel_off" };
        if (record.error === "rate_limited" || record.error === "quota_exceeded") return { kind: "rate_limited" };
        return { kind: "unavailable" };
      } catch { return { kind: "unavailable" }; }
    },
  };
}

export const webHomeLookupClient: HomeLookupClient = createHomeLookupClient();
