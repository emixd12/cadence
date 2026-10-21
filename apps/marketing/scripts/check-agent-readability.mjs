#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runnerImport } from "vite";

import { hasMainLandmark } from "./agent-readability-html.mjs";

const root = process.cwd();
const dist = join(root, "dist");
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const failures = [];
const warnings = [];

if (!existsSync(dist)) {
  fail("Marketing dist directory is missing. Run `npm run build` in apps/marketing first.");
} else {
  await checkBuiltOutput();
}

if (failures.length > 0) {
  console.error(`marketing agent-readability check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("marketing agent-readability check passed.");
for (const warning of warnings) console.warn(`warning: ${warning}`);

async function checkBuiltOutput() {
  const requiredFiles = [
    "index.html",
    "faq/index.html",
    "examples/index.html",
    "docs/index.html",
    "about/index.html",
    "index.md",
    "faq.md",
    "examples.md",
    "docs.md",
    "about.md",
    "llms.txt",
    ".well-known/llms.txt",
    "llms-full.txt",
    "sitemap.xml",
    "robots.txt",
    "data/route-manifest.json",
    "examples/cadence-demo.behaviorlog.zip",
  ];

  for (const file of requiredFiles) {
    if (!existsSync(join(dist, file))) {
      fail(`Missing generated marketing file: ${file}`);
    }
  }

  if (failures.length > 0) return;

  const manifest = JSON.parse(read("data/route-manifest.json"));
  assert(Array.isArray(manifest.routes), "Route manifest must contain routes array.");
  const { module: routeSource } = await runnerImport("./apps/marketing/src/data/routes.ts", { root: repositoryRoot, configFile: false });
  assert(manifest.routes.length === routeSource.marketingRoutes.length, "Built route manifest must match the current source.");
  const htmlFiles = manifest.routes.map((route) => new URL(route.url).pathname === "/" ? "index.html" : `${new URL(route.url).pathname.slice(1)}/index.html`);
  const markdownFiles = manifest.routes.filter((route) => route.include_in_markdown_mirror).map((route) => new URL(route.markdown_url).pathname.slice(1));
  for (const file of [...htmlFiles, ...markdownFiles]) assert(existsSync(join(dist, file)), `Missing route artifact: ${file}`);
  if (failures.length) return;

  for (const route of manifest.routes) {
    assert(route.is_public === true, `Route ${route.route_id} must be public.`);
    assert(!route.url.includes("/timeline"), `Protected app path leaked into manifest: ${route.url}`);
    assert(!route.url.includes("/settings"), `Protected app path leaked into manifest: ${route.url}`);
    assert(Boolean(route.canonical_url), `Route ${route.route_id} missing canonical_url.`);
    assert(Boolean(route.markdown_url), `Route ${route.route_id} missing markdown_url.`);
    assert(Boolean(route.description), `Route ${route.route_id} missing description.`);
    assert(Boolean(route.last_modified), `Route ${route.route_id} missing last_modified.`);
  }

  for (const route of manifest.routes.filter((route) => route.include_in_llms)) {
    assert(read("llms.txt").includes(new URL(route.markdown_url).pathname), `llms.txt omits ${route.route_id}`);
  }
  assert(statSync(join(dist, "llms-full.txt")).size <= 100_000, "Full guide text must stay under 100 KB; link separate tool mirrors.");
  const llmsSize = statSync(join(dist, "llms.txt")).size;
  assert(llmsSize > 0, "llms.txt must not be empty.");
  assert(llmsSize < 50_000, "llms.txt must stay under 50 KB.");
  assertSameOriginLlmsLinksExist(read("llms.txt"));

  for (const markdownFile of markdownFiles) {
    const size = statSync(join(dist, markdownFile)).size;
    assert(size <= 100_000, `${markdownFile} must stay at or below 100 KB.`);
    const content = read(markdownFile);
    assert(content.includes("canonical_url:"), `${markdownFile} missing canonical frontmatter.`);
    assert(!containsSecretLikeText(content), `${markdownFile} contains secret-like text.`);
  }

  const robots = read("robots.txt");
  assert(robots.includes("Sitemap:"), "robots.txt must include Sitemap.");
  assert(!/Disallow:\s*\/llms\.txt/i.test(robots), "robots.txt must not block llms.txt.");
  assert(!/Disallow:\s*\/sitemap\.xml/i.test(robots), "robots.txt must not block sitemap.xml.");

  const sitemap = read("sitemap.xml");
  for (const route of manifest.routes) {
    assert(sitemap.includes(`<loc>${route.canonical_url}</loc>`), `sitemap.xml missing ${route.canonical_url}.`);
    assert(sitemap.includes(`<lastmod>${route.last_modified}</lastmod>`), `sitemap.xml missing lastmod for ${route.route_id}.`);
  }

  for (const htmlFile of htmlFiles) {
    const html = read(htmlFile);
    assert(hasMainLandmark(html), `${htmlFile} missing main landmark.`);
    assert(html.includes('rel="canonical"'), `${htmlFile} missing canonical link.`);
    assert(html.includes('rel="alternate" type="text/markdown"'), `${htmlFile} missing markdown alternate.`);
    assert(html.includes('application/ld+json'), `${htmlFile} missing JSON-LD.`);
    assert(countMatches(html, /<h1[\s>]/g) === 1, `${htmlFile} must contain exactly one h1.`);
    assert(!html.includes("gtag("), `${htmlFile} must not include analytics script.`);
    assert(!html.includes("googletagmanager"), `${htmlFile} must not include tag manager.`);
  }

  for (const [htmlFile, markdownFile] of [
    ["index.html", "index.md"],
    ["faq/index.html", "faq.md"],
    ["examples/index.html", "examples.md"],
    ["docs/index.html", "docs.md"],
    ["about/index.html", "about.md"],
  ]) {
    assertPrivacyClaimParity(htmlFile, markdownFile);
  }

  const bundleSize = statSync(join(dist, "examples/cadence-demo.behaviorlog.zip")).size;
  assert(bundleSize > 0, "Example BehaviorLog bundle must not be empty.");
  await assertExampleBundleImports();
}

function assertSameOriginLlmsLinksExist(llms) {
  for (const [, href] of llms.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const url = new URL(href, "https://marketing.invalid");
    if (url.origin !== "https://marketing.invalid") continue;
    const path = decodeURIComponent(url.pathname).replace(/^\//, "");
    const artifact =
      path === "" || path.endsWith("/")
        ? `${path}index.html`
        : path.split("/").at(-1).includes(".")
          ? path
          : `${path}/index.html`;
    assert(existsSync(join(dist, artifact)), `llms.txt link has no generated artifact: ${href}`);
  }
}

async function assertExampleBundleImports() {
  const viteConfig = {
    configFile: false,
    root: repositoryRoot,
    resolve: { alias: { "@": repositoryRoot } },
  };
  const [{ module: importer }, { module: zipService }] = await Promise.all([
    runnerImport("./lib/resolvers/behaviorlog-import.resolver.ts", viteConfig),
    runnerImport("./lib/services/zip.ts", viteConfig),
  ]);
  const zip = readFileSync(join(dist, "examples/cadence-demo.behaviorlog.zip"));
  const preview = importer.resolveBehaviorLogImportPreview({
    files: zipService.readZipEntries(zip),
  });

  assert(preview.valid, "Example BehaviorLog bundle must pass Cadence import preview.");
  assert(preview.errors.length === 0, "Example BehaviorLog bundle must import with zero errors.");
  assert(preview.summary.skipCount === 0, "Example BehaviorLog bundle must import with zero skips.");
  assert(
    preview.plan.behaviors.length === 1 &&
      preview.plan.behaviors.every((record) => record.action === "create"),
    "Example BehaviorLog bundle must create its behavior without skips.",
  );
  assert(
    preview.plan.schedules.length === 1 &&
      preview.plan.schedules.every((record) => record.action === "create"),
    "Example BehaviorLog bundle must create its schedule without skips.",
  );
}

function assertPrivacyClaimParity(htmlFile, markdownFile) {
  const markdown = normalizeText(read(markdownFile));
  const claims = [...read(htmlFile).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeText(stripHtml(match[1])))
    .filter((claim) =>
      /(privacy|cookies?|analytics|tracking|real account|reminder-provider|Supabase Auth|Row Level Security)/i.test(
        claim,
      ),
    );

  for (const claim of claims) {
    assert(markdown.includes(claim), `${markdownFile} is missing HTML data-handling claim: ${claim}`);
  }
}

function read(relativePath) {
  return readFileSync(join(dist, relativePath), "utf8");
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

function containsSecretLikeText(value) {
  return /(sk-[a-z0-9_-]{20,}|service_role|private[_-]?key\s*=|password\s*=|api[_-]?key\s*=)/i.test(value);
}

function stripHtml(value) {
  let text = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<") insideTag = true;
    else if (character === ">") {
      insideTag = false;
      text += " ";
    } else if (!insideTag) text += character;
  }
  return text;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  failures.push(message);
}
