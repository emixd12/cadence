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
  /** Credits owed for facts the model used (Ticket 219): Open-Meteo weather is CC BY 4.0. */
  attributions?: readonly "open_meteo"[];
}>;

export type DailyBriefSourceAttention = "changed" | "no_calendars" | "unavailable";

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
  /**
   * Separate connector disclosures (Ticket 239); absent from older servers and
   * treated as false. `includeCalendar` stays Google Calendar only.
   */
  includeOutlookCalendar?: boolean;
  includeIcloudCalendar?: boolean;
  includeHevy?: boolean;
  /** Connected sources this server can disclose; Settings offers a control only for these. */
  connectorSources?: Readonly<{ outlookCalendar: boolean; icloudCalendar: boolean; hevy: boolean }>;
  /**
   * Why a disclosed source cannot be used now; null when it can or is off.
   * `changed`: reconnected or reselected since it was allowed, so it must be
   * allowed again. `no_calendars`: connected Outlook with no selected calendar.
   * `unavailable`: not connected or not supported yet.
   */
  connectorAttention?: Readonly<Record<"outlookCalendar" | "icloudCalendar" | "hevy", DailyBriefSourceAttention | null>>;
  revision: number;
  configurationRevision?: string;
  localDate: string;
  timezone: string;
}>;

export type DailyBriefResponse =
  | Readonly<{ state: "ready"; briefing: DailyBriefing }>
  | Readonly<{ state: "pending"; retryAfterSeconds?: number }>
  | Readonly<{ state: "already_attempted" }>;
