import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { githubFacts } from "../scripts/collect-public-trust-evidence.mjs";

const input = { repository: "owner/repo", source_commit: "a".repeat(40) };
const privateMarker = "synthetic-private-alert-payload";

function json(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers });
}

function alerts(count: number, first = 1) {
  return Array.from({ length: count }, (_, index) => ({ number: first + index, secret: privateMarker }));
}

function githubFetcher(readAlerts: (url: URL) => Response | Promise<Response>) {
  return vi.fn(async (url: URL, init: RequestInit) => {
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-token");
    if (url.pathname === "/repos/owner/repo/") return json({
      id: 123,
      security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } },
    });
    if (url.pathname.endsWith("/check-runs")) return json({ check_runs: [{ name: "CodeQL", status: "completed", conclusion: "success" }] });
    expect(url.searchParams.get("state")).toBe("open");
    expect(url.searchParams.get("per_page")).toBe("100");
    if (url.pathname.endsWith("/secret-scanning/alerts")) expect(url.searchParams.get("hide_secret")).toBe("true");
    return readAlerts(url);
  });
}

function nextUrl(url: URL) {
  const next = new URL(url);
  next.searchParams.set("after", "next-cursor");
  return next;
}

function silenceConsole() {
  return ["log", "warn", "error"].map((method) => vi.spyOn(console, method as "log" | "warn" | "error").mockImplementation(() => {}));
}

afterEach(() => vi.restoreAllMocks());

describe("GitHub Trust aggregate counts", () => {
  it.each([0, 3, 100])("reports complete counts of %i without exposing alert payloads", async (count) => {
    const logs = silenceConsole();
    const fetcher = githubFetcher(() => json(alerts(count)));
    const result = await githubFacts(input, { fetcher, token: "synthetic-token" });
    expect(result).toEqual({
      code_scanning: { open: count, analysis_complete: true },
      dependabot: { open: count },
      secret_scanning: { open: count, enabled: true, push_protection: true },
    });
    expect(JSON.stringify(result)).not.toContain(privateMarker);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it.each(["named", "numeric"])("follows complete cursor pagination through the verified %s repository path", async (path) => {
    const fetcher = githubFetcher((url) => {
      if (url.searchParams.has("after")) return json(alerts(3, 101), { link: `<${url}>; rel="prev"` });
      const next = nextUrl(url);
      if (path === "numeric") next.pathname = next.pathname.replace("/repos/owner/repo/", "/repositories/123/");
      return json(alerts(100), { link: `<${next}>; rel="last", <${next}>; rel="next"` });
    });
    const result = await githubFacts(input, { fetcher, token: "synthetic-token" });
    expect(result.code_scanning.open).toBe(103);
    expect(result.dependabot.open).toBe(103);
    expect(result.secret_scanning.open).toBe(103);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it.each(["denied", "server", "json", "network", "shape", "invalid-alert", "duplicate-alert", "bytes", "oversized-page", "redirect"])("withholds partial counts after a subsequent-page %s failure", async (failure) => {
    const logs = silenceConsole();
    const fetcher = githubFetcher((url) => {
      if (!url.pathname.endsWith("/dependabot/alerts")) return json([]);
      if (!url.searchParams.has("after")) return json(alerts(2), { link: `<${nextUrl(url)}>; rel="next"` });
      if (failure === "denied") return new Response(privateMarker, { status: 403 });
      if (failure === "server") return new Response(privateMarker, { status: 503 });
      if (failure === "json") return new Response(privateMarker, { status: 200 });
      if (failure === "network") throw new Error(privateMarker);
      if (failure === "shape") return json({ message: privateMarker });
      if (failure === "invalid-alert") return json([{ secret: privateMarker }]);
      if (failure === "duplicate-alert") return json(alerts(1));
      if (failure === "bytes") return json(alerts(1, 3), { "content-length": "2000001" });
      if (failure === "oversized-page") return json(alerts(101, 3));
      return new Response(null, { status: 302, headers: { location: "https://outside.example/private" } });
    });
    const result = await githubFacts(input, { fetcher, token: "synthetic-token" });
    expect(result.dependabot).toBeNull();
    expect(result.code_scanning.open).toBe(0);
    expect(result.secret_scanning.open).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(result)).not.toContain(privateMarker);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it.each([false, true])("only reports the count at the ten-page bound when pagination is complete (has more: %s)", async (hasMore) => {
    let pages = 0;
    const fetcher = githubFetcher((url) => {
      if (!url.pathname.endsWith("/dependabot/alerts")) return json([]);
      pages += 1;
      const next = new URL(url);
      next.searchParams.set("after", `cursor-${pages}`);
      return json(alerts(100, (pages - 1) * 100 + 1), pages < 10 || hasMore ? { link: `<${next}>; rel="next"` } : {});
    });
    expect((await githubFacts(input, { fetcher, token: "synthetic-token" })).dependabot).toEqual(hasMore ? null : { open: 1000 });
    expect(pages).toBe(10);
  });

  it.each(["origin", "repository", "endpoint", "filter", "extra-filter", "duplicate-query", "credentials", "fragment", "malformed-link", "duplicate-next"])("rejects an unsafe or ambiguous pagination %s before another authenticated request", async (failure) => {
    const fetcher = githubFetcher((url) => {
      if (!url.pathname.endsWith("/dependabot/alerts")) return json([]);
      const next = nextUrl(url);
      if (failure === "origin") next.hostname = "outside.example";
      if (failure === "repository") next.pathname = "/repositories/999/dependabot/alerts";
      if (failure === "endpoint") next.pathname = "/repos/owner/repo/secret-scanning/alerts";
      if (failure === "filter") next.searchParams.set("state", "closed");
      if (failure === "extra-filter") next.searchParams.set("severity", "critical");
      if (failure === "duplicate-query") next.searchParams.append("state", "open");
      if (failure === "credentials") next.username = "synthetic";
      if (failure === "fragment") next.hash = "synthetic";
      const link = failure === "malformed-link" ? "malformed; rel=next" : failure === "duplicate-next" ? `<${next}>; rel="next", <${next}>; rel="next"` : `<${next}>; rel="next"`;
      return json(alerts(1), { link });
    });
    expect((await githubFacts(input, { fetcher, token: "synthetic-token" })).dependabot).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("never follows a secret-scanning continuation that removes secret redaction", async () => {
    const fetcher = githubFetcher((url) => {
      if (!url.pathname.endsWith("/secret-scanning/alerts")) return json([]);
      const next = nextUrl(url);
      next.searchParams.delete("hide_secret");
      return json(alerts(1), { link: `<${next}>; rel="next"` });
    });
    expect((await githubFacts(input, { fetcher, token: "synthetic-token" })).secret_scanning).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("leaves secret scanning unavailable when repository security settings cannot be read", async () => {
    const read = githubFetcher(() => json([]));
    const fetcher = (url: URL, init: RequestInit) => url.pathname === "/repos/owner/repo/" ? new Response(null, { status: 403 }) : read(url, init);
    const result = await githubFacts(input, { fetcher, token: "synthetic-token" });
    expect(result.secret_scanning).toBeNull();
    expect(result.dependabot.open).toBe(0);
    expect(result.code_scanning.open).toBe(0);
  });
});
