import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createIntegrationContext } from "../lib/integrations/request-context";
import {
  INTEGRATION_SIGNING_KEY_ENV,
  INTEGRATION_TOKEN_MAX_TTL_SECONDS,
  IntegrationSigningKeyError,
  integrationSigningPublicJwk,
  mintIntegrationAccessToken,
  parseIntegrationSigningKey,
  readIntegrationSigningKey,
} from "../lib/supabase/integration-token";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-18T12:00:00.000Z");

function generatePrivateJwk(kid = "test-kid-1") {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { ...privateKey.export({ format: "jwk" }), kid, alg: "ES256" };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function mint(overrides: Partial<Parameters<typeof mintIntegrationAccessToken>[1]> = {}) {
  const key = parseIntegrationSigningKey(JSON.stringify(generatePrivateJwk()));
  const minted = mintIntegrationAccessToken(key, {
    userId: USER_ID,
    channel: "mcp",
    grantId: "grant-1",
    clientId: "client-1",
    now: NOW,
    ...overrides,
  });
  return { key, minted };
}

describe("integration token minting", () => {
  it("signs ES256 with the imported key's kid", () => {
    const { key, minted } = mint();
    const [headerPart, payloadPart, signaturePart] = minted.token.split(".");

    expect(decodePart(headerPart!)).toEqual({
      alg: "ES256",
      typ: "JWT",
      kid: "test-kid-1",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        {
          key: integrationSigningPublicJwk(key),
          format: "jwk",
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signaturePart!, "base64url"),
      ),
    ).toBe(true);
  });

  it("sets the authenticated role, audience, subject, and Cadence attribution claims", () => {
    const { minted } = mint();
    const claims = decodePart(minted.token.split(".")[1]!);

    expect(claims).toMatchObject({
      sub: USER_ID,
      role: "authenticated",
      aud: "authenticated",
      iat: NOW.getTime() / 1000,
      cadence_channel: "mcp",
      cadence_grant_id: "grant-1",
      cadence_client_id: "client-1",
    });
    expect(typeof claims.jti).toBe("string");
    expect(Object.keys(claims).sort()).toEqual(
      [
        "aud",
        "cadence_channel",
        "cadence_client_id",
        "cadence_grant_id",
        "exp",
        "iat",
        "jti",
        "role",
        "sub",
      ].sort(),
    );
  });

  it("expires after at most five minutes from the injected clock", () => {
    const { minted } = mint();
    const claims = decodePart(minted.token.split(".")[1]!);

    expect(claims.exp).toBe(NOW.getTime() / 1000 + INTEGRATION_TOKEN_MAX_TTL_SECONDS);
    expect(INTEGRATION_TOKEN_MAX_TTL_SECONDS).toBe(300);
    expect(minted.expiresAt.toISOString()).toBe("2026-10-18T12:05:00.000Z");

    const shorter = mint({ ttlSeconds: 60 }).minted;
    expect(decodePart(shorter.token.split(".")[1]!).exp).toBe(
      NOW.getTime() / 1000 + 60,
    );
  });

  it("rejects lifetimes above five minutes and invalid inputs", () => {
    expect(() => mint({ ttlSeconds: 301 })).toThrow(RangeError);
    expect(() => mint({ ttlSeconds: 0 })).toThrow(RangeError);
    expect(() => mint({ userId: "not-a-uuid" })).toThrow(TypeError);
    expect(() => mint({ grantId: " " })).toThrow(TypeError);
    expect(() => mint({ clientId: "" })).toThrow(TypeError);
    expect(() => mint({ now: new Date(Number.NaN) })).toThrow(TypeError);
  });
});

describe("integration signing key parsing", () => {
  it("accepts a single JWK, the CLI array shape, and a JWK set", () => {
    const jwk = generatePrivateJwk("kid-shape");

    for (const raw of [jwk, [jwk], { keys: [jwk] }]) {
      expect(parseIntegrationSigningKey(JSON.stringify(raw)).kid).toBe("kid-shape");
    }
  });

  it("returns null when the environment variable is blank", () => {
    expect(readIntegrationSigningKey({})).toBeNull();
    expect(readIntegrationSigningKey({ [INTEGRATION_SIGNING_KEY_ENV]: "  " })).toBeNull();
  });

  it("rejects keys without a kid, public-only keys, and other algorithms without echoing key material", () => {
    const jwk = generatePrivateJwk();
    const withoutKid = { ...jwk, kid: undefined };
    const publicOnly = { ...jwk, d: undefined };
    const wrongAlg = { ...jwk, alg: "RS256" };

    for (const raw of [withoutKid, publicOnly, wrongAlg]) {
      let caught: unknown;
      try {
        parseIntegrationSigningKey(JSON.stringify(raw));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(IntegrationSigningKeyError);
      expect(String((caught as Error).message)).not.toContain(String(jwk.d));
    }

    expect(() => parseIntegrationSigningKey("{not json")).toThrow(
      IntegrationSigningKeyError,
    );
  });
});

describe("integration request context", () => {
  it("sends the minted user token with the publishable key and no service role", async () => {
    const key = parseIntegrationSigningKey(JSON.stringify(generatePrivateJwk("ctx-kid")));
    const requests: { url: string; headers: Headers }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const context = createIntegrationContext(
      {
        userId: USER_ID,
        grantId: "grant-ctx",
        clientId: "client-ctx",
        clientLabel: "Claude",
        channel: "mcp",
        scopes: ["cadence.read"],
      },
      {
        now: NOW,
        signingKey: key,
        runtimeConfig: {
          url: "http://127.0.0.1:1",
          publishableKey: "sb_publishable_test",
        },
        fetch: fakeFetch,
      },
    );

    expect(context.userId).toBe(USER_ID);
    expect(context.now).toBe(NOW);
    expect(context.tokenExpiresAt.toISOString()).toBe("2026-10-18T12:05:00.000Z");
    expect(context.actor).toEqual({
      channel: "mcp",
      clientId: "client-ctx",
      grantId: "grant-ctx",
      clientLabel: "Claude",
      grantedScopes: ["cadence.read"],
    });
    expect(Object.isFrozen(context.actor.grantedScopes)).toBe(true);

    await context.supabase.from("behaviors").select("id");

    expect(requests).toHaveLength(1);
    const authorization = requests[0]!.headers.get("authorization") ?? "";
    expect(authorization.startsWith("Bearer ")).toBe(true);
    const [headerPart, payloadPart] = authorization.slice(7).split(".");
    expect(decodePart(headerPart!).kid).toBe("ctx-kid");
    expect(decodePart(payloadPart!)).toMatchObject({
      sub: USER_ID,
      cadence_grant_id: "grant-ctx",
    });
    expect(requests[0]!.headers.get("apikey")).toBe("sb_publishable_test");
  });

  it("disables the Supabase Auth API on the integration client", () => {
    const key = parseIntegrationSigningKey(JSON.stringify(generatePrivateJwk()));
    const context = createIntegrationContext(
      {
        userId: USER_ID,
        grantId: "g",
        clientId: "c",
        clientLabel: "Client",
        channel: "mcp",
        scopes: ["cadence.read"],
      },
      {
        now: NOW,
        signingKey: key,
        runtimeConfig: { url: "http://127.0.0.1:1", publishableKey: "pk" },
      },
    );

    expect(() => context.supabase.auth.getUser()).toThrow();
  });
});
