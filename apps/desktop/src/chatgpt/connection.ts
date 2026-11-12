import { invoke } from "@tauri-apps/api/core";

// Ticket 297 (D27): the Mac app's ChatGPT connection client. Rust owns sign-in, the
// token endpoint, refresh, revocation and the Keychain items; this client receives only
// connection state, the ChatGPT email and model catalog rows. It keeps nothing in
// frontend storage. Ticket 299 adds the Settings card and `accessToken`: the access token
// for one Daily Brief model call, held only in memory by its caller.

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

export type ChatGptConnectionChange = Readonly<{
  kind: "start" | "settled";
  operation: "connect" | "disconnect" | "cancel";
}>;

export type ChatGptConnection = Readonly<{
  status(): Promise<ChatGptConnectionStatus>;
  /** Opens the system browser and resolves after the callback, a timeout (5 minutes) or a cancel. */
  connect(): Promise<ChatGptConnectionStatus>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<ChatGptDisconnectOutcome>;
  models(): Promise<ChatGptCatalogModel[]>;
  /** A fresh access token (Rust refreshes it first if needed). Use it for one call; never store it. */
  accessToken(): Promise<string>;
  /** Shared lifecycle only; subscribers never receive tokens or account details. */
  subscribe(listener: (change: ChatGptConnectionChange) => void): () => void;
  isConnecting(): boolean;
  isChanging(): boolean;
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

function readAccessToken(value: unknown): string {
  const token = record(value) ? optionalText(value.accessToken, 16_384) : null;
  if (!token) throw new ChatGptConnectionError("Cadence received an invalid ChatGPT access token.");
  return token;
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
  const listeners = new Set<(change: ChatGptConnectionChange) => void>();
  let connecting = false;
  let disconnecting = false;
  const notify = (change: ChatGptConnectionChange) => listeners.forEach((listener) => {
    try { listener(change); } catch { /* A UI observer cannot prevent native cancellation or token cleanup. */ }
  });
  const mutate = async <T>(operation: ChatGptConnectionChange["operation"], run: () => Promise<T>): Promise<T> => {
    if ((operation === "connect" && (connecting || disconnecting)) || (operation === "disconnect" && disconnecting)) {
      throw new ChatGptConnectionError("The ChatGPT connection is changing. Try again when it finishes.");
    }
    if (operation === "connect") connecting = true;
    if (operation === "disconnect") disconnecting = true;
    notify({ kind: "start", operation });
    try { return await run(); }
    finally {
      if (operation === "connect") connecting = false;
      if (operation === "disconnect") disconnecting = false;
      notify({ kind: "settled", operation });
    }
  };
  return {
    status: () => native(() => call("chatgpt_status"), readChatGptStatus),
    connect: () => mutate("connect", () => native(() => call("chatgpt_connect"), readChatGptStatus)),
    cancelConnect: () => mutate("cancel", () => native(() => call("chatgpt_cancel_connect"), () => undefined)),
    disconnect: () => mutate("disconnect", () => native(() => call("chatgpt_disconnect"), readOutcome)),
    models: () => native(() => call("chatgpt_models"), readChatGptCatalog),
    accessToken: () => native(() => call("chatgpt_access_token"), readAccessToken),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isConnecting: () => connecting,
    isChanging: () => connecting || disconnecting,
  };
}

/** Rejects stale controls synchronously, before an account teardown can trigger a React render. */
function guardChatGptConnection(connection: ChatGptConnection, currentAccount: () => boolean): ChatGptConnection {
  const change = async <T>(run: () => Promise<T>): Promise<T> => {
    if (!currentAccount()) throw new ChatGptConnectionError("The Cadence account changed. Open Settings and try again.");
    const value = await run();
    if (!currentAccount()) throw new ChatGptConnectionError("The Cadence account changed. Open Settings and try again.");
    return value;
  };
  return {
    ...connection,
    status: () => change(connection.status),
    models: () => change(connection.models),
    connect: () => change(connection.connect),
    cancelConnect: () => change(connection.cancelConnect),
    disconnect: () => change(connection.disconnect),
    accessToken: () => change(connection.accessToken),
  };
}

/** One app's synchronous account boundary, shared by every ChatGPT entry point. */
export function createChatGptAccountScope() {
  let accountId: string | null = null;
  let transitioning = false;
  return {
    setAccount: (next: string | null) => { accountId = next; },
    beginTransition: () => {
      if (transitioning) return false;
      transitioning = true;
      return true;
    },
    endTransition: () => { transitioning = false; },
    forAccount: (connection: ChatGptConnection, expected: string) =>
      guardChatGptConnection(connection, () => !transitioning && accountId === expected),
  };
}
