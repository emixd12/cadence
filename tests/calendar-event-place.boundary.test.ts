import fs from "node:fs";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { planBriefPairingLines } from "@cadence/core/resolvers/alongside-pairing.resolver";
import { planBriefMoveLinesFromInputs } from "@cadence/core/resolvers/brief-move.resolver";
import { prepareBriefOpening } from "@/lib/services/brief-opening";
import { chatPairingProposal } from "@/lib/services/alongside-pairing.service";
import { planAlongsidePairings } from "@cadence/core/resolvers/alongside-pairing.resolver";
import { briefEvalFixture } from "@/lib/services/advisor-eval/brief-fixtures";

// Ticket 384 (D37): a calendar event's coarse place (Home, a saved place's key or
// unknown) is for the free-slot rule only and lives for one request. It is never stored,
// logged or sent to a model, and travel code never reads it.
//
// This scan pins that boundary: only the modules listed below may name the label, the
// catalog of place keys or the location sidecar. Model-input builders, stored and wire
// shapes, repositories, logging, MCP outputs and travel code must not.

const root = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["app", "components", "lib", "packages", "apps/desktop/src", "integrations", "supabase"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|sql)$/;
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

/** The label, the place-key catalog, and the in-memory location sidecar, by name. */
const LABEL = /\b(eventPlaces?|calendarEventPlace|CalendarEventPlace|parseCalendarEventPlace|calendarEventPlacesById|planningPlaceCatalog|PlanningPlaceCatalog|planningPlaces|readPlanningPlaceCatalog|eventPlacesFromLocations|MovePlanningPlacesContext|eventLocations)\b/;

/** The only modules that may name it: the rule, the free-slot planners, and the request paths that compute it. */
const READERS = new Set([
  // The rule and the free-slot planners (pure).
  "packages/core/src/resolvers/alongside.resolver.ts",
  "packages/core/src/resolvers/brief-move.resolver.ts",
  "packages/core/src/resolvers/move.resolver.ts",
  "packages/core/src/resolvers/timeline-context.resolver.ts",
  // The Timeline view's keys, attached only while a row is alongside (web and Mac).
  "packages/core/src/types/timeline.ts",
  "packages/core/src/services/timeline-alongside.ts",
  "lib/services/timeline.service.ts",
  "apps/desktop/src/local-timeline.service.ts",
  // Server reads: the catalog, the brief's server-read events, and the brief's own Calendar read.
  "lib/services/planning-places.service.ts",
  "lib/services/brief-moves.service.ts",
  "lib/services/advisor-day-context.service.ts",
  "lib/services/briefing-account-context.service.ts",
  "lib/services/daily-brief.service.ts",
  // Slot checks that carry an event's place into the rule.
  "lib/services/occurrence-move.service.ts",
  "lib/services/opportunity-integration.service.ts",
  "lib/services/chat/chat-executor.ts",
  // The web Timeline computes the label on the device and its Server Action reads it.
  "components/timeline/OccurrenceMoves.tsx",
  "components/timeline/DayProgressTimeline.tsx",
  "app/(app)/timeline/move-actions.ts",
  // Offline eval fixtures and the chat eval's stand-in executor (its results never carry it).
  "lib/services/advisor-eval/brief-fixtures.ts",
  "lib/services/chat-eval/fake-tools.ts",
]);

/** Model-input builders, stored and wire shapes, repositories, logs and MCP outputs. */
const FORBIDDEN = [
  /^lib\/services\/brief-opening\.ts$/,
  /^lib\/services\/daily-brief-consumer\.ts$/,
  /^lib\/services\/daily-brief-instructions\.ts$/,
  /^lib\/services\/chat\/(?!chat-executor\.ts$)/,
  /^lib\/services\/chat-eval\/(?!fake-tools\.ts$)/,
  /^packages\/core\/src\/services\/advisor-day-context\.ts$/,
  /^packages\/core\/src\/types\/advisor-day-context\.ts$/,
  /^packages\/core\/src\/types\/brief-moves\.ts$/,
  /^packages\/core\/src\/services\/description-duration\.ts$/,
  /^packages\/core\/src\/integration\//,
  /^lib\/integrations\//,
  /^lib\/db\//,
  /^lib\/monitoring\//,
  /^supabase\//,
  /^apps\/desktop\/src-tauri\//,
  /(^|\/)[^/]*(travel|departure|leave-reminder|LeaveReminder|Travel|Departure)[^/]*$/,
];

describe("calendar event place boundary", () => {
  it("lets only the listed modules name the label", () => {
    const named = files.filter((file) => LABEL.test(read(file)));
    expect(named).toEqual(expect.arrayContaining([...READERS]));
    expect(named.filter((file) => !READERS.has(file))).toEqual([]);
  });

  it("keeps it out of model-input builders, stored shapes, repositories, logs, MCP outputs and travel code", () => {
    expect([...READERS].filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)))).toEqual([]);
    expect(files.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)) && LABEL.test(read(file)))).toEqual([]);
  });

  it("never logs it", () => {
    const logged = [...READERS].flatMap((file) => read(file).split("\n")
      .filter((line) => LABEL.test(line) && /console\.|logConnectorRead|reportMonitoringEvent|logger\./.test(line))
      .map((line) => `${file}: ${line.trim()}`));
    expect(logged).toEqual([]);
  });

  it("leaves no label in the brief's lines, the words request or Chat's pairing result", () => {
    const fixture = briefEvalFixture("alongside_event_place");
    const key = fixture.plan.calendarBusy.find((event) => event.eventPlace)!.eventPlace!;
    expect(key).toMatchObject({ kind: "place" });
    const moves = planBriefMoveLinesFromInputs(fixture.plan).candidates;
    const lines = [...moves, ...planBriefPairingLines({ ...fixture.plan, evidence: fixture.pairing! }, moves)];
    expect(lines.some((line) => line.reasonCode === "alongside_pairing")).toBe(true);
    const placeKey = (key as { placeKey: string }).placeKey;
    const opening = prepareBriefOpening({ context: fixture.context, lines, conflicts: [], calendar: fixture.plan.calendar, now: fixture.now });
    for (const value of [lines, opening]) {
      const text = JSON.stringify(value);
      expect(text).not.toContain("eventPlace");
      expect(text).not.toContain(placeKey);
    }
    const chat = planAlongsidePairings({ ...fixture.plan, evidence: fixture.pairing! }).map((pairing) => chatPairingProposal(pairing, fixture.plan.timezone));
    expect(chat.length).toBeGreaterThan(0);
    expect(JSON.stringify(chat)).not.toContain("eventPlace");
    expect(JSON.stringify(chat)).not.toContain(placeKey);
    expect(Temporal.Instant.from(chat[0]!.start_at)).toBeInstanceOf(Temporal.Instant);
  });
});
