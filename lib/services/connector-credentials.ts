import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  beginConnectorAttempt,
  consumeConnectorAttempt,
  disconnectConnectorConnection,
  installConnectorCredential,
  readConnectorConnection,
  readConnectorConnections,
  readConnectorCredential,
  replaceConnectorCredential,
} from "@/lib/db/connectors.repo";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_REVOCATION_INSTRUCTIONS,
  ConnectorError,
  DEFAULT_CONNECTOR_PREFERENCES,
  type ConnectorConnection,
  type ConnectorConnectionView,
  type ConnectorCredential,
  type ConnectorOAuthAttempt,
  type ConnectorProvider,
  type ConnectorRevocationInstruction,
} from "@/lib/types/connectors";
import type { CalendarCaller } from "./google-calendar.service";

// Ticket 235 credential custody for Hevy, Outlook Calendar, and iCloud Calendar.
// The Google Calendar key, AAD, and same-subject rules stay in google-calendar-oauth.ts.
export type ConnectorCaller = CalendarCaller;
export type ConnectorCredentialConfig = Readonly<{ key: Buffer; keyId: string; decryptionKeys: Readonly<Record<string, Buffer>> }>;

const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;
function decodeKey(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}
export function readConnectorCredentialConfig(env: Record<string, string | undefined> = process.env): ConnectorCredentialConfig | null {
  const { CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: encoded, CONNECTOR_CREDENTIAL_KEY_ID: keyId } = env;
  const key = decodeKey(encoded);
  if (!key || !keyId || !KEY_ID.test(keyId)) return null;
  try {
    const oldKeys: unknown = JSON.parse(env.CONNECTOR_CREDENTIAL_DECRYPTION_KEYS || "{}");
    if (!oldKeys || typeof oldKeys !== "object" || Array.isArray(oldKeys)) return null;
    const decryptionKeys: Record<string, Buffer> = {};
    for (const [id, value] of Object.entries(oldKeys)) {
      const decoded = decodeKey(value);
      if (!KEY_ID.test(id) || id === keyId || !decoded) return null;
      decryptionKeys[id] = decoded;
    }
    return { key, keyId, decryptionKeys };
  } catch { return null; }
}
function requireConfig(): ConnectorCredentialConfig {
  const config = readConnectorCredentialConfig();
  if (!config) throw new ConnectorError("not_configured");
  return config;
}

/**
 * Hashes a provider account identity: Hevy `user/info` id, Outlook `[tid, sub]`,
 * or the iCloud `current-user-principal` href. Never pass an email address.
 */
