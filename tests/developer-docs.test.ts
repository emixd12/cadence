import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTEGRATION_OPERATIONS, INTEGRATION_OPERATION_NAMES, validateOperationInput, validateOperationOutput } from "@cadence/core/integration";
import reference from "../apps/marketing/src/data/developer-reference.json";
import { developerPages, developerReleaseNotice } from "../apps/marketing/src/data/developers";
import { marketingRoutes } from "../apps/marketing/src/data/routes";

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { collectRoutes, marketingContracts } from "../scripts/compare-public-routes.mjs";

describe("developer documentation", () => {
  it("covers every tool with fixture-valid examples and current permissions", () => {
    expect(reference.tools.map((page) => page.title)).toEqual(INTEGRATION_OPERATION_NAMES);
    for (const name of INTEGRATION_OPERATION_NAMES) {
      const page = reference.tools.find((entry) => entry.title === name)!;
      const examples = [...page.markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
      expect(examples[0].name).toBe(name);
      expect(validateOperationInput(name, examples[0].arguments).ok).toBe(true);
      expect(validateOperationOutput(name, examples[1]).ok).toBe(true);
      expect(page.markdown).toContain(INTEGRATION_OPERATIONS[name].scope);
      expect(page.markdown).toContain("## Input");
      expect(page.markdown).toContain("## Output");
      expect(Buffer.byteLength(page.markdown)).toBeLessThan(100000);
    }
  });

  it("exposes every guide as canonical HTML and a Markdown mirror without claiming launch", () => {
    expect(developerPages).toHaveLength(29);
    for (const page of developerPages) {
      const route = marketingRoutes.find((entry) => entry.path === `/developers${page.slug ? `/${page.slug}` : ""}`)!;
      expect(route.includeInSitemap && route.includeInLlms && route.includeInMarkdownMirror).toBe(true);
      expect(route.markdownPath).toBe(`${route.path}.md`);
    }
    expect(developerPages[0].markdown).toContain(developerReleaseNotice);
    for (const page of developerPages.filter((entry) => !entry.slug.startsWith("tools/"))) {
      for (const match of page.markdown.matchAll(/```json\n([\s\S]*?)\n```/g)) {
        const call = JSON.parse(match[1]);
        expect(validateOperationInput(call.name, call.arguments).ok).toBe(true);
      }
    }
    const panel = readFileSync("components/settings/ConnectedAppsPanel.tsx", "utf8");
    expect(panel).toContain('href="https://cadence-me.com/developers"');
  });

  it("keeps the enlarged HTML and Markdown route inventory within the bounded Trust collector", async () => {
    const routes = marketingContracts({ schema_version: 1, routes: marketingRoutes.map((route) => ({ url: `https://cadence.example${route.path}`, title: route.title, canonical_url: `https://cadence.example${route.path}`, markdown_url: `https://cadence.example${route.markdownPath}`, include_in_markdown_mirror: true })) });
    expect(routes).toHaveLength(68);
    const result = await collectRoutes({ origin: "https://cadence.example", routes, fetcher: async (url: URL) => {
      const route = routes.find((entry: { path: string }) => entry.path === url.pathname);
      return new Response(`${route.marker}${route.canonical ? `<link rel="canonical" href="${route.canonical}">` : ""}`, { headers: { "content-type": route.content_type } });
    } });
    expect(result.status).toBe("passed");
    await expect(collectRoutes({ origin: "https://cadence.example", routes: Array(97).fill({}), fetcher: () => { throw new Error("Must not fetch"); } })).rejects.toThrow("bounded allowlist");
  });
});
