import type { AdvisorTipReaction } from "@cadence/core/types/advisor-tips";
import type { AdviceSignalInput, AdviceSignalKind } from "@cadence/core/types/advice-cards";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Advisor plan Phase 4, workstream 4B: database access for advisor tips.
// Coach-token calls (signals, history, writes) run as the person on the coach agent's
// client. `selectDueTipAccounts` runs on the service role. `nextTip` and `reactToTip`
// run on the person's own client (web session or the Mac's bearer token).

export class AdvisorTipsError extends Error {
  constructor(public readonly code: string) {
    super(`Advisor tips failed: ${code}.`);
    this.name = "AdvisorTipsError";
  }
}

export type DueTipAccount = Readonly<{ userId: string; localDate: string }>;

/** Service role: accounts whose morning signals are stored and whose tips are not written yet. */
export async function selectDueTipAccounts(serviceRole: AppSupabaseClient,
  input: Readonly<{ after: string | null; limit: number }>): Promise<DueTipAccount[]> {
  const { data, error } = await serviceRole.rpc("coach_tips_due_accounts", { p_after: input.after as string, p_limit: input.limit });
  if (error) throw new AdvisorTipsError("due_accounts_failed");
  return (data ?? []).map((row) => ({ userId: row.user_id, localDate: row.local_date }));
}

/** Coach token: the stored signals of one local date. */
export async function readStoredSignals(client: AppSupabaseClient, localDate: string): Promise<AdviceSignalInput[]> {
  const { data, error } = await client.rpc("coach_read_signals", { p_local_date: localDate });
  if (error || !Array.isArray(data)) throw new AdvisorTipsError("read_signals_failed");
  return data.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const item = row as Record<string, Json>;
    const facts = item.facts;
    if (typeof item.kind !== "string" || !facts || typeof facts !== "object" || Array.isArray(facts)) return [];
    return [{
      id: item.id === null || item.id === undefined ? null : String(item.id),
      kind: item.kind as AdviceSignalKind,
      behaviorId: typeof item.behavior_id === "string" ? item.behavior_id : null,
      facts: facts as Record<string, unknown>,
    }];
  });
}

export type StoredTip = Readonly<{
  localDate: string;
  position: number;
  cardId: string;
  behaviorId: string | null;
  factIds: readonly string[];
  factValues: Readonly<Record<string, unknown>>;
  source: "model" | "seed";
  shownAt: string | null;
  reaction: AdvisorTipReaction | null;
}>;

export type TipHistory = Readonly<{ tips: readonly StoredTip[]; suppressedCardIds: readonly string[] }>;

/** Coach token: tips from `since` on, and the cards the person turned off. */
export async function readTipHistory(client: AppSupabaseClient, since: string): Promise<TipHistory> {
  const { data, error } = await client.rpc("coach_tip_history", { p_since: since });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new AdvisorTipsError("read_history_failed");
  const body = data as { tips?: unknown; suppressed?: unknown };
  const tips = Array.isArray(body.tips) ? body.tips : [];
  return {
    tips: tips.flatMap((value) => {
      const row = value as Record<string, unknown>;
      if (typeof row.card_id !== "string" || typeof row.local_date !== "string") return [];
      return [{
        localDate: row.local_date,
        position: Number(row.position),
        cardId: row.card_id,
        behaviorId: typeof row.behavior_id === "string" ? row.behavior_id : null,
        factIds: Array.isArray(row.fact_ids) ? row.fact_ids.filter((id): id is string => typeof id === "string") : [],
        factValues: row.fact_values && typeof row.fact_values === "object" ? row.fact_values as Record<string, unknown> : {},
        source: row.source === "model" ? "model" : "seed",
        shownAt: typeof row.shown_at === "string" ? row.shown_at : null,
        reaction: isReaction(row.reaction) ? row.reaction : null,
      }];
    }),
    suppressedCardIds: Array.isArray(body.suppressed) ? body.suppressed.filter((id): id is string => typeof id === "string") : [],
  };
}