export function connectorAccountDigest(provider: ConnectorProvider, identity: readonly string[]): string {
  if (identity.length < 1 || identity.length > 2 || identity.some((part) => typeof part !== "string" || !part || part.length > 2048)) {
    throw new ConnectorError("malformed_provider_response");
  }
  return createHash("sha256").update(JSON.stringify(["cadence-connector-account-v1", provider, ...identity])).digest("hex");
}
export function hashConnectorState(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export type ConnectorSecretBinding = Readonly<{
  purpose: "credential" | "verifier";
  userId: string;
  provider: ConnectorProvider;
  /** Required for credentials; verifiers precede identity and use null. */
  accountDigest: string | null;
  generation: number;
  stateHash?: string;
}>;
function associatedData(binding: ConnectorSecretBinding): Buffer {
  return Buffer.from(JSON.stringify(["cadence-connector-v1", binding.provider, binding.purpose, binding.userId,
    binding.accountDigest, binding.generation, binding.stateHash ?? null]));
}
function seal(config: ConnectorCredentialConfig, value: string, binding: ConnectorSecretBinding): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(associatedData(binding));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [config.keyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
function open(config: ConnectorCredentialConfig, sealed: string, binding: ConnectorSecretBinding): string {
  try {
    const [version, iv, tag, ciphertext, extra] = sealed.split(".");
    if (!version || !iv || !tag || !ciphertext || extra !== undefined) throw new Error();
    const key = version === config.keyId ? config.key : config.decryptionKeys[version];
    if (!key) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(associatedData(binding)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ConnectorError("reconnect_required"); }
}

// Bounded printable values; control characters and whitespace-only values are refused.
function secretText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function validCredential(value: unknown, provider: ConnectorProvider): value is ConnectorCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort().join(",");
  if (entry.provider !== provider) return false;
  if (provider === "hevy") return keys === "apiKey,provider" && secretText(entry.apiKey, 256);
  if (provider === "outlook_calendar") return keys === "provider,refreshToken" && secretText(entry.refreshToken, 16_384);
  return keys === "appPassword,appleId,provider" && secretText(entry.appleId, 254) && secretText(entry.appPassword, 256);
}
export function sealConnectorCredential(config: ConnectorCredentialConfig, credential: ConnectorCredential, binding: ConnectorSecretBinding): string {
  if (binding.purpose !== "credential" || !binding.accountDigest || !validCredential(credential, binding.provider)) throw new ConnectorError("invalid_request");
  return seal(config, JSON.stringify(credential), binding);
}
export function openConnectorCredential(config: ConnectorCredentialConfig, sealed: string, binding: ConnectorSecretBinding): ConnectorCredential {
  if (binding.purpose !== "credential") throw new ConnectorError("reconnect_required");
  let parsed: unknown;
  try { parsed = JSON.parse(open(config, sealed, binding)); } catch { throw new ConnectorError("reconnect_required"); }
  if (!validCredential(parsed, binding.provider)) throw new ConnectorError("reconnect_required");
  return parsed;
}
export function sealConnectorVerifier(config: ConnectorCredentialConfig, verifier: string, binding: ConnectorSecretBinding): string {
  if (binding.purpose !== "verifier" || binding.accountDigest !== null || !binding.stateHash || !secretText(verifier, 256)) throw new ConnectorError("invalid_request");
  return seal(config, verifier, binding);
}
export function openConnectorVerifier(config: ConnectorCredentialConfig, sealed: string, binding: ConnectorSecretBinding): string {
  if (binding.purpose !== "verifier" || binding.accountDigest !== null || !binding.stateHash) throw new ConnectorError("expired_attempt");
  return open(config, sealed, binding);
}

function toView(caller: ConnectorCaller, provider: ConnectorProvider, connection: ConnectorConnection | null | undefined, configured: boolean): ConnectorConnectionView {
  if (!configured) return { accountId: caller.user.id, provider, status: "not_configured", generation: connection?.generation ?? 0, selectionRevision: 0, preferences: DEFAULT_CONNECTOR_PREFERENCES };
  return connection
    ? { accountId: caller.user.id, provider, status: connection.status, generation: connection.generation, selectionRevision: connection.selectionRevision, preferences: connection.preferences }
    : { accountId: caller.user.id, provider, status: "disconnected", generation: 0, selectionRevision: 0, preferences: DEFAULT_CONNECTOR_PREFERENCES };
}
/** Client-safe status for every new provider. Owner metadata uses the caller's JWT and RLS. */
export async function getConnectorConnections(caller: ConnectorCaller): Promise<ConnectorConnectionView[]> {
  const configured = readConnectorCredentialConfig() !== null;
  const rows = await readConnectorConnections(caller.client, caller.user.id);
  return CONNECTOR_PROVIDERS.map((provider) => toView(caller, provider, rows.find((row) => row.provider === provider), configured));
}
export async function getConnectorConnection(caller: ConnectorCaller, provider: ConnectorProvider): Promise<ConnectorConnectionView> {
  const configured = readConnectorCredentialConfig() !== null;
  return toView(caller, provider, await readConnectorConnection(caller.client, caller.user.id, provider), configured);
}

/**
 * Direct credential intake for Hevy and iCloud. `verify` performs the provider's
 * identity read (Tickets 236 and 240) and returns identity parts for the digest.
 * The generation read before verification fences concurrent and replayed intake.
 */
export async function connectDirectCredential(caller: ConnectorCaller, credential: ConnectorCredential & { provider: "hevy" | "icloud_calendar" },
  verify: (credential: ConnectorCredential) => Promise<readonly string[]>): Promise<ConnectorConnectionView> {
  const config = requireConfig();
  if (!validCredential(credential, credential.provider)) throw new ConnectorError("invalid_request");
  const before = await readConnectorConnection(caller.client, caller.user.id, credential.provider);
  const expectedGeneration = before?.generation ?? 0;
  const accountDigest = connectorAccountDigest(credential.provider, await verify(credential));
  if (before?.accountDigest && before.accountDigest !== accountDigest) throw new ConnectorError("wrong_account");
  const ciphertext = sealConnectorCredential(config, credential, { purpose: "credential", userId: caller.user.id, provider: credential.provider,
    accountDigest, generation: expectedGeneration + 1 });
  await installConnectorCredential({ userId: caller.user.id, provider: credential.provider, accountDigest, expectedGeneration, stateHash: null, ciphertext });
  return getConnectorConnection(caller, credential.provider);
}

/** Stores the sealed PKCE verifier for one Outlook attempt (Ticket 237 owns the OAuth flow). */
export async function beginConnectorOAuthAttempt(caller: ConnectorCaller, input: { provider: "outlook_calendar"; state: string; verifier: string;
  target: "web" | "desktop"; clientState: string }): Promise<number> {
  const config = requireConfig();
  if (input.target === "desktop" && !/^[a-zA-Z0-9_-]{32,128}$/.test(input.clientState)) throw new ConnectorError("invalid_request");
  if (input.target === "web" && input.clientState !== "") throw new ConnectorError("invalid_request");
  const existing = await readConnectorConnection(caller.client, caller.user.id, input.provider);
  const generation = existing?.generation ?? 0;
  const stateHash = hashConnectorState(input.state);
  const sealedVerifier = sealConnectorVerifier(config, input.verifier, { purpose: "verifier", userId: caller.user.id, provider: input.provider,
    accountDigest: null, generation, stateHash });
  await beginConnectorAttempt({ userId: caller.user.id, provider: input.provider, generation, stateHash, sealedVerifier, target: input.target, clientState: input.clientState });
  return generation;
}
/** One-use: a replayed or expired state returns null. */
export async function consumeConnectorOAuthAttempt(provider: "outlook_calendar", state: string): Promise<{ attempt: ConnectorOAuthAttempt; verifier: string } | null> {
  const config = requireConfig();
  const attempt = await consumeConnectorAttempt(provider, hashConnectorState(state));
  if (!attempt) return null;
  const verifier = openConnectorVerifier(config, attempt.sealedVerifier, { purpose: "verifier", userId: attempt.userId, provider,
    accountDigest: null, generation: attempt.generation, stateHash: attempt.stateHash });
  return { attempt, verifier };
}
export async function completeConnectorOAuthAttempt(attempt: ConnectorOAuthAttempt, identity: readonly string[], credential: ConnectorCredential): Promise<void> {
  const config = requireConfig();
  const accountDigest = connectorAccountDigest(attempt.provider, identity);
  const ciphertext = sealConnectorCredential(config, credential, { purpose: "credential", userId: attempt.userId, provider: attempt.provider,
    accountDigest, generation: attempt.generation + 1 });
  await installConnectorCredential({ userId: attempt.userId, provider: attempt.provider, accountDigest, expectedGeneration: attempt.generation,
    stateHash: attempt.stateHash, ciphertext });
}

async function connected(caller: ConnectorCaller, provider: ConnectorProvider): Promise<ConnectorConnection> {
  const connection = await readConnectorConnection(caller.client, caller.user.id, provider);
  if (!connection || connection.status === "disconnected") throw new ConnectorError("not_connected");
  if (connection.status !== "connected") throw new ConnectorError("reconnect_required");
  return connection;
}
/** Rejects a provider response if the generation or selection changed while it was in flight. */
export async function assertConnectorCurrent(caller: ConnectorCaller, previous: ConnectorConnection): Promise<void> {
  const current = await connected(caller, previous.provider);
  if (current.generation !== previous.generation || current.selectionRevision !== previous.selectionRevision ||
    current.accountDigest !== previous.accountDigest) throw new ConnectorError("connection_changed");
}

/**
 * Opens the current credential for one request, runs the provider read, and
 * returns its result only if the connection is unchanged afterwards. The
 * credential never leaves this call. An unopenable credential is fenced as
 * reconnect_required for that provider only.
 */
export async function withConnectorCredential<T>(caller: ConnectorCaller, provider: ConnectorProvider,
  run: (credential: ConnectorCredential, connection: ConnectorConnection) => Promise<T>): Promise<T> {
  const config = requireConfig();
  const connection = await connected(caller, provider);
  let credential: ConnectorCredential;
  try {
    credential = openConnectorCredential(config, await readConnectorCredential(connection), { purpose: "credential", userId: connection.userId,
      provider, accountDigest: connection.accountDigest, generation: connection.generation });
  } catch (error) {
    const failure = error instanceof ConnectorError ? error : new ConnectorError("reconnect_required");
    if (failure.code === "reconnect_required") await markConnectorReconnectRequired(connection).catch(() => undefined);
    throw failure;
  }
  const result = await run(credential, connection);
  await assertConnectorCurrent(caller, connection);
  return result;
}

/** Outlook refresh-token rotation within the same generation; fails after disconnect or reconnect. */
export async function rotateConnectorCredential(connection: ConnectorConnection, credential: ConnectorCredential): Promise<void> {
  const config = requireConfig();
  await replaceConnectorCredential(connection, sealConnectorCredential(config, credential, { purpose: "credential", userId: connection.userId,
    provider: connection.provider, accountDigest: connection.accountDigest, generation: connection.generation }));
}
export async function markConnectorReconnectRequired(connection: ConnectorConnection): Promise<void> {
  if (connection.status !== "connected") return;
  await disconnectConnectorConnection(connection, "reconnect_required");
}

/**
 * Deletes the selected provider's credential, attempts, and selections and
 * advances its generation. No new provider documents app-side revocation, so the
 * response names the user's removal step instead.
 */
export async function disconnectConnector(caller: ConnectorCaller, provider: ConnectorProvider):
  Promise<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }> {
  const connection = await readConnectorConnection(caller.client, caller.user.id, provider);
  // Any existing row is fenced, including a disconnected row with a pending Outlook attempt.
  if (connection) await disconnectConnectorConnection(connection, "disconnected");
  return { ...await getConnectorConnection(caller, provider), revocation: CONNECTOR_REVOCATION_INSTRUCTIONS[provider] };
}
