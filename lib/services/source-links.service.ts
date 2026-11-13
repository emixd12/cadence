import type { RecordedActivitySourceV1_1 } from "@cadence/core/types/recorded-activity";
import { RECORDED_ACTIVITY_MAX_SELECTOR_KEYS } from "@cadence/core/types/recorded-activity";

import { readConnectorConnection } from "@/lib/db/connectors.repo";
import {
  deleteSourceLink,
  listSourceLinks,
  SourceLinkRepositoryError,
  upsertSourceLink,
  type SourceLinkRow,
} from "@/lib/db/sourceLinks.repo";
import { ConnectorError } from "@/lib/types/connectors";
import { completionSource, type CompletionSourcePort, type CompletionSourceSelectors } from "./completion-sources";
import { connectorCompletionEnabled } from "./connector-completion.service";
import type { ConnectorCaller } from "./connector-credentials";

// Ticket 316 (D28.3, D28.4): the Behavior form's source link. Save-time limits: a
// routine belongs to one enabled link per source, and one link per source accepts
// any workout. The database trigger enforces both again. Routine titles come from
// the provider for the form only and are never stored or logged.

export type SourceLinkMode = "off" | "any" | "routines";

export type SourceLinkHolder = Readonly<{ behaviorId: string; title: string }>;

export type SourceLinkFormState = Readonly<{
  source: RecordedActivitySourceV1_1;
  /** False while `CADENCE_CONNECTOR_COMPLETION` is off; the form then shows nothing. */
  available: boolean;
  connected: boolean;
  mode: SourceLinkMode;
  selectorKeys: readonly string[];
  /** The link was saved for another provider account; it stays fenced until saved again. */
  fenced: boolean;
  routines: readonly Readonly<{ key: string; title: string; holder: SourceLinkHolder | null }>[];
  /** Null when the list could not be read. */
  routinesComplete: boolean | null;
  /** Linked routines missing from a completely read list; null when the list is incomplete. */
  staleLinkedCount: number | null;
  /** The other Behavior with the any-workout link, if any. */
  anyHolder: SourceLinkHolder | null;
}>;

export type SourceLinkSaveResult =
  | Readonly<{ saved: true; mode: SourceLinkMode }>
  | Readonly<{ saved: false; reason: "selector_already_linked" | "any_link_exists" | "source_not_connected" | "invalid_selector"; holder: SourceLinkHolder | null }>;

type Dependencies = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  port?: CompletionSourcePort;
  listLinks?: (source: RecordedActivitySourceV1_1) => Promise<SourceLinkRow[]>;
  behaviorTitles?: (ids: readonly string[]) => Promise<Map<string, string>>;
  connectionDigest?: (source: RecordedActivitySourceV1_1) => Promise<string | null>;
  save?: typeof upsertSourceLink;
  remove?: typeof deleteSourceLink;
  scheduleCheck?: (source: RecordedActivitySourceV1_1) => Promise<void>;
}>;

const DIGEST = /^[a-f0-9]{64}$/u;

export async function getSourceLinkFormState(
  caller: ConnectorCaller,
  input: Readonly<{ behaviorId: string; source: unknown }>,
  deps: Dependencies = {},
): Promise<SourceLinkFormState> {
  const port = deps.port ?? completionSource(input.source);
  const source = port.source;
  const empty: SourceLinkFormState = {
    source, available: false, connected: false, mode: "off", selectorKeys: [], fenced: false,
    routines: [], routinesComplete: null, staleLinkedCount: null, anyHolder: null,
  };
  if (!connectorCompletionEnabled(deps.env)) return empty;
  // An empty ID is a Behavior being created: it has no link yet, and every enabled link
  // belongs to another Behavior (Ticket 329).
  if (input.behaviorId !== "" && !isUuid(input.behaviorId)) throw new ConnectorError("invalid_request");
  const digest = await (deps.connectionDigest ?? ((value) => connectedDigest(caller, value)))(source);
  const links = await (deps.listLinks ?? ((value) => listSourceLinks(caller.client, caller.user.id, value)))(source);
  const own = links.find((link) => link.behavior_id === input.behaviorId) ?? null;
  const others = links.filter((link) => link.enabled && link.behavior_id !== input.behaviorId);
  const titles = await (deps.behaviorTitles ?? ((ids) => behaviorTitles(caller, ids)))(
    [...new Set(others.map((link) => link.behavior_id))],
  );
  const holderOf = (link: SourceLinkRow): SourceLinkHolder => ({ behaviorId: link.behavior_id, title: titles.get(link.behavior_id) ?? "Another Behavior" });
  const anyLink = others.find((link) => link.selector_kind === "any") ?? null;
  const mode: SourceLinkMode = !own || !own.enabled ? "off" : own.selector_kind === "any" ? "any" : "routines";
  const base: SourceLinkFormState = {
    ...empty,
    available: true,
    connected: digest !== null,
    mode,
    selectorKeys: own?.selector_keys ?? [],
    fenced: own !== null && own.enabled && digest !== null && own.account_digest !== digest,
    anyHolder: anyLink ? holderOf(anyLink) : null,
  };
  if (digest === null) return base;
  let selectors: CompletionSourceSelectors | null = null;
  try {
    selectors = await port.listSelectors(caller);
  } catch {
    selectors = null;
  }
  if (!selectors) return base;
  const holders = new Map<string, SourceLinkHolder>();
  for (const link of others) {
    if (link.selector_kind !== "provider_keys") continue;
    for (const key of link.selector_keys) holders.set(key, holderOf(link));
  }
  const listed = new Set(selectors.selectors.map((selector) => selector.key));
  return {
    ...base,
    routines: selectors.selectors.map((selector) => ({ key: selector.key, title: selector.label, holder: holders.get(selector.key) ?? null })),
    routinesComplete: selectors.complete,
    staleLinkedCount: selectors.complete && own?.selector_kind === "provider_keys"
      ? own.selector_keys.filter((key) => !listed.has(key)).length
      : null,
  };
}

