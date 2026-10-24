import { createHmac } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  issueTravelConclusionsToken,
  readTravelConclusionsSecrets,
  travelConclusionsSourceKey,
  travelDurationHistoryRange,
  travelDurationRevision,
  verifyTravelConclusionsToken,
  type TravelConclusionsPayload,
} from "@/lib/services/travel-conclusions-token";

// Ticket 219 Option A (owner decision, October 23, 2026). Test-only secrets.
const SECRET = "test-only-current-secret-0123456789abcdef";
const OLD_SECRET = "test-only-previous-secret-0123456789abcd";
const NOW = Temporal.Instant.from("2026-11-01T13:00:00Z");
const payload: Omit<TravelConclusionsPayload, "v"> = {
  sub: "user-1", date: "2026-11-01", src: "source-1", iat: "2026-11-01T12:59:00Z", exp: "2026-11-01T13:05:00Z",
  conclusions: { version: "2.0", travelDay: "yes", calendarEvents: false,
    trips: [{ destinationRef: "occurrence:o1", role: "outbound", mode: "cycling", estimate: "current" }],
    fits: [{ ref: "occurrence:o2", conclusion: "does_not_fit", basis: "travel_overlap", trip: { destinationRef: "occurrence:o1", role: "outbound" }, position: null }] },
  weather: null,
  events: {},
};
const secrets = { current: SECRET, previous: null };
const verify = (token: unknown, overrides: Partial<Parameters<typeof verifyTravelConclusionsToken>[1]> = {}) =>
  verifyTravelConclusionsToken(token, { secrets, userId: "user-1", localDate: "2026-11-01", now: NOW, ...overrides });

