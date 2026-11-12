import { invoke } from "@tauri-apps/api/core";

// Ticket 297 (D27): the Mac app's ChatGPT connection client. Rust owns sign-in, the
// token endpoint, refresh, revocation and the Keychain items; this client receives only
// connection state, the ChatGPT email and model catalog rows. It keeps nothing in
// frontend storage. No UI calls it yet; Ticket 299 adds the Settings card.

export type ChatGptConnectionState =
  | "disconnected"
  | "connectedWithoutPlanUsage"
  | "connectedWithPlanUsage"
  | "needsReconnect";

export type ChatGptConnectionStatus = Readonly<{ state: ChatGptConnectionState; email: string | null }>;

/** One catalog row. Model selection is a separate service and is not done here. */
export type ChatGptCatalogModel = Readonly<{ slug: string; visibility: string | null }>;

/** `revocationFailed` still clears local tokens; the grant may stay listed in ChatGPT. */
export type ChatGptDisconnectOutcome = "revoked" | "revocationFailed" | "notConnected";

export type ChatGptConnection = Readonly<{
  status(): Promise<ChatGptConnectionStatus>;
  /** Opens the system browser and resolves after the callback, a timeout (5 minutes) or a cancel. */
  connect(): Promise<ChatGptConnectionStatus>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<ChatGptDisconnectOutcome>;
  models(): Promise<ChatGptCatalogModel[]>;
}>;

type Call = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const STATES: readonly ChatGptConnectionState[] = ["disconnected", "connectedWithoutPlanUsage", "connectedWithPlanUsage", "needsReconnect"];
const OUTCOMES: readonly ChatGptDisconnectOutcome[] = ["revoked", "revocationFailed", "notConnected"];

export class ChatGptConnectionError extends Error {
  override name = "ChatGptConnectionError";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

// Readers copy only the known fields, so no other native value can reach callers.
export function readChatGptStatus(value: unknown): ChatGptConnectionStatus {
  if (!record(value) || !STATES.includes(value.state as ChatGptConnectionState)) {
    throw new ChatGptConnectionError("Cadence received an invalid ChatGPT connection state.");
  }
  return { state: value.state as ChatGptConnectionState, email: optionalText(value.email, 320) };
}

export function readChatGptCatalog(value: unknown): ChatGptCatalogModel[] {
  if (!Array.isArray(value)) throw new ChatGptConnectionError("Cadence received an invalid ChatGPT model list.");
  return value.flatMap((row) => {
    const slug = record(row) ? optionalText(row.slug, 128) : null;
    return slug && record(row) ? [{ slug, visibility: optionalText(row.visibility, 64) }] : [];
  });
}

function readOutcome(value: unknown): ChatGptDisconnectOutcome {
  const outcome = record(value) ? value.outcome : null;
  if (!OUTCOMES.includes(outcome as ChatGptDisconnectOutcome)) {
    throw new ChatGptConnectionError("Cadence received an invalid ChatGPT disconnect result.");
  }
  return outcome as ChatGptDisconnectOutcome;
}

/** Native errors are fixed sentences without token text; anything else gets a generic one. */
async function native<T>(run: () => Promise<unknown>, read: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = await run();
  } catch (error) {
    throw new ChatGptConnectionError(typeof error === "string" && error.length <= 200 ? error : "The ChatGPT connection did not respond.");
  }
  return read(value);
}

export function createChatGptConnection(call: Call = (command, args) => invoke(command, args)): ChatGptConnection {
  return {
    status: () => native(() => call("chatgpt_status"), readChatGptStatus),
    connect: () => native(() => call("chatgpt_connect"), readChatGptStatus),
    cancelConnect: () => native(() => call("chatgpt_cancel_connect"), () => undefined),
    disconnect: () => native(() => call("chatgpt_disconnect"), readOutcome),
    models: () => native(() => call("chatgpt_models"), readChatGptCatalog),
  };
}
