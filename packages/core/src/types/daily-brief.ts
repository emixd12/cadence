import type { BriefingReference } from "../services/briefing-references";
import type { BriefingPlanOption } from "./briefing-plan";

/** Daily Brief interprets practical constraints; it does not recap the ledger. */
export const DAILY_BRIEF_POLICY_VERSION = "3.0" as const;

export type DailyBriefing = Readonly<{
  text: string;
  localDate: string;
  timezone: string;
  generatedAt: string;
  expiresAt: string;
  coverage: "complete" | "partial";
  warnings: readonly string[];
  suggestions?: readonly Readonly<{ text: string; occurrenceRefs: readonly string[]; referenceIds: readonly string[]; optionId: string | null; option?: BriefingPlanOption }>[];
  references?: readonly BriefingReference[];
  /** Optional pattern tip (Ticket 173). `basis` and `limitation` are deterministic, not model text. */
  tip?: Readonly<{ text: string; laneId: string; basis: string; limitation: string | null }>;
  versions?: Readonly<{ configuration: string; references: string; planner: string; pipeline: string; recipe?: string; policy?: string }>;
}>;

export type DailyBriefSettings = Readonly<{
  accountRef: string;
  available: boolean;
  enabled: boolean;
  includeCalendar: boolean;
  /** Optional sources (Ticket 172); absent from older servers and treated as false. */
  includeReminderHistory?: boolean;
  includeNotes?: boolean;
  /** Optional sources the server can use; Settings offers only these controls. */
  optionalSources?: Readonly<{ reminders: boolean; notes: boolean }>;
  revision: number;
  configurationRevision?: string;
  localDate: string;
  timezone: string;
}>;

export type DailyBriefResponse =
  | Readonly<{ state: "ready"; briefing: DailyBriefing }>
  | Readonly<{ state: "pending"; retryAfterSeconds?: number }>
  | Readonly<{ state: "already_attempted" }>;