describe("travel conclusions token", () => {
  it("round-trips Cadence's conclusions for the same user, day and window", () => {
    expect(verify(issueTravelConclusionsToken(payload, SECRET))).toEqual({ v: 1, ...payload });
    // Signed, not encrypted: the payload names only the user's own commitments and holds no timing.
    const body = JSON.parse(Buffer.from(issueTravelConclusionsToken(payload, SECRET).split(".")[0]!, "base64url").toString());
    expect(Object.keys(body).sort()).toEqual(["conclusions", "date", "events", "exp", "iat", "src", "sub", "v", "weather"]);
  });

  it("verifies a token signed with the previous secret only during rotation", () => {
    const old = issueTravelConclusionsToken(payload, OLD_SECRET);
    expect(verify(old)).toBeNull();
    expect(verify(old, { secrets: { current: SECRET, previous: OLD_SECRET } })).toEqual({ v: 1, ...payload });
    // A previous secret never stands in for a missing current one.
    expect(verify(old, { secrets: { current: null, previous: OLD_SECRET } })).toBeNull();
  });

  it("rejects every tampered, foreign, expired, early, malformed or unconfigured token", () => {
    const token = issueTravelConclusionsToken(payload, SECRET);
    const [body, signature] = token.split(".") as [string, string];
    const reencoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const signedBody = (encoded: string) => `${encoded}.${createHmac("sha256", SECRET).update(`cadence.travel-conclusions.v1.${encoded}`).digest("base64url")}`;
    const signed = (value: object) => signedBody(reencoded(value));
    const cases: [string, unknown, Partial<Parameters<typeof verifyTravelConclusionsToken>[1]>?][] = [
      ["tampered body", `${reencoded({ v: 1, ...payload, conclusions: { ...payload.conclusions, travelDay: "no" } })}.${signature}`],
      ["tampered signature", `${body}.${signature.slice(0, -2)}AA`],
      ["other user", token, { userId: "user-2" }],
      ["other day", token, { localDate: "2026-11-02" }],
      ["expired", token, { now: Temporal.Instant.from(payload.exp) }],
      ["issued in the future", signed({ v: 1, ...payload, iat: "2026-11-01T13:02:00Z" }), { now: Temporal.Instant.from("2026-11-01T13:00:30Z") }],
      ["issued after expiry", signed({ v: 1, ...payload, iat: "2026-11-01T13:06:00Z", exp: "2026-11-01T13:05:00Z" })],
      ["secret not configured", token, { secrets: { current: null, previous: null } }],
      ["wrong secret", issueTravelConclusionsToken(payload, OLD_SECRET)],
      ["not a string", 42],
      ["empty", ""],
      ["no signature", body],
      ["three parts", `${token}.extra`],
      ["not base64url", `${body}!.${signature}`],
      // Correctly signed, so these reach the payload checks.
      ["not JSON", signedBody(Buffer.from("not json").toString("base64url"))],
      ["JSON array", signedBody(Buffer.from("[]").toString("base64url"))],
      ["wrong version", signed({ ...payload, v: 2 })],
      ["extra field", signed({ v: 1, ...payload, durationSeconds: 2237 })],
      ["missing field", signed({ v: 1, ...payload, src: undefined })],
      ["bad instant", signed({ v: 1, ...payload, exp: "tomorrow" })],
      ["oversized", `${"A".repeat(40_000)}.${signature}`],
    ];
    for (const [label, value, overrides] of cases) expect(verify(value, overrides), label).toBeNull();
  });

  it("reads secrets only from the server environment and ignores short ones", () => {
    expect(readTravelConclusionsSecrets({})).toEqual({ current: null, previous: null });
    expect(readTravelConclusionsSecrets({ TRAVEL_CONCLUSIONS_SIGNING_SECRET: "short" })).toEqual({ current: null, previous: null });
    expect(readTravelConclusionsSecrets({ TRAVEL_CONCLUSIONS_SIGNING_SECRET: ` ${SECRET} `, TRAVEL_CONCLUSIONS_SIGNING_SECRET_PREVIOUS: OLD_SECRET }))
      .toEqual({ current: SECRET, previous: OLD_SECRET });
    expect(readTravelConclusionsSecrets({ NEXT_PUBLIC_TRAVEL_CONCLUSIONS_SIGNING_SECRET: SECRET })).toEqual({ current: null, previous: null });
  });

  it("changes the source key when any stored travel input changes", () => {
    const base = {
      settingsRevision: "s1", habitsRevision: "h1", enabled: true, mode: "cycling", routingConsentAt: "2026-10-01T00:00:00Z",
      timezone: "Europe/London", durationRevision: "d1",
      baseLocationText: "1 Home Road", habits: null,
      calendar: { status: "connected", generation: 1, selectionRevision: 1 },
      behaviors: [{ id: "b1", whereKind: "place", locationText: "2 Gym Road", updatedAt: "2026-10-01T00:00:00Z" }],
      occurrences: [
        { id: "o1", behavior_id: "b1", scheduled_for: "2026-11-01T18:00:00Z", local_date: "2026-11-01", schedule_kind: "exact", schedule_end_time: null, status: "unresolved" },
        { id: "o2", behavior_id: "b1", scheduled_for: "2026-11-01T20:00:00Z", local_date: "2026-11-01", schedule_kind: "exact", schedule_end_time: null, status: "unresolved" },
      ],
    };
    const key = travelConclusionsSourceKey(base);
    expect(travelConclusionsSourceKey({ ...base, occurrences: [...base.occurrences].reverse() })).toBe(key);
    expect(key).not.toContain("Gym");
    for (const changed of [
      { ...base, settingsRevision: "s2" },
      { ...base, habitsRevision: "h2" },
      { ...base, timezone: "America/New_York" },
      { ...base, durationRevision: "d2" },
      { ...base, baseLocationText: "2 Home Road" },
      { ...base, mode: "transit" },
      { ...base, calendar: { ...base.calendar, generation: 2 } },
      { ...base, calendar: { ...base.calendar, selectionRevision: 2 } },
      { ...base, behaviors: [{ ...base.behaviors[0]!, locationText: "3 Gym Road" }] },
      { ...base, occurrences: [{ ...base.occurrences[0]!, status: "completed" }, base.occurrences[1]!] },
      { ...base, occurrences: [{ ...base.occurrences[0]!, scheduled_for: "2026-11-01T18:30:00Z" }, base.occurrences[1]!] },
    ]) expect(travelConclusionsSourceKey(changed)).not.toBe(key);
  });

  it("uses the same completed-day duration window and stable history revision", () => {
    expect(travelDurationHistoryRange("2026-11-01")).toEqual({ startLocalDate: "2026-08-03", endLocalDate: "2026-10-31" });
    const occurrences = [{ id: "o1", updated_at: "2026-10-30T12:00:00Z" }, { id: "o2", updated_at: "2026-10-31T12:00:00Z" }];
    const sessions = [{ id: "s1", occurrence_id: "o1", behavior_id: "b1", started_at: "2026-10-30T11:00:00Z", stopped_at: "2026-10-30T12:00:00Z" }];
    const revision = travelDurationRevision(occurrences, sessions);
    expect(travelDurationRevision([...occurrences].reverse(), sessions)).toBe(revision);
    for (const changed of [
      { ...sessions[0]!, stopped_at: "2026-10-30T12:30:00Z" },
      { ...sessions[0]!, occurrence_id: "o2" },
      { ...sessions[0]!, behavior_id: "b2" },
    ]) expect(travelDurationRevision(occurrences, [changed])).not.toBe(revision);
  });

  it("refuses to issue a token larger than the verifier accepts", () => {
    expect(() => issueTravelConclusionsToken({ ...payload, events: { ["event:" + "x".repeat(40_000)]: "revision" } }, SECRET))
      .toThrow("Travel conclusions exceed the token size limit.");
  });
});
