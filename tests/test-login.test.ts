import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/auth/test-login/route";
import {
  createTestLoginCredentials,
  resetTestLoginCreationQuotaForTests,
  resolveTestLoginGate,
  shouldShowTestLogin,
  TEST_LOGIN_CREATION_QUOTA,
} from "../lib/auth/test-login";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("test login guards", () => {
  afterEach(() => {
    resetTestLoginCreationQuotaForTests();
    vi.unstubAllEnvs();
  });

  it("only shows the login affordance when explicitly enabled outside production", () => {
    expect(shouldShowTestLogin({ CADENCE_ENABLE_TEST_LOGIN: "1" })).toBe(true);
    expect(
      shouldShowTestLogin({
        CADENCE_ENABLE_TEST_LOGIN: "1",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(shouldShowTestLogin({ CADENCE_ENABLE_TEST_LOGIN: "0" })).toBe(false);
  });

  it("allows localhost requests against local Supabase", () => {
    const gate = resolveTestLoginGate(
      new URL("http://localhost:3000/auth/test-login?next=%2Fsettings"),
      {
        CADENCE_ENABLE_TEST_LOGIN: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      },
    );

    expect(gate).toEqual({ allowed: true, nextPath: "/settings" });
  });

  it("blocks hosted Supabase unless explicitly allowlisted", () => {
    const requestUrl = new URL("http://localhost:3000/auth/test-login");

    expect(
      resolveTestLoginGate(requestUrl, {
        CADENCE_ENABLE_TEST_LOGIN: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toEqual({
      allowed: false,
      reason: "hosted_supabase_not_allowed",
      nextPath: "/timeline",
    });

    expect(
      resolveTestLoginGate(requestUrl, {
        CADENCE_ENABLE_TEST_LOGIN: "1",
        CADENCE_ALLOW_HOSTED_TEST_LOGIN: "1",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toEqual({ allowed: true, nextPath: "/timeline" });
  });

  it("builds deterministic temporary credentials for tests", () => {
    expect(createTestLoginCredentials("abc_123")).toEqual({
      email: "cadence-test-abc123@example.invalid",
      password: "CadenceTestLogin-abc123-aA1!",
    });
  });
});

describe("test login route", () => {
  afterEach(() => {
    resetTestLoginCreationQuotaForTests();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("redirects to login without touching Supabase when disabled", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/test-login?next=%2Fsettings"),
    );

    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fsettings&error=test_login_unavailable",
    );
  });

  it("creates a temporary confirmed user and signs in normally", async () => {
    stubEnabledLocalSupabaseEnv();
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "temporary-user-id" } },
      error: null,
    });
    const deleteUser = vi.fn();
    const generateLink = linkFor();
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser, generateLink } },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/auth/test-login?next=https%3A%2F%2Fevil.example",
      ),
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringMatching(/^cadence-test-.+@example\.invalid$/),
        password: expect.stringMatching(/^CadenceTestLogin-.+-aA1!$/),
        email_confirm: true,
        user_metadata: { name: "Cadence Test Login" },
      }),
    );
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: expect.stringMatching(/^cadence-test-.+@example\.invalid$/),
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "hashed-token",
      type: "email",
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/timeline",
    );
  });

  it("deletes the temporary user when sign-in fails", async () => {
    stubEnabledLocalSupabaseEnv();
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "temporary-user-id" } },
      error: null,
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const generateLink = linkFor();
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ error: new Error("bad token") });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser, generateLink } },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await GET(
      new NextRequest("http://localhost:3000/auth/test-login?next=%2Fbehaviors"),
    );

    expect(deleteUser).toHaveBeenCalledWith("temporary-user-id");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fbehaviors&error=test_login_failed",
    );
  });

  it("releases quota after create failure so a later creation can succeed", async () => {
    stubEnabledLocalSupabaseEnv();
    const createUser = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: new Error("create failed") })
      .mockResolvedValue({
        data: { user: { id: "temporary-user-id" } },
        error: null,
      });
    const deleteUser = vi.fn();
    const generateLink = linkFor();
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser, generateLink } },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const failed = await GET(
      new NextRequest("http://localhost:3000/auth/test-login"),
    );
    const succeeded = await GET(
      new NextRequest("http://localhost:3000/auth/test-login"),
    );

    expect(failed.headers.get("location")).toContain("error=test_login_failed");
    expect(succeeded.headers.get("location")).toBe(
      "http://localhost:3000/timeline",
    );
  });

  it("stops creating users after the per-process quota is consumed", async () => {
    stubEnabledLocalSupabaseEnv();
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "temporary-user-id" } },
      error: null,
    });
    const deleteUser = vi.fn();
    const generateLink = linkFor();
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { createUser, deleteUser, generateLink } },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    for (let index = 0; index < TEST_LOGIN_CREATION_QUOTA; index += 1) {
      const response = await GET(
        new NextRequest("http://localhost:3000/auth/test-login"),
      );
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/timeline",
      );
    }

    const limited = await GET(
      new NextRequest("http://localhost:3000/auth/test-login?next=%2Fsettings"),
    );

    expect(createUser).toHaveBeenCalledTimes(TEST_LOGIN_CREATION_QUOTA);
    expect(limited.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fsettings&error=test_login_quota_reached",
    );
  });
});

function linkFor() {
  return vi.fn().mockResolvedValue({
    data: { properties: { hashed_token: "hashed-token" } },
    error: null,
  });
}

function stubEnabledLocalSupabaseEnv() {
  vi.stubEnv("CADENCE_ENABLE_TEST_LOGIN", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
}