/** Accepts exactly `{ behaviorId, source, mode, selectorKeys }`. */
export function parseSourceLinkBody(body: unknown): Readonly<{
  behaviorId: string;
  source: RecordedActivitySourceV1_1;
  mode: SourceLinkMode;
  selectorKeys: string[];
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("invalid_request");
  const entry = body as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  if (keys.join(",") !== "behaviorId,mode,selectorKeys,source") throw new ConnectorError("invalid_request");
  const source = completionSource(entry.source).source;
  if (!isUuid(entry.behaviorId) || !["off", "any", "routines"].includes(String(entry.mode))) throw new ConnectorError("invalid_request");
  const selectorKeys = entry.selectorKeys;
  if (!Array.isArray(selectorKeys) || selectorKeys.length > RECORDED_ACTIVITY_MAX_SELECTOR_KEYS
    || selectorKeys.some((key) => typeof key !== "string" || !DIGEST.test(key))) throw new ConnectorError("invalid_request");
  const mode = entry.mode as SourceLinkMode;
  if ((mode === "routines") !== (selectorKeys.length > 0)) throw new ConnectorError("invalid_request");
  return { behaviorId: entry.behaviorId as string, source, mode, selectorKeys: [...new Set(selectorKeys as string[])].sort() };
}

export async function saveSourceLink(
  caller: ConnectorCaller,
  body: unknown,
  deps: Dependencies = {},
): Promise<SourceLinkSaveResult> {
  if (!connectorCompletionEnabled(deps.env)) throw new ConnectorError("not_configured");
  const input = parseSourceLinkBody(body);
  const links = await (deps.listLinks ?? ((value) => listSourceLinks(caller.client, caller.user.id, value)))(input.source);
  const own = links.find((link) => link.behavior_id === input.behaviorId) ?? null;
  const others = links.filter((link) => link.enabled && link.behavior_id !== input.behaviorId);
  const save = deps.save ?? upsertSourceLink;
  const holder = async (link: SourceLinkRow | undefined): Promise<SourceLinkHolder | null> => {
    if (!link) return null;
    const titles = await (deps.behaviorTitles ?? ((ids) => behaviorTitles(caller, ids)))([link.behavior_id]);
    return { behaviorId: link.behavior_id, title: titles.get(link.behavior_id) ?? "Another Behavior" };
  };

  if (input.mode === "off") {
    if (own?.enabled) {
      await save(caller.client, { userId: caller.user.id, behaviorId: input.behaviorId, source: input.source,
        selectorKind: own.selector_kind as "any" | "provider_keys", selectorKeys: own.selector_keys, enabled: false });
    }
    return { saved: true, mode: "off" };
  }
  if (input.mode === "any") {
    const existing = others.find((link) => link.selector_kind === "any");
    if (existing) return { saved: false, reason: "any_link_exists", holder: await holder(existing) };
  } else {
    const existing = others.find((link) => link.selector_kind === "provider_keys"
      && link.selector_keys.some((key) => input.selectorKeys.includes(key)));
    if (existing) return { saved: false, reason: "selector_already_linked", holder: await holder(existing) };
  }
  try {
    await save(caller.client, {
      userId: caller.user.id,
      behaviorId: input.behaviorId,
      source: input.source,
      selectorKind: input.mode === "any" ? "any" : "provider_keys",
      selectorKeys: input.mode === "any" ? [] : input.selectorKeys,
      enabled: true,
    });
  } catch (error) {
    if (error instanceof SourceLinkRepositoryError && error.code !== "write_failed") {
      return { saved: false, reason: error.code, holder: null };
    }
    throw new ConnectorError("provider_unavailable");
  }
  // Ticket 321: a newly enabled link is due for a background check at once.
  await (deps.scheduleCheck ?? ((source) => scheduleCheckNow(caller, source)))(input.source).catch(() => undefined);
  return { saved: true, mode: input.mode };
}

async function scheduleCheckNow(caller: ConnectorCaller, source: RecordedActivitySourceV1_1): Promise<void> {
  const at = new Date().toISOString();
  const existing = await caller.client.from("connector_completion_state").select("source")
    .eq("user_id", caller.user.id).eq("source", source).maybeSingle();
  if (existing.error) throw existing.error;
  const { error } = existing.data
    ? await caller.client.from("connector_completion_state").update({ next_check_at: at }).eq("user_id", caller.user.id).eq("source", source)
    : await caller.client.from("connector_completion_state").insert({ user_id: caller.user.id, source, next_check_at: at });
  if (error) throw error;
}

async function connectedDigest(caller: ConnectorCaller, source: RecordedActivitySourceV1_1): Promise<string | null> {
  const connection = await readConnectorConnection(caller.client, caller.user.id, source);
  return connection?.status === "connected" ? connection.accountDigest : null;
}

async function behaviorTitles(caller: ConnectorCaller, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await caller.client.from("behaviors").select("id,title").eq("user_id", caller.user.id).in("id", [...ids]);
  if (error) throw new ConnectorError("provider_unavailable");
  return new Map((data ?? []).map((row) => [row.id, row.title]));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}
