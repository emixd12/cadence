// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { describe, expect, it } from "vitest";
import { INTEGRATION_OPERATIONS, INTEGRATION_OPERATION_NAMES, validateOperationInput, validateOperationOutput } from "@cadence/core/integration";
import reference from "../apps/marketing/src/data/developer-reference.json";
import { developerPages, developerReleaseNotice } from "../apps/marketing/src/data/developers";
import { marketingRoutes } from "../apps/marketing/src/data/routes";
// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { table } from "../apps/marketing/scripts/developer-reference.mjs";

async function rendered(markdown: string) {
  const renderer = await createSatteriMarkdownProcessor({ syntaxHighlight: false });
  const container = document.createElement("div");
  container.innerHTML = (await renderer.render(markdown)).code;
  return container;
}

function row(container: HTMLElement, path: string) {
  return [...container.querySelectorAll("tbody tr")].find((element) => element.querySelector("td")?.textContent === path);
}

// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { collectRoutes, marketingContracts } from "../scripts/compare-public-routes.mjs";

describe("developer documentation", () => {
  it("renders schema regex, enum and const values literally", async () => {
    const value = "^(?=.*\\S)[a|`b`\\\\]*$";
    const container = await rendered(table({ properties: { value: { type: "string", pattern: value, enum: [value], const: value } } }));
    expect([...row(container, "value")!.querySelectorAll("td:last-child code")].map((code) => code.textContent)).toEqual([value, value, value]);
    expect(container.querySelector("em")).toBeNull();
    const page = reference.tools.find((entry) => entry.title === "create_behavior")!;
    const actual = await rendered(page.markdown);
    const schema = INTEGRATION_OPERATIONS.create_behavior.input.schema.properties as Record<string, { pattern: string }>;
    expect([...row(actual, "title")!.querySelectorAll("code")].map((code) => code.textContent)).toContain(schema.title.pattern);
  });

  it("renders nullable object and array children with their containing-object requirements", async () => {
    const timeline = await rendered(reference.tools.find((entry) => entry.title === "get_timeline")!.markdown);
    expect(row(timeline, "needs_decision")?.children[2].textContent).toBe("object or null");
    for (const path of ["occurrences", "total_count", "truncated", "lookback_start_local_date", "occurrences[].id"]) {
      expect(row(timeline, `needs_decision.${path}`)?.children[1].textContent).toBe("yes");
    }
    for (const [name, prefix] of [["list_behaviors", "behaviors[]"], ["get_behavior", "behavior"], ["create_behavior", "behavior"], ["update_behavior", "behavior"], ["archive_behavior", "behavior"], ["restore_behavior", "behavior"]]) {
      const container = await rendered(reference.tools.find((entry) => entry.title === name)!.markdown);
      for (const field of ["id", "name"]) expect(row(container, `${prefix}.category.${field}`)?.children[1].textContent).toBe("yes");
    }
    const nullableArray = await rendered(table({ properties: { records: { anyOf: [{ type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }, { type: "null" }] } } }));
    expect(row(nullableArray, "records")?.children[2].textContent).toBe("array or null");
    expect(row(nullableArray, "records[].id")?.children[1].textContent).toBe("yes");
    expect((await rendered(table(INTEGRATION_OPERATIONS.update_behavior.input.schema))).textContent).toContain("Provide at least one of:");
  });
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
