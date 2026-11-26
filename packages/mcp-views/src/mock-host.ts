// A stand-in MCP Apps host and Cadence server for the bench page and the tests. It speaks
// the view's side of the protocol (MCP Apps spec 2026-01-26, JSON-RPC over postMessage):
// `ui/initialize`, the tool result notification, `tools/call` for the four tools the view
// uses, `ui/update-model-context` and size reports. It holds one fixture day and applies
// writes to it with the real preconditions. Never shipped in the view bundle.
import { GRANTED_SCOPES_META_KEY } from "./contract";
import { rollup, STATUS_LABEL, type FixtureDay, type FixtureOccurrence } from "./fixtures";
import type { OccurrenceStatus } from "./contract";

export type MockWrites =
  /** Writes apply. */
  | "ok"
  /** The item changes "somewhere else" before the first write, which then conflicts. */
  | "conflict-once"
  /** The first write is refused with `rate_limited`. */
  | "rate-limit-once"
  /** Every write returns the `insufficient_scope` tool error. */
  | "insufficient-scope"
  /** Every write is rejected at the JSON-RPC level, as an SDK-built host does on a 403. */
  | "reject";

export type MockHostOptions = Readonly<{
  /** Sends one JSON-RPC message to the view. */
  post(message: Record<string, unknown>): void;
  day: FixtureDay;
  /** Scopes in each `show_day` result's `_meta`. null sends no `_meta` at all. */
  scopes?: readonly string[] | null;
  /** Scopes for the first result only, when they differ from later reads. */
  initialScopes?: readonly string[] | null;
  writes?: MockWrites;
  retryAfterSeconds?: number;
  /** "never": the host sends no tool result. "cancelled": it reports the call cancelled. */
  result?: "send" | "never" | "cancelled";
  theme?: "light" | "dark";
  styleVariables?: Readonly<Record<string, string>>;
  onSize?(size: { width?: number; height?: number }): void;
  onLog?(entry: MockHostLogEntry): void;
}>;

export type MockHostLogEntry =
  | Readonly<{ kind: "tool"; name: string; arguments: Record<string, unknown>; outcome: string }>
  | Readonly<{ kind: "model-context"; text: string }>
  | Readonly<{ kind: "other"; method: string }>;

export type MockHost = Readonly<{
  receive(message: unknown): void;
  log: readonly MockHostLogEntry[];
  day(): FixtureDay;
  setTheme(theme: "light" | "dark", styleVariables?: Readonly<Record<string, string>>): void;
}>;

export const FULL_SCOPES = ["cadence.read", "cadence.occurrences.write"] as const;
export const READ_ONLY_SCOPES = ["cadence.read"] as const;

type Rpc = { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
type ToolAnswer = { isError?: boolean; structuredContent: Record<string, unknown>; content: { type: "text"; text: string }[]; _meta?: Record<string, unknown> };

const WRITE_TOOLS = new Set(["set_occurrence_status", "set_parent_occurrence_status", "update_occurrence_note"]);

function answer(structuredContent: Record<string, unknown>, extra: Partial<ToolAnswer> = {}): ToolAnswer {
  return { structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }], ...extra };
}

function errorAnswer(code: string, extra: Record<string, unknown> = {}): ToolAnswer {
  return answer({ error: { code, message: code, ...extra } }, { isError: true });
}

