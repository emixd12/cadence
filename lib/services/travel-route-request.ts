import { Temporal } from "@js-temporal/polyfill";

export type TravelRouteRefreshRequest = Readonly<{
  scope: "timeline" | "day";
  startLocalDate: string;
  endLocalDate: string;
  device: Readonly<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    sampledAt: string;
  }> | null;
  corrections: ReadonlyArray<Readonly<{
    eventId: string;
    revision: string;
    attendance: "physical" | "remote";
    locationText: string | null;
  }>>;
}>;

export function parseTravelRouteRefreshRequest(value: unknown): TravelRouteRefreshRequest {
  if (!record(value)) throw new TypeError("Travel route request must be an object.");
  const scope = value.scope ?? "timeline";
  if (scope !== "timeline" && scope !== "day") throw new TypeError("Travel route scope is invalid.");
  const startLocalDate = localDate(value.startLocalDate);
  const endLocalDate = localDate(value.endLocalDate);
  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(endLocalDate), Temporal.PlainDate.from(startLocalDate)) < 0 ||
      Temporal.PlainDate.from(startLocalDate).until(Temporal.PlainDate.from(endLocalDate)).days > 1) throw new TypeError("Travel route range must cover one or two adjacent local days.");
  const corrections = value.corrections === undefined ? [] : correctionArray(value.corrections);
  return { scope, startLocalDate, endLocalDate, device: device(value.device), corrections };
}

function device(value: unknown): TravelRouteRefreshRequest["device"] {
  if (value === null || value === undefined) return null;
  if (!record(value) || !finiteCoordinate(value.latitude, 90) || !finiteCoordinate(value.longitude, 180) || !finiteNonNegative(value.accuracyMeters) || typeof value.sampledAt !== "string") throw new TypeError("Travel device sample is invalid.");
  instant(value.sampledAt);
  return { latitude: value.latitude, longitude: value.longitude, accuracyMeters: value.accuracyMeters, sampledAt: value.sampledAt };
}

function correctionArray(value: unknown): TravelRouteRefreshRequest["corrections"] {
  if (!Array.isArray(value) || value.length > 8) throw new TypeError("Travel corrections are invalid.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !boundedText(item.eventId, 256) || !boundedText(item.revision, 512) || (item.attendance !== "physical" && item.attendance !== "remote") || !(item.locationText === null || boundedText(item.locationText, 512)) || ids.has(item.eventId)) throw new TypeError("Travel correction is invalid.");
    ids.add(item.eventId);
    return { eventId: item.eventId, revision: item.revision, attendance: item.attendance, locationText: item.locationText };
  });
}

function localDate(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Travel local date is invalid.");
  try {
    const date = Temporal.PlainDate.from(value);
    if (date.toString() !== value) throw new Error();
    return value;
  } catch { throw new TypeError("Travel local date is invalid."); }
}

function instant(value: string): void {
  try { Temporal.Instant.from(value); }
  catch { throw new TypeError("Travel device time is invalid."); }
}

function finiteCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
