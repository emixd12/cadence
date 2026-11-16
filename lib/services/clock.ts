import { Temporal } from "@js-temporal/polyfill";
import type { CadenceClock } from "@cadence/core/resolvers/time.resolver";

/**
 * The web runtime's real clock. Core code cannot read the clock, so services
 * pass this to the time helper (`@cadence/core/resolvers/time.resolver`).
 * Tests pass `fixedClock` instead.
 */
export const systemClock: CadenceClock = {
  now: () => Temporal.Now.instant(),
};