export function createMockHost(options: MockHostOptions): MockHost {
  const day: FixtureDay = structuredClone(options.day);
  const log: MockHostLogEntry[] = [];
  const writes = options.writes ?? "ok";
  const scopes = options.scopes === undefined ? FULL_SCOPES : options.scopes;
  let firstRead = true;
  let firstWrite = true;
  let revision = 1;

  const record = (entry: MockHostLogEntry) => {
    log.push(entry);
    options.onLog?.(entry);
  };

  const find = (id: unknown): FixtureOccurrence | undefined => day.occurrences.find((occurrence) => occurrence.id === id);

  const setStatus = (occurrence: FixtureOccurrence, status: OccurrenceStatus) => {
    occurrence.status = status;
    occurrence.status_label = STATUS_LABEL[status];
    occurrence.connector_completion = null;
    occurrence.revision = `r${(revision += 1)}-${occurrence.id.slice(-4)}`;
    day.parent_groups = day.parent_groups.map((group) => rollup(
      { n: Number(group.parent_behavior_id.slice(-12)), title: group.title },
      group.slot_key,
      group.scheduled_time_label,
      group.occurrence_ids.flatMap((id) => find(id) ?? []),
    ));
  };

  const setNote = (occurrence: FixtureOccurrence, note: string) => {
    occurrence.note = note === "" ? null : note;
    occurrence.revision = `r${(revision += 1)}-${occurrence.id.slice(-4)}`;
  };

  const showDay = (): ToolAnswer => {
    const granted = firstRead && options.initialScopes !== undefined ? options.initialScopes : scopes;
    firstRead = false;
    const content = structuredClone(day) as unknown as Record<string, unknown>;
    return answer(content, granted ? { _meta: { [GRANTED_SCOPES_META_KEY]: [...granted] } } : {});
  };

  /** The change that happens "somewhere else" before a conflicting write arrives. */
  const changeElsewhere = (name: string, args: Record<string, unknown>) => {
    const target = find(args.occurrence_id) ?? find((args.occurrence_ids as unknown[] | undefined)?.[0]);
    if (!target) return;
    if (name === "update_occurrence_note") setNote(target, "Changed on another device.");
    else setStatus(target, target.status === "not_completed" ? "completed" : "not_completed");
  };

  const write = (name: string, args: Record<string, unknown>): ToolAnswer => {
    if (name === "set_occurrence_status") {
      const occurrence = find(args.occurrence_id);
      if (!occurrence) return errorAnswer("not_found");
      if (args.expected_status !== undefined && args.expected_status !== occurrence.status) return errorAnswer("conflict");
      const previous = occurrence.status;
      setStatus(occurrence, args.status as OccurrenceStatus);
      return answer({ occurrence: structuredClone(occurrence), previous_status: previous, changed: previous !== occurrence.status });
    }
    if (name === "set_parent_occurrence_status") {
      const targets = ((args.occurrence_ids as unknown[] | undefined) ?? []).map(find);
      if (targets.length === 0 || targets.some((target) => !target)) return errorAnswer("not_found");
      const expected = (args.expected_statuses as { occurrence_id: string; status: string }[] | undefined) ?? [];
      if (expected.some((entry) => find(entry.occurrence_id)?.status !== entry.status)) return errorAnswer("conflict");
      for (const target of targets) setStatus(target!, args.status as OccurrenceStatus);
      return answer({ parent_behavior_id: args.parent_behavior_id, status: args.status, changed: true });
    }
    const occurrence = find(args.occurrence_id);
    if (!occurrence) return errorAnswer("not_found");
    if (args.expected_revision !== undefined && args.expected_revision !== occurrence.revision) return errorAnswer("conflict");
    setNote(occurrence, String(args.note ?? ""));
    return answer({ occurrence: structuredClone(occurrence), changed: true });
  };

  const callTool = (name: string, args: Record<string, unknown>): ToolAnswer | "reject" => {
    if (name === "show_day") return showDay();
    if (!WRITE_TOOLS.has(name)) return errorAnswer("invalid_input");
    if (writes === "reject") return "reject";
    if (writes === "insufficient-scope") return errorAnswer("insufficient_scope");
    const first = firstWrite;
    firstWrite = false;
    if (first && writes === "rate-limit-once") return errorAnswer("rate_limited", { retry_after_seconds: options.retryAfterSeconds ?? 8 });
    if (first && writes === "conflict-once") changeElsewhere(name, args);
    return write(name, args);
  };

  const hostContext = (theme: "light" | "dark", styleVariables?: Readonly<Record<string, string>>) => ({
    theme,
    ...(styleVariables ? { styles: { variables: styleVariables } } : {}),
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    platform: "web",
  });

  const reply = (id: string | number, result: unknown) => options.post({ jsonrpc: "2.0", id, result });

  return {
    log,
    day: () => structuredClone(day),
    setTheme(theme, styleVariables) {
      options.post({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: hostContext(theme, styleVariables) });
    },
    receive(message) {
      const rpc = message as Rpc | null;
      if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return;
      const { id, method, params = {} } = rpc;

      if (method === "ui/initialize" && id !== undefined) {
        reply(id, {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "cadence-mock-host", version: "1.0.0" },
          hostCapabilities: { serverTools: {}, updateModelContext: { text: {} } },
          hostContext: hostContext(options.theme ?? "light", options.styleVariables),
        });
        return;
      }
      if (method === "ui/notifications/initialized") {
        if (options.result === "never") return;
        if (options.result === "cancelled") {
          options.post({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "cancelled" } });
          return;
        }
        options.post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } });
        options.post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: showDay() });
        return;
      }
      if (method === "ui/notifications/size-changed") {
        options.onSize?.(params as { width?: number; height?: number });
        return;
      }
      if (id === undefined) return;
      if (method === "tools/call") {
        const name = String(params.name);
        const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
        const result = callTool(name, args);
        if (result === "reject") {
          record({ kind: "tool", name, arguments: args, outcome: "rejected" });
          options.post({ jsonrpc: "2.0", id, error: { code: -32000, message: "Insufficient scope" } });
          return;
        }
        const code = result.isError ? String((result.structuredContent.error as { code: string }).code) : "ok";
        record({ kind: "tool", name, arguments: args, outcome: code });
        reply(id, result);
        return;
      }
      if (method === "ui/update-model-context") {
        const blocks = (params.content as { type: string; text?: string }[] | undefined) ?? [];
        record({ kind: "model-context", text: blocks.map((block) => block.text ?? "").join("\n") });
        reply(id, {});
        return;
      }
      if (method === "ping") {
        reply(id, {});
        return;
      }
      record({ kind: "other", method });
      options.post({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    },
  };
}