export type TipToWrite = Readonly<{
  text: string;
  cardId: string;
  cardRevision: number;
  behaviorId: string | null;
  factIds: readonly string[];
  factValues: Readonly<Record<string, unknown>>;
  source: "model" | "seed";
}>;

/** Coach token: writes the run's day of tips (replacing ones not yet shown). Returns how many landed. */
export async function writeTips(client: AppSupabaseClient, runId: string, tips: readonly TipToWrite[]): Promise<number> {
  const { data, error } = await client.rpc("coach_write_tips", {
    p_run_id: runId,
    p_tips: tips.map((tip) => ({
      text: tip.text, card_id: tip.cardId, card_revision: tip.cardRevision, behavior_id: tip.behaviorId,
      fact_ids: [...tip.factIds], fact_values: tip.factValues, source: tip.source,
    })) as unknown as Json,
  });
  if (error || typeof data !== "number") throw new AdvisorTipsError("write_failed");
  return data;
}

/** A tip row as the person's functions return it. */
export type TipRow = Readonly<{
  id: string;
  localDate: string;
  text: string;
  cardId: string;
  cardRevision: number;
  behaviorId: string | null;
  shownAt: string;
  reaction: AdvisorTipReaction | null;
}>;

export type NextTipResult =
  | Readonly<{ state: "tip"; tip: TipRow; fresh: boolean; nextAt: string | null }>
  | Readonly<{ state: "none"; reason: "no_tips_today" | "all_shown" | "later"; nextAt: string | null }>;

/** The person: the next tip for today (marks a new one shown). */
export async function nextTip(client: AppSupabaseClient, spacingMinutes: number): Promise<NextTipResult> {
  const { data, error } = await client.rpc("advisor_next_tip", { p_spacing_minutes: spacingMinutes });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new AdvisorTipsError("next_failed");
  const body = data as Record<string, unknown>;
  const nextAt = typeof body.next_at === "string" ? body.next_at : null;
  if (body.state === "tip") {
    const tip = parseTipRow(body.tip);
    if (!tip) throw new AdvisorTipsError("next_malformed");
    return { state: "tip", tip, fresh: body.fresh === true, nextAt };
  }
  const reason = body.reason === "all_shown" || body.reason === "later" ? body.reason : "no_tips_today";
  return { state: "none", reason, nextAt };
}

/** The person: react to one of their tips. Null when the tip is not theirs or does not exist. */
export async function reactToTip(client: AppSupabaseClient, tipId: string, reaction: AdvisorTipReaction): Promise<TipRow | null> {
  const { data, error } = await client.rpc("advisor_react_tip", { p_tip_id: tipId, p_reaction: reaction });
  if (error) {
    if ((error as { code?: string }).code === "P0002") return null;
    throw new AdvisorTipsError("react_failed");
  }
  const tip = parseTipRow(data);
  if (!tip) throw new AdvisorTipsError("react_malformed");
  return tip;
}

/** The person: tips shown on the last `days` local days before today, newest first (4E "Earlier"). */
export async function recentTips(client: AppSupabaseClient, days: number, limit: number): Promise<TipRow[]> {
  const { data, error } = await client.rpc("advisor_recent_tips", { p_days: days, p_limit: limit });
  if (error || !Array.isArray(data)) throw new AdvisorTipsError("recent_failed");
  return data.map(parseTipRow).filter((row): row is TipRow => row !== null);
}

function parseTipRow(value: unknown): TipRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.text !== "string" || typeof row.card_id !== "string"
    || typeof row.local_date !== "string") return null;
  return {
    id: row.id,
    localDate: row.local_date,
    text: row.text,
    cardId: row.card_id,
    cardRevision: Number(row.card_revision),
    behaviorId: typeof row.behavior_id === "string" ? row.behavior_id : null,
    shownAt: typeof row.shown_at === "string" ? row.shown_at : new Date(0).toISOString(),
    reaction: isReaction(row.reaction) ? row.reaction : null,
  };
}

function isReaction(value: unknown): value is AdvisorTipReaction {
  return value === "helpful" || value === "not_now" || value === "dont_suggest";
}
