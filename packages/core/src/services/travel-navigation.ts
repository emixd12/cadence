import type { TravelEndpointSource, TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "../types/travel";

/**
 * Ticket 271 (correction C2): whether a route has reached this stop's own place, so the link can
 * offer Directions. A route estimate that has expired still counts: Directions depends on a resolved
 * place, not on the estimate's 5-minute life. A missing, failed or withdrawn route does not count.
 * `source` keeps the link's text and the routed place the same: a corrected destination is not the
 * source text the link carries.
 */
export function travelDestinationResolved(
  evidence: Pick<TravelEvidenceResult, "legs"> | null | undefined,
  ref: string,
  source: Extract<TravelEndpointSource, "calendar" | "behavior">,
): boolean {
  return travelDestinationRoute(evidence, ref, source) !== null;
}

/**
 * The route that resolved this stop's place, with the mode it was routed in. That mode can be a
 * remembered per-place choice (Ticket 217), so Directions opens in the same mode as the leave line.
 */
export function travelDestinationRoute(
  evidence: Pick<TravelEvidenceResult, "legs"> | null | undefined,
  ref: string,
  source: Extract<TravelEndpointSource, "calendar" | "behavior">,
): Readonly<{ mode: TravelMode }> | null {
  const found = (evidence?.legs ?? []).find((item) => item.leg.destinationCommitmentRef === ref &&
    item.leg.provenance.destinationSource === source && item.estimate !== null &&
    (item.state === "current" || item.state === "stale"));
  return found ? { mode: found.leg.mode } : null;
}

/** Only source-authored text belongs here, never provider-derived route content. */
export function buildTravelNavigationLink(input: Readonly<{
  locationText: string;
  preference?: TravelNavigationPreference | null;
  mode?: TravelMode | null;
  resolved?: boolean;
}>): Readonly<{ href: string; label: string; modeNotice: string | null }> | null {
  const text = input.locationText.trim();
  if (!text.isWellFormed() || !text || text.length > 500 || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  const apple = input.preference === "apple_maps";
  const directions = input.resolved === true && input.mode != null;
  const base = apple ? "https://maps.apple.com/" : `https://www.google.com/maps/${directions ? "dir" : "search"}/`;
  const params: [string, string][] = [];
  let modeNotice: string | null = null;
  if (apple) {
    params.push([directions ? "daddr" : "q", text]);
    if (directions) {
      const flags = { walking: "w", driving: "d", transit: "r", cycling: null };
      const flag = flags[input.mode!];
      if (flag) params.push(["dirflg", flag]);
      else modeNotice = "Choose cycling in Apple Maps; this link cannot preselect it.";
    }
  } else {
    params.push(["api", "1"]);
    params.push([directions ? "destination" : "query", text]);
    if (directions) params.push(["travelmode", input.mode === "cycling" ? "bicycling" : input.mode!]);
  }
  const href = `${base}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
  if (href.length > 2048) return null;
  return { href, label: `${directions ? "Directions" : "Search"} in ${apple ? "Apple Maps" : "Google Maps"}`, modeNotice };
}
