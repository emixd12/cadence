import {
  PLACE_SEARCH_MAX_RESULTS,
  normalizePlaceSearchQuery,
  parseGeoapifyAutocompleteResponse,
} from "@cadence/core/services/place-search";
import type { PlaceSearchSuggestion } from "@cadence/core/types/place-search";
import { runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";

const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const MAX_RESPONSE_BYTES = 65_536;
export const GEOAPIFY_TIMEOUT_MS = 5_000;

export type GeoapifyConfig = Readonly<{
  apiKey: string | null;
}>;

export type GeoapifyProviderErrorCode =
  | "not_configured"
  | "timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class GeoapifyProviderError extends Error {
  constructor(
    public readonly code: GeoapifyProviderErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "GeoapifyProviderError";
  }
}

export function readGeoapifyConfig(
  env: Record<string, string | undefined> = process.env,
): GeoapifyConfig {
  return { apiKey: env.GEOAPIFY_API_KEY?.trim() || null };
}

export async function autocompleteGeoapifyPlaces(
  rawQuery: string,
  options: Readonly<{
    config: GeoapifyConfig;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    limit?: number;
  }>,
): Promise<PlaceSearchSuggestion[]> {
  if (!options.config.apiKey) {
    throw new GeoapifyProviderError("not_configured", false);
  }
  const query = normalizePlaceSearchQuery(rawQuery);
  if (!query) return [];
  const limit = Math.max(1, Math.min(PLACE_SEARCH_MAX_RESULTS, options.limit ?? PLACE_SEARCH_MAX_RESULTS));
  const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("apiKey", options.config.apiKey);

  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? GEOAPIFY_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  let json: unknown;
  try {
    json = await runProviderCallWithTimeout(async () => {
      const response = await fetcher(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new GeoapifyProviderError("provider_unavailable", retryable);
      }
      return readLimitedJson(response, signal);
    }, { timeoutMs, signal });
  } catch (error) {
    if (error instanceof GeoapifyProviderError) throw error;
    throw new GeoapifyProviderError("timeout", true);
  }

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new GeoapifyProviderError("malformed_provider_response", false);
  }
  return parseGeoapifyAutocompleteResponse(json, limit);
}

async function readLimitedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new GeoapifyProviderError("malformed_provider_response", false);
  }
  if (!response.body) throw new GeoapifyProviderError("malformed_provider_response", false);
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GeoapifyProviderError("malformed_provider_response", false);
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(output)) as unknown;
  } catch {
    throw new GeoapifyProviderError("malformed_provider_response", false);
  }
}
