import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each(["application", "marketing"].flatMap((operation) =>
  [401, 403, 404, 409, 429, 500, 503].map((status) => ({ operation, status })),
))("reports only $operation HTTP $status when Preview access fails", async ({ operation, status }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-input-"));
  const output = path.join(directory, "input.json");
  const trace = path.join(directory, "requests.json");
  const preload = `
    import { writeFileSync } from "node:fs";
    if (process.versions.node.split(".")[0] !== "24") throw new Error("Node 24 required");
    const requests = [];
    process.on("exit", () => writeFileSync(${JSON.stringify(trace)}, JSON.stringify(requests)));
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      requests.push({ url, method: options.method ?? "GET", body: options.body });
      if (calls <= 2) return new Response(JSON.stringify({
        projectId: calls === 1 ? "app-project" : "marketing-project",
        url: calls === 1 ? "app.example.com" : "marketing.example.com"
      }));
      if (calls > ${operation === "application" ? 3 : 4} || options.method !== "PATCH" || options.body !== JSON.stringify({ttl: 3600}))
        throw new Error("unexpected-request");
      if (calls === 3 && ${operation === "marketing"})
        return new Response(JSON.stringify({ protectionBypass: { "private-first-share": {} } }));
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
    expect(result.stderr).toBe(`Unable to create a temporary Preview access boundary for ${operation} (HTTP ${status}).\n`);
    const requests = JSON.parse(await readFile(trace, "utf8"));
    expect(requests).toEqual([
      { url: "https://api.vercel.com/v13/deployments/app-deployment", method: "GET" },
      { url: "https://api.vercel.com/v13/deployments/marketing-deployment", method: "GET" },
      { url: "https://api.vercel.com/aliases/app-deployment/protection-bypass", method: "PATCH", body: JSON.stringify({ ttl: 3600 }) },
      ...(operation === "marketing" ? [{ url: "https://api.vercel.com/aliases/marketing-deployment/protection-bypass", method: "PATCH", body: JSON.stringify({ ttl: 3600 }) }] : []),
    ]);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
