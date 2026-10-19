import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each([401, 403, 404, 429, 500, 503])("reports only HTTP %s when Preview access fails", async (status) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-input-"));
  const output = path.join(directory, "input.json");
  const preload = `
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (calls <= 2) return new Response(JSON.stringify({
        projectId: calls === 1 ? "app-project" : "marketing-project",
        url: calls === 1 ? "app.example.com" : "marketing.example.com"
      }));
      if (calls !== 3 || options.method !== "PATCH" || options.body !== JSON.stringify({ttl: 3600}))
        throw new Error("unexpected-request");
      const response = new Response("private-response-body", {status: ${status}, headers: {"x-private": "private-header"}});
      Object.defineProperty(response, "headers", {get() { throw new Error("private-header-read"); }});
      response.json = response.text = async () => { throw new Error("private-body-read"); };
      return response;
    };
  `;
  try {
    const result = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
      "scripts/prepare-public-trust-input.mjs", "--output", output,
    ], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        NODE_ENV: "test",
        TRUST_SOURCE_COMMIT: "a".repeat(40), TRUST_TARGET: "preview",
        TRUST_APPLICATION_DEPLOYMENT_ID: "app-deployment",
        TRUST_APPLICATION_DEPLOYMENT_URL: "https://app.example.com",
        TRUST_MARKETING_DEPLOYMENT_ID: "marketing-deployment",
        TRUST_MARKETING_DEPLOYMENT_URL: "https://marketing.example.com",
        VERCEL_APPLICATION_PROJECT_ID: "app-project",
        VERCEL_MARKETING_PROJECT_ID: "marketing-project",
        VERCEL_TOKEN: "private-test-token",
        TRUST_PAGES_ORIGIN: "https://example.github.io/cadence/",
        GITHUB_REPOSITORY: "example/cadence", GITHUB_RUN_ID: "123",
        GITHUB_SERVER_URL: "https://github.com",
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`Unable to create a temporary Preview access boundary (HTTP ${status}).\n`);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
