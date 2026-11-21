import type { BriefingReference } from "../services/briefing-references";
import type { BriefingPlanOption } from "./briefing-plan";
import type { BriefMoves } from "./brief-moves";
import type { BriefOpportunities } from "./brief-opportunities";

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
  /** Recipe 1.2 adds `behavior`, the moved Behavior's title, taken from the facts rather than model text. */
  suggestions?: readonly Readonly<{ text: string; occurrenceRefs: readonly string[]; referenceIds: readonly string[]; optionId: string | null; option?: BriefingPlanOption; behavior?: string }>[];
  references?: readonly BriefingReference[];
  /**
   * Optional pattern tip (Ticket 173). `basis`, `limitation` and `category` are
   * deterministic, not model text. Recipes 1.1 and 1.2 set `category`; absent means a pattern tip.
   * Recipe 1.2's `setup` tip is written by Cadence, not the model.
   */
  tip?: Readonly<{ text: string; laneId: string; basis: string; limitation: string | null; category?: "pattern" | "logging" | "setup" }>;
  /**
   * Recipe 1.2: today's Behavior titles that appear in the visible text, longest first,
   * so the bubble can highlight them. Deterministic; never model text.
   */
  behaviorNames?: readonly string[];
  versions?: Readonly<{ configuration: string; references: string; planner: string; pipeline: string; recipe?: string; policy?: string }>;
  /** Credits owed for facts the model used (Ticket 219): Open-Meteo weather is CC BY 4.0. */
  attributions?: readonly "open_meteo"[];
  /**
   * Advisor Phase 3: the brief's move lines, sent only to clients that request
   * `move_lines_v1` (packages/core/src/types/brief-moves.ts). Older clients keep the
   * opening and travel and see no move lines.
   */
  moves?: BriefMoves;
  /**
   * Behaviors of Opportunity (Task 7): "Add for today" lines. Present only for a client that
   * sent `opportunity_lines_v1` (packages/core/src/types/brief-opportunities.ts).
   */
  opportunities?: BriefOpportunities;
  /**
   * Advisor Phase 3: refreshes left today (one morning brief plus up to two refreshes
   * per account). `available` is false when none are left or a refresh would leave the
   * rest of the month's morning briefs unfunded. Absent from older servers.
   */
  refresh?: Readonly<{ remaining: number; available: boolean }>;
  /**
   * Advisor Phase 3: something is wrong with today's brief. Shown in the shared alert
   * style, never as advice. Text is Cadence's, never model text.
   */
  notices?: readonly DailyBriefNotice[];
}>;

/**
 * `calendar_stale`: a calendar did not load, so no time that depends on it is offered.
 * `budget_reached`: this month's Daily Brief budget is used; moves still work and the
 * written brief returns at `until`. `words_unavailable`: the writing step failed, so
 * Cadence's own short wording is shown with the same moves.
 */
export type DailyBriefNotice = Readonly<{ kind: "calendar_stale" | "budget_reached" | "words_unavailable"; text: string; until?: string }>;

export type DailyBriefSourceAttention = "changed" | "no_calendars" | "unavailable";

/** Ticket 306: the connected sources one Daily Brief choice covers. */
export const DAILY_BRIEF_CONNECTED_SOURCES = ["googleCalendar", "outlookCalendar", "icloudCalendar", "hevy"] as const;
export type DailyBriefConnectedSource = (typeof DAILY_BRIEF_CONNECTED_SOURCES)[number];
export type DailyBriefSourceFlags = Readonly<Record<DailyBriefConnectedSource, boolean>>;
/**
 * `ready`: connected with something to read (calendars also need a selected calendar).
 * `no_calendars`: a connected calendar with no selected calendar. `not_connected`: nothing to read.
 */
export type DailyBriefSourceStatus = "ready" | "no_calendars" | "not_connected";

export type DailyBriefSettings = Readonly<{
  accountRef: string;
  /** Whether the hosted model path can run: Cadence's server has its OpenAI key. */
  available: boolean;
  /**
   * Ticket 298: whether this server offers the device-model prepare and complete
   * routes (decision D27). Absent from older servers and treated as false.
   */
  deviceModelAvailable?: boolean;
  enabled: boolean;
  /**
   * Ticket 306: one choice covers every connected source, including one connected
   * later, except those excluded under Advanced. Absent from older servers.
   */
  useConnectedSources?: boolean;
  excludedSources?: DailyBriefSourceFlags;
  /** Whether each source has something to read now. Absent from older servers. */
  sourceStatus?: Readonly<Record<DailyBriefConnectedSource, DailyBriefSourceStatus>>;
  /**
   * Since Ticket 306 this and the three connector flags below report whether the brief
   * uses the source now, for clients built before the one choice.
   */
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
  /**
   * Advisor 4F: the one AI features approval and the other features' switches. The
   * source choices above are shared by every AI feature. Absent from older servers.
   */
  ai?: AiFeatureSettings;
}>;

export type AiFeatureSettings = Readonly<{
  /** False until the person answers the AI features question. */
  approved: boolean;
  tipsEnabled: boolean;
  chatEnabled: boolean;
}>;

export type DailyBriefResponse =
  | Readonly<{ state: "ready"; briefing: DailyBriefing }>
  | Readonly<{ state: "pending"; retryAfterSeconds?: number }>
  | Readonly<{ state: "already_attempted" }>;
