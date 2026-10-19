import { describe, expect, it, vi } from "vitest";

import {
  beginIdempotentWrite,
  linkExternalReference,
  listExternalReferences,
} from "@/lib/db/integration.repo";
import {
  approveOAuthConsent,
  consumeOAuthRateLimit,
  exchangeAuthorizationCode,
  OAuthPersistenceError,
  purgeExpiredOAuthRecords,
  readOAuthClient,
  rotateRefreshToken,
  verifyAccessToken,
} from "@/lib/db/oauth.repo";

function clientReturning(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as never, rpc };
}

const HASH = "a".repeat(64);

describe("OAuth repository", () => {
  it("maps a successful code exchange", async () => {
    const { client, rpc } = clientReturning({
      ok: true,
      grant_id: "grant-1",
      user_id: "user-1",
      client_id: "client-1",
      scopes: ["cadence.read"],
      resource: "https://app.cadence-me.com/mcp",
      access_token_expires_at: "2026-10-18T17:00:00Z",
      refresh_token_expires_at: "2026-11-17T16:00:00Z",
    });

    await expect(
      exchangeAuthorizationCode(client, {
        codeHash: HASH,
        clientId: "client-1",
        redirectUri: "https://client.example/callback",
        resource: "https://app.cadence-me.com/mcp",
        codeVerifier: "v".repeat(43),
        accessTokenHash: "b".repeat(64),
        refreshTokenHash: "c".repeat(64),
      }),
    ).resolves.toMatchObject({ ok: true, grantId: "grant-1", scopes: ["cadence.read"] });
    expect(rpc).toHaveBeenCalledWith(
      "oauth_exchange_authorization_code",
      expect.objectContaining({ p_code_hash: HASH, p_client_id: "client-1" }),
    );
  });

  it("reports refresh reuse without throwing", async () => {
    const { client, rpc } = clientReturning({
      ok: false,
      error: "invalid_grant",
      reuse_detected: true,
    });

    await expect(
      rotateRefreshToken(client, {
        refreshTokenHash: HASH,
        clientId: "client-1",
        resource: null,
        scopes: null,
        accessTokenHash: "b".repeat(64),
        nextRefreshTokenHash: "c".repeat(64),
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_grant", reuseDetected: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_resource: null, p_scopes: null });
  });

  it("treats inactive tokens as null and rejects unknown scopes", async () => {
    await expect(
      verifyAccessToken(clientReturning({ active: false }).client, {
        accessTokenHash: HASH,
        resource: "https://app.cadence-me.com/mcp",
      }),
    ).resolves.toBeNull();

    await expect(
      verifyAccessToken(
        clientReturning({
          active: true,
          user_id: "user-1",
          grant_id: "grant-1",
          client_id: "client-1",
          client_name: "Client",
          verified_client: null,
          scopes: ["cadence.admin"],
          resource: "https://app.cadence-me.com/mcp",
          expires_at: "2026-10-18T17:00:00Z",
        }).client,
        { accessTokenHash: HASH, resource: "https://app.cadence-me.com/mcp" },
      ),
    ).rejects.toBeInstanceOf(OAuthPersistenceError);
  });

  it("returns null for unknown clients", async () => {
    await expect(readOAuthClient(clientReturning(null).client, "missing")).resolves.toBeNull();
  });

  it("surfaces stable consent error codes", async () => {
    const { client } = clientReturning(null, { message: "oauth_invalid_redirect_uri" });

    await expect(
      approveOAuthConsent(client, {
        clientId: "client-1",
        redirectUri: "https://evil.example/callback",
        codeChallenge: "c".repeat(43),
        resource: "https://app.cadence-me.com/mcp",
        scopes: ["cadence.read"],
        codeHash: HASH,
      }),
    ).rejects.toMatchObject({ code: "oauth_invalid_redirect_uri" });
  });

  it("passes exactly one rate-limit bucket", async () => {
    const { client, rpc } = clientReturning({
      allowed: true,
      limit_count: 10,
      remaining: 9,
      reset_at: "2026-10-18T17:00:00Z",
      retry_after_seconds: 3600,
    });

    await consumeOAuthRateLimit(client, { action: "client_registration", sourceHash: HASH });
    expect(rpc).toHaveBeenCalledWith("oauth_consume_rate_limit", {
      p_action: "client_registration",
      p_grant_id: null,
      p_source_hash: HASH,
    });
  });
});

describe("integration repository", () => {
  it("maps idempotency claims", async () => {
    await expect(
      beginIdempotentWrite(
        clientReturning([{ state: "replay", result: { ok: true } }]).client,
        { idempotencyKey: "k", operation: "set_occurrence_status", requestHash: HASH },
      ),
    ).resolves.toEqual({ state: "replay", result: { ok: true } });

    await expect(
      beginIdempotentWrite(clientReturning([]).client, {
        idempotencyKey: "k",
        operation: "set_occurrence_status",
        requestHash: HASH,
      }),
    ).rejects.toBeInstanceOf(OAuthPersistenceError);
  });

  it("validates external reference link states and read bounds", async () => {
    await expect(
      linkExternalReference(clientReturning("conflict").client, {
        entityType: "behavior",
        entityId: "behavior-1",
        externalId: "facets-1",
      }),
    ).resolves.toBe("conflict");

    const { client, rpc } = clientReturning([]);
    await expect(
      listExternalReferences(client, {
        entityType: "behavior",
        entityIds: Array.from({ length: 201 }, (_, index) => `id-${index}`),
      }),
    ).rejects.toMatchObject({ code: "too_many_entities" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

const purgeCounts = {
  authorization_codes: 1, access_tokens: 2, token_families: 3,
  clients: 4, idempotency_records: 5, activity: 6, rate_limit_counters: 7,
};

describe("OAuth purge result boundary", () => {
  function purgeClient(data: unknown, error: unknown = null) {
    const abortSignal = vi.fn().mockResolvedValue({ data, error });
    const rpc = vi.fn().mockReturnValue({ abortSignal });
    return { client: { rpc } as never, rpc, abortSignal };
  }

  it("passes cancellation to the RPC and returns all seven validated counts", async () => {
    const { client, rpc, abortSignal } = purgeClient(purgeCounts);
    const signal = new AbortController().signal;
    await expect(purgeExpiredOAuthRecords(client, signal)).resolves.toEqual(purgeCounts);
    expect(rpc).toHaveBeenCalledWith("oauth_purge_expired");
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it.each([
    null, [], {}, { ...purgeCounts, extra: 1 },
    ...[-1, 1.5, Infinity, NaN, "1", null, Number.MAX_SAFE_INTEGER + 1]
      .map((activity) => ({ ...purgeCounts, activity })),
  ])("rejects malformed raw purge result %#", async (data) => {
    await expect(purgeExpiredOAuthRecords(purgeClient(data).client, new AbortController().signal))
      .rejects.toMatchObject({ code: "invalid_purge_result" });
  });

  it("rejects each missing count", async () => {
    for (const key of Object.keys(purgeCounts)) {
      const data: Record<string, number> = { ...purgeCounts };
      delete data[key];
      await expect(purgeExpiredOAuthRecords(purgeClient(data).client, new AbortController().signal))
        .rejects.toMatchObject({ code: "invalid_purge_result" });
    }
  });

  it("rejects database failures without accepting their data", async () => {
    await expect(purgeExpiredOAuthRecords(purgeClient(purgeCounts, { message: "private error" }).client, new AbortController().signal))
      .rejects.toBeInstanceOf(OAuthPersistenceError);
  });
});
