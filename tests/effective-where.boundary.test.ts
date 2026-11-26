import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planBriefMoveLinesFromInputs, type BriefMoveDayItem } from "@cadence/core/resolvers/brief-move.resolver";
import { Temporal } from "@js-temporal/polyfill";

// Ticket 357 (D33): a Where from completion evidence or a model guess is for planning
// only. It never requests a route, a departure line or a leave reminder: travel,
// departure and leave-reminder code reads the person's `where_kind` alone.
//
// This scan pins that boundary. Travel, departure and leave-reminder sources must not
// name the effective Where or the stored guess, and only the planning readers listed
// below may import the resolver or select `where_guess`.

const root = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["app", "components", "lib", "packages", "apps/desktop/src", "integrations"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs)$/;
const SKIPPED = new Set(["node_modules", ".next", ".astro", "dist", "build", "target", "gen"]);

function sourceFiles(relative: string): string[] {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return SOURCE_FILE.test(relative) ? [relative] : [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || (entry.isDirectory() && SKIPPED.has(entry.name))) return [];
    return sourceFiles(path.posix.join(relative, entry.name));
  });
}

const files = SCAN_ROOTS.flatMap(sourceFiles).sort();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/** Travel, departure, routing and leave-reminder code, by file name. */
const TRAVEL_FILE = /(^|\/)[^/]*(travel|departure|leave-reminder|leave_reminder|LeaveReminder|Travel|Departure)[^/]*$/;
const EFFECTIVE_WHERE = /effective-where|EffectiveWhere|resolveEffectiveWhere|where_guess|whereGuess|alongsideMayOverlap|briefMoveOverlapSubject/;

/** The only readers of the effective Where: planning, its re-export and its type users. */
const RESOLVER_IMPORTERS = new Set([
  "lib/resolvers/effective-where.resolver.ts",
  "lib/services/brief-move-day.service.ts",
  // Ticket 358: shows the same values planning uses (form guess, row label, Where guess line).
  "lib/services/alongside-view.service.ts",
  "packages/core/src/resolvers/alongside.resolver.ts",
  "packages/core/src/resolvers/brief-move.resolver.ts",
  // Ticket 359: the estimate call's parser and writer validate the guess's four values.
  "packages/core/src/services/description-duration.ts",
  "lib/services/brief-moves.service.ts",
  // Ticket 359: the advisor day context's planning field (server-side; never in model facts).
  "packages/core/src/types/advisor-day-context.ts",
  "packages/core/src/services/advisor-day-context.ts",
]);
/** The only sources that name the stored guess column. */
const GUESS_READERS = new Set([
  "lib/db/database.types.ts",
  "packages/core/src/resolvers/effective-where.resolver.ts",
  "lib/services/brief-move-day.service.ts",
  // Ticket 358: reads the guess only to show it as a guess; it never requests a route.
  "lib/services/alongside-view.service.ts",
  // Ticket 359: the estimate writer (`cacheBehaviorEstimates`).
  "lib/services/brief-moves.service.ts",
]);

describe("effective Where boundary", () => {
  it("finds the travel, departure and leave-reminder sources it guards", () => {
    const guarded = files.filter((file) => TRAVEL_FILE.test(file));
    expect(guarded).toEqual(expect.arrayContaining([
      "packages/core/src/resolvers/travel.resolver.ts",
      "packages/core/src/resolvers/departure.resolver.ts",
      "packages/core/src/services/leave-reminder-plan.ts",
      "lib/services/travel-route-refresh.service.ts",
      "lib/services/leave-reminder-delivery.ts",
      "apps/desktop/src/leave-reminders.ts",
    ]));
  });

  it("keeps travel, departure and leave-reminder code on the person's Where", () => {
    const offenders = files.filter((file) => TRAVEL_FILE.test(file) && EFFECTIVE_WHERE.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("lets only planning import the effective Where resolver", () => {
    const importers = files.filter((file) => file !== "packages/core/src/resolvers/effective-where.resolver.ts"
      && /effective-where\.resolver/.test(read(file)));
    expect(importers).toEqual(expect.arrayContaining([...RESOLVER_IMPORTERS]));
    expect(importers.filter((file) => !RESOLVER_IMPORTERS.has(file))).toEqual([]);
  });

  it("lets only the planning reader name where_guess", () => {
    const readers = files.filter((file) => /\bwhere_guess\b/.test(read(file)));
    expect(readers.filter((file) => !GUESS_READERS.has(file))).toEqual([]);
  });

  it("keeps a guessed Where out of a brief line's travel state", () => {
    // A Behavior guessed or counted at a place has no `where_kind`: the brief says no
    // travel is needed rather than "travel not checked", so it never asks for a route.
    const local = (time: string) => Temporal.PlainDateTime.from(`2026-11-25T${time}`).toZonedDateTime("America/New_York").toInstant();
    const item = (id: string, where: BriefMoveDayItem["where"]): BriefMoveDayItem => ({
      occurrenceId: id, behaviorId: `b-${id}`, title: id, status: "unresolved", localDate: "2026-11-25", scheduleKind: "exact",
      start: local("10:00"), end: local("10:30"), length: { minutes: 30, source: "behavior_duration", assumed: false },
      alongside: false, revision: "r", behaviorRevision: "br", ...(where ? { where } : {}),
    });
    const plan = planBriefMoveLinesFromInputs({
      localDate: "2026-11-25", timezone: "America/New_York", now: local("08:00"),
      items: [item("gym", { kind: "place", placeKey: "g".repeat(43), source: "evidence" }), item("walk", { kind: "elsewhere", source: "guess" })],
      calendarBusy: [], calendar: "current", travel: null, placeBehaviorIds: new Set(),
      declinedToday: new Set(), neverMoveBehaviorIds: new Set(),
    });
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(plan.candidates.every((line) => line.travel === "not_needed")).toBe(true);
  });
});
