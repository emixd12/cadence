import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLoginPath,
  authRequestUrl,
  MISSING_CONFIG_ERROR,
  normalizeRedirectPath,
} from "../lib/auth/redirects";

describe("auth redirects", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [
      "development",
      "http://localhost:4324/login",
      "127.0.0.1:4324",
      "http://127.0.0.1:4324/login",
    ],
    [
      "development",
      "http://127.0.0.1:4330/login",
      "localhost:4330",
      "http://localhost:4330/login",
    ],
    [
      "development",
      "http://localhost:4324/login",
      "evil.example:4324",
      "http://localhost:4324/login",
    ],
    [
      "development",
      "http://localhost:4324/login",
      "127.0.0.1:4325",
      "http://localhost:4324/login",
    ],
    [
      "development",
      "http://localhost:4331/login",
      "127.0.0.1:4331",
      "http://localhost:4331/login",
    ],
    [
      "development",
      "http://localhost:4324/login",
      "localhost:4324@evil.example",
      "http://localhost:4324/login",
    ],
    [
      "development",
      "https://app.cadence-me.com/login",
      "localhost:4324",
      "https://app.cadence-me.com/login",
    ],
    [
      "production",
      "http://localhost:4324/login",
      "127.0.0.1:4324",
      "http://localhost:4324/login",
    ],
  ])("bounds local host recovery: %s %s %s", (mode, url, host, expected) => {
    vi.stubEnv("NODE_ENV", mode);
    expect(authRequestUrl({ url, headers: new Headers({ host }) }).href).toBe(
      expected,
    );
  });

  it("keeps safe local redirect paths", () => {
    expect(normalizeRedirectPath("/timeline?day=today")).toBe(
      "/timeline?day=today",
    );
  });

  it("rejects external redirect targets", () => {
    expect(normalizeRedirectPath("https://example.com")).toBe("/timeline");
    expect(normalizeRedirectPath("//example.com")).toBe("/timeline");
  });

  it.each([
    "/.//example.com",
    "/..//example.com",
    "/a/..//example.com/path",
    "/./\\example.com",
    "/\\example.com",
    "/\t/example.com",
  ])("rejects %j, which parses to another site", (value) => {
    const nextPath = normalizeRedirectPath(value);

    expect(nextPath).toBe("/timeline");
    expect(new URL(nextPath, "https://app.cadence-me.com/login").origin).toBe(
      "https://app.cadence-me.com",
    );
  });

  it("keeps a path with an encoded slash or an inner double slash", () => {
    expect(normalizeRedirectPath("/%2F%2Fexample.com")).toBe(
      "/%2F%2Fexample.com",
    );
    expect(normalizeRedirectPath("/behaviors//x?day=1#a")).toBe(
      "/behaviors//x?day=1#a",
    );
  });

  it("builds login paths with a sanitized next path and optional error", () => {
    expect(buildLoginPath("/behaviors", MISSING_CONFIG_ERROR)).toBe(
      "/login?next=%2Fbehaviors&error=missing_supabase_config",
    );
  });
});
