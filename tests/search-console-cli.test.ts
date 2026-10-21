import { expect, it, vi } from "vitest";
// @ts-expect-error The operational CLI is a plain Node ESM module.
import { buildRequest, runRequest } from "../scripts/search-console.mjs";

it("routes read queries and explicit sitemap writes through scoped Google endpoints", async () => {
  const getToken = vi.fn(() => "synthetic-token");
  const fetchResponse = vi.fn(async () => new Response('{"permissionLevel":"siteFullUser"}'));
  const read = buildRequest(["inspect", "--url", "http://cadence-me.com/"]);
  expect(read.body).toEqual({ inspectionUrl: "http://cadence-me.com/", siteUrl: "sc-domain:cadence-me.com", languageCode: "en-US" });
  await runRequest(read, { getToken, fetchResponse });
  expect(getToken).toHaveBeenLastCalledWith("https://www.googleapis.com/auth/webmasters.readonly");
  expect(fetchResponse).toHaveBeenCalledWith(read.url, expect.objectContaining({ method: "POST", redirect: "error" }));

  for (const [command, method] of [["submit-sitemap", "PUT"], ["delete-sitemap", "DELETE"]]) {
    const write = buildRequest([command, "--sitemap", "https://cadence-me.com/sitemap.xml"]);
    expect(write).toMatchObject({ method, write: true });
    expect(write.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Acadence-me.com/sitemaps/https%3A%2F%2Fcadence-me.com%2Fsitemap.xml");
    expect(await runRequest(write, { getToken, fetchResponse: async () => new Response(null, { status: 204 }) })).toEqual({ ok: true, status: 204 });
    expect(getToken).toHaveBeenLastCalledWith("https://www.googleapis.com/auth/webmasters");
  }
  expect(buildRequest(["query", "--start", "2026-10-01", "--end", "2026-10-07", "--dimensions", "page,query"]).body)
    .toEqual({ startDate: "2026-10-01", endDate: "2026-10-07", dimensions: ["page", "query"], rowLimit: 1000 });
  expect(buildRequest(["verify"]).url).toContain("/sites/sc-domain%3Acadence-me.com");
  expect(buildRequest(["sitemaps"]).url).toContain("/sitemaps");
  expect(buildRequest(["--help"])).toBeNull();
});

it("rejects wrong domains, accidental writes, invalid queries, and unsafe response handling", async () => {
  for (const args of [
    ["inspect", "--url", "https://cadence-me.com.evil.test/"],
    ["inspect", "--url", "https://evil.test/cadence-me.com"],
    ["inspect", "--url", "https://user:password@cadence-me.com/"],
    ["inspect", "--url", "file:///tmp/test"],
    ["submit-sitemap"], ["delete-sitemap", "--sitemap", "http://cadence-me.com/sitemap.xml"],
    ["verify", "--sitemap", "https://cadence-me.com/sitemap.xml"],
    ["query", "--start", "2026-02-30", "--end", "2026-10-07"],
    ["query", "--start", "2026-10-08", "--end", "2026-10-07"],
    ["query", "--start", "2026-10-01", "--end", "2026-10-07", "--limit", "25001"],
    ["query", "--start", "2026-10-01", "--end", "2026-10-07", "--dimensions", "date,date"],
    ["unknown"], ["verify", "sitemaps"],
  ]) expect(() => buildRequest(args)).toThrow();
  await expect(runRequest(buildRequest(["verify"]), {
    getToken: () => "synthetic-token",
    fetchResponse: async () => new Response("sensitive provider diagnostics", { status: 403 }),
  })).rejects.toThrow("Search Console HTTP 403. Check property access");
});
