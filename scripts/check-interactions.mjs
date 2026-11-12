import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const arguments_ = process.argv.slice(2);
const desktopRelease = arguments_.includes("--desktop-release");
const registryArgument = arguments_.indexOf("--registry");
const registryPath = registryArgument === -1
  ? "interaction-registry.json"
  : path.relative(root, path.resolve(arguments_[registryArgument + 1] ?? ""));
const schemaPath = "interaction-registry.schema.json";
const journeyPath = "docs/UX_JOURNEY_INVENTORY.md";
const userGuideDirectory = "docs/user-guide";
const internalQaInteractionIds = new Set(["INT-AUTH-002", "INT-SHELL-007", "INT-SETTINGS-019", "INT-SETTINGS-020", "INT-SETTINGS-021"]);
const failures = [];
const mechanicallyCheckedEntries = [];
const humanReviewEntries = [];
const platforms = ["web", "desktop", "marketing", "mobile"];

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--registry" && arguments_[index + 1]) {
    index += 1;
  } else if (argument !== "--desktop-release") {
    failures.push(`Unknown or incomplete argument: ${argument}.`);
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(absolute(relativePath));
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    failures.push(
      `${relativePath} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function splitReference(reference) {
  const separatorIndex = reference.indexOf("#");
  if (separatorIndex === -1) {
    return { file: reference, symbol: "" };
  }

  return {
    file: reference.slice(0, separatorIndex),
    symbol: reference.slice(separatorIndex + 1),
  };
}

function handlerSource(content, symbol) {
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${escapedSymbol}\\b`,
  );
  const start = content.search(declaration);

  if (start === -1) return "";

  const remaining = content.slice(start + symbol.length);
  const nextDeclaration = remaining.search(
    /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\b/,
  );

  return nextDeclaration === -1
    ? content.slice(start)
    : content.slice(start, start + symbol.length + nextDeclaration);
}

function inspectEffectChecks(interaction, sourceReader = read) {
  const issues = [];
  const checkedEffects = new Set();
  const checks = Array.isArray(interaction.effect_checks)
    ? interaction.effect_checks
    : [];

  for (const check of checks) {
    const effect = check?.effect;
    const handler = check?.handler;
    const evidence = check?.evidence;
    const { file, symbol } = splitReference(
      typeof handler === "string" ? handler : "",
    );

    if (!interaction.effects?.includes(effect)) {
      issues.push(`${interaction.id} effect check references undeclared effect ${String(effect)}.`);
      continue;
    }
    if (!interaction.implementation?.includes(handler)) {
      issues.push(`${interaction.id} effect check handler is not an implementation reference: ${String(handler)}.`);
      continue;
    }
    if (!symbol) {
      issues.push(`${interaction.id} effect check must name a handler symbol: ${String(handler)}.`);
      continue;
    }
    if (!isNonEmptyStringArray(evidence)) {
      issues.push(`${interaction.id} effect check for ${effect} needs unique evidence strings.`);
      continue;
    }

    const namedHandlerSource = handlerSource(sourceReader(file), symbol);
    if (!namedHandlerSource) {
      issues.push(`${interaction.id} effect check cannot resolve handler ${handler}.`);
      continue;
    }

    const missingEvidence = evidence.filter(
      (snippet) => !namedHandlerSource.includes(snippet),
    );
    if (missingEvidence.length > 0) {
      issues.push(
        `${interaction.id} recorded ${effect} side effect no longer matches ${handler}; missing evidence: ${missingEvidence.join(
          ", ",
        )}.`,
      );
      continue;
    }

    checkedEffects.add(effect);
  }

  return {
    issues,
    uncheckedEffects: (interaction.effects ?? []).filter(
      (effect) => !checkedEffects.has(effect),
    ),
  };
}

function isAutomatedTestReference(relativePath) {
  return /^tests\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

function isRepositoryCheckReference(relativePath) {
  return /^(?:scripts|apps\/[^/]+\/scripts)\/check-[^/]+\.[cm]?[jt]s$/.test(
    relativePath,
  );
}

function isCoverageEvidenceReference(relativePath) {
  return (
    isAutomatedTestReference(relativePath) ||
    isRepositoryCheckReference(relativePath)
  );
}

function githubHeadingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownHeadingAnchors(relativePath) {
  const anchors = new Set();
  const slugCounts = new Map();

  for (const match of read(relativePath).matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
    const heading = match[1].replace(/[ \t]+#+[ \t]*$/, "").trim();
    const baseSlug = githubHeadingSlug(heading);
    const duplicateCount = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, duplicateCount + 1);
    anchors.add(duplicateCount === 0 ? baseSlug : `${baseSlug}-${duplicateCount}`);
  }

  return anchors;
}

function inspectPlatformRecords(interaction) {
  const records = interaction.platforms;
  assert(
    records && typeof records === "object" && !Array.isArray(records),
    `${interaction.id} needs platform applicability and implementation status.`,
  );
  if (!records || typeof records !== "object" || Array.isArray(records)) return;
  assert(
    Object.keys(records).length === platforms.length &&
      Object.keys(records).every((platform) => platforms.includes(platform)),
    `${interaction.id} platforms must contain web, desktop, marketing, and mobile.`,
  );

  for (const platform of platforms) {
    const record = records[platform];
    const label = `${interaction.id} ${platform}`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      failures.push(`${label} needs a platform record.`);
      continue;
    }
    assert(
      ["applicable", "not_applicable", "deferred"].includes(record.applicability),
      `${label} has invalid applicability.`,
    );
    if (record.applicability === "applicable") {
      assert(
        ["implemented", "planned"].includes(record.status),
        `${label} applicable status must be implemented or planned.`,
      );
    } else {
      assert(record.status === record.applicability, `${label} status must match its applicability.`);
      assert(isNonEmptyString(record.reason), `${label} needs an explicit applicability reason.`);
    }
    if (record.status === "implemented") {
      assert(isNonEmptyStringArray(record.implementation), `${label} needs implementation references.`);
      assert(Array.isArray(record.evidence), `${label} needs an evidence array.`);
      if (platform === "desktop") {
        assert(Array.isArray(record.implementation) && record.implementation.some((reference) =>
          isNonEmptyString(reference) && reference.startsWith("apps/desktop/")),
          `${label} needs a desktop implementation reference; shared or web code alone does not prove desktop usage.`);
        assert(Array.isArray(record.implementation) && record.implementation.some((reference) => {
          if (!isNonEmptyString(reference)) return false;
          const { file } = splitReference(reference);
          return file.startsWith("apps/desktop/") && sourceInventory.some((source) =>
            source.path === file && source.classification === "cataloged" &&
            source.interaction_ids?.includes(interaction.id));
        }), `${label} needs a cataloged desktop source linked to this interaction; a developer bench cannot establish parity.`);
      }
    } else {
      assert(record.implementation === undefined && record.evidence === undefined,
        `${label} must not claim implementation or evidence before implementation.`);
    }
    if (record.status === "planned") {
      assert(isNonEmptyString(record.follow_up), `${label} needs a follow-up ticket reference.`);
    }
    const references = [
      ...(Array.isArray(record.implementation) ? record.implementation : []),
      ...(Array.isArray(record.evidence) ? record.evidence : []),
      ...(isNonEmptyString(record.follow_up) ? [record.follow_up] : []),
    ];
    for (const reference of references) {
      if (!isNonEmptyString(reference)) {
        failures.push(`${label} has an invalid reference.`);
        continue;
      }
      const { file, symbol } = splitReference(reference);
      const safePath = !path.isAbsolute(file) && !file.split("/").includes("..");
      assert(safePath, `${label} references must stay repository-relative.`);
      if (!safePath) continue;
      assert(exists(file), `${label} reference does not exist: ${file}.`);
      if (exists(file) && symbol) {
        assert(
          file.endsWith(".md") ? markdownHeadingAnchors(file).has(symbol) : read(file).includes(symbol),
          `${label} reference does not resolve: ${reference}.`,
        );
      }
      if (reference === record.follow_up) {
        assert(file === "docs/TICKETS.md" && /^ticket-\d{3}\b/.test(symbol), `${label} follow-up must reference an existing ticket heading.`);
      }
      if (Array.isArray(record.implementation) && record.implementation.includes(reference)) {
        assert(/\.(?:[cm]?[jt]sx?|astro|rs|swift|m)$/.test(file), `${label} implementation must reference source code: ${file}.`);
      }
      if (Array.isArray(record.evidence) && record.evidence.includes(reference)) {
        assert(
          isCoverageEvidenceReference(file) || /^docs\/qa\/.+\.md$/.test(file),
          `${label} evidence must reference tests, checks, or recorded QA: ${file}.`,
        );
      }
    }
    if (desktopRelease && platform === "desktop" && record.applicability === "applicable") {
      assert(record.status === "implemented", `${label} is incomplete for desktop release (${record.status}).`);
      if (record.status === "implemented") {
        assert(isNonEmptyStringArray(record.evidence), `${label} needs verification evidence for desktop release.`);
        assert(Array.isArray(record.evidence) && record.evidence.some((reference) => {
          if (!isNonEmptyString(reference)) return false;
          const { file } = splitReference(reference);
          return isAutomatedTestReference(file) || /^docs\/qa\/.+\.md$/.test(file);
        }), `${label} needs test or recorded QA evidence; structural checks alone do not prove desktop parity.`);
      }
    }
  }
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(absolute(directory), {
    withFileTypes: true,
  })) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
      continue;
    }

    files.push(relativePath);
  }
  return files;
}

function interactiveSourceFiles() {
  const roots = ["app", "components", "apps/marketing/src", "public"];
  if (exists("apps/desktop/src")) roots.push("apps/desktop/src");

  return roots
    .flatMap(walk)
    .filter((file) => /\.(?:tsx|astro|js)$/.test(file))
    .filter((file) => interactionMarkerCount(read(file)) > 0)
    .sort();
}

function interactionMarkerCount(content) {
  return (
    content.match(
      /<(?:Link|a|button|form|input|select|textarea|summary)\b|\bon(?:Click|Submit|Change|KeyDown|MouseDown|PointerDown|TouchStart|TouchMove|TouchEnd|Toggle)=|\bself\.addEventListener\(\s*["']notificationclick["']/g,
    ) ?? []
  ).length;
}

assert(exists(registryPath), `Missing ${registryPath}.`);
assert(exists(schemaPath), `Missing ${schemaPath}.`);
assert(exists(journeyPath), `Missing ${journeyPath}.`);

const registry = exists(registryPath) ? readJson(registryPath) : null;
const schema = exists(schemaPath) ? readJson(schemaPath) : null;

if (!registry || !schema) {
  console.error(`interactions:check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

assert(
  registry.$schema === "./interaction-registry.schema.json",
  `${registryPath} must reference ./interaction-registry.schema.json.`,
);
assert(
  registry.schema_version === "1.3.0" && schema.properties.schema_version.const === "1.3.0",
  `${registryPath} and schema schema_version must be 1.3.0.`,
);
assert(
  registry.registry_id === "cadence.user-interactions",
  `${registryPath} registry_id must be cadence.user-interactions.`,
);
assert(registry.product === "Cadence", `${registryPath} product must be Cadence.`);
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(registry.updated ?? ""),
  `${registryPath} updated must use YYYY-MM-DD.`,
);
assert(
  isNonEmptyString(registry.scope?.unit),
  `${registryPath} scope.unit must define the catalog granularity.`,
);
assert(
  isNonEmptyStringArray(registry.scope?.includes),
  `${registryPath} scope.includes must be a unique non-empty string array.`,
);
assert(
  isNonEmptyStringArray(registry.scope?.excludes),
  `${registryPath} scope.excludes must be a unique non-empty string array.`,
);
assert(Array.isArray(registry.surfaces), `${registryPath} surfaces must be an array.`);
assert(
  Array.isArray(registry.source_inventory),
  `${registryPath} source_inventory must be an array.`,
);
assert(
  Array.isArray(registry.interactions),
  `${registryPath} interactions must be an array.`,
);

const surfaces = Array.isArray(registry.surfaces) ? registry.surfaces : [];
const sourceInventory = Array.isArray(registry.source_inventory)
  ? registry.source_inventory
  : [];
const interactions = Array.isArray(registry.interactions)
  ? registry.interactions
  : [];
const surfaceIds = new Set();
const interactionIds = new Set();
const sourcePaths = new Set();
const allowedSurfaceKinds = new Set([
  "public",
  "authenticated",
  "conditional_development",
]);
const allowedStatuses = new Set(["implemented", "planned", "deferred"]);
const allowedTriggerKinds = new Set([
  "activate",
  "change",
  "input",
  "submit",
  "upload",
  "keyboard",
  "gesture",
]);
const allowedRisks = new Set(["low", "moderate", "high", "destructive"]);
const allowedConfirmations = new Set([
  "none",
  "browser_prompt",
  "acknowledgement",
  "typed",
  "acknowledgement_and_typed",
]);
const allowedCoverageLevels = new Set(["direct", "indirect", "manual", "none"]);

for (const surface of surfaces) {
  assert(
    /^[a-z][a-z0-9_]*$/.test(surface.id ?? ""),
    `Surface id ${String(surface.id)} is invalid.`,
  );
  assert(!surfaceIds.has(surface.id), `Duplicate surface id: ${surface.id}.`);
  surfaceIds.add(surface.id);
  assert(isNonEmptyString(surface.label), `Surface ${surface.id} needs a label.`);
  assert(
    allowedSurfaceKinds.has(surface.kind),
    `Surface ${surface.id} has invalid kind ${String(surface.kind)}.`,
  );
  assert(
    isNonEmptyStringArray(surface.routes),
    `Surface ${surface.id} needs unique routes.`,
  );
}

for (const interaction of interactions) {
  const label = interaction.id ?? "<missing id>";
  assert(
    /^INT-[A-Z]+-\d{3}$/.test(label),
    `Interaction id ${String(label)} must match INT-<DOMAIN>-NNN.`,
  );
  assert(!interactionIds.has(label), `Duplicate interaction id: ${label}.`);
  interactionIds.add(label);
  inspectPlatformRecords(interaction);
  assert(isNonEmptyString(interaction.name), `${label} needs a name.`);
  assert(
    allowedStatuses.has(interaction.status),
    `${label} has invalid status ${String(interaction.status)}.`,
  );
  assert(isNonEmptyStringArray(interaction.surfaces), `${label} needs surfaces.`);
  for (const surfaceId of interaction.surfaces ?? []) {
    assert(surfaceIds.has(surfaceId), `${label} references unknown surface ${surfaceId}.`);
  }
  assert(isNonEmptyStringArray(interaction.routes), `${label} needs routes.`);
  assert(
    Array.isArray(interaction.journeys) && interaction.journeys.length > 0,
    `${label} journeys must be a non-empty array.`,
  );
  for (const journey of interaction.journeys ?? []) {
    assert(/^J\d{2}$/.test(journey), `${label} has invalid journey id ${journey}.`);
  }
  assert(isNonEmptyString(interaction.intent), `${label} needs an intent.`);
  assert(
    Array.isArray(interaction.triggers) && interaction.triggers.length > 0,
    `${label} needs at least one trigger.`,
  );
  for (const trigger of interaction.triggers ?? []) {
    assert(
      allowedTriggerKinds.has(trigger.kind),
      `${label} has invalid trigger kind ${String(trigger.kind)}.`,
    );
    assert(isNonEmptyString(trigger.control), `${label} has a trigger without a control.`);
  }
  if (interaction.variants !== undefined) {
    assert(
      Array.isArray(interaction.variants) && interaction.variants.length > 0,
      `${label} variants must be a non-empty array when present.`,
    );
    const variantIds = new Set();
    for (const variant of interaction.variants ?? []) {
      assert(
        /^[a-z][a-z0-9_]*$/.test(variant.id ?? ""),
        `${label} has invalid variant id ${String(variant.id)}.`,
      );
      assert(!variantIds.has(variant.id), `${label} repeats variant ${variant.id}.`);
      variantIds.add(variant.id);
      assert(isNonEmptyString(variant.label), `${label} variant ${variant.id} needs a label.`);
      assert(isNonEmptyString(variant.result), `${label} variant ${variant.id} needs a result.`);
    }
  }
  assert(isNonEmptyString(interaction.availability), `${label} needs availability.`);
  assert(isNonEmptyString(interaction.success_result), `${label} needs a success result.`);
  assert(
    typeof interaction.failure_result === "string",
    `${label} failure_result must be a string.`,
  );
  assert(isNonEmptyStringArray(interaction.effects), `${label} needs effects.`);
  assert(allowedRisks.has(interaction.risk), `${label} has invalid risk ${interaction.risk}.`);
  assert(
    allowedConfirmations.has(interaction.confirmation),
    `${label} has invalid confirmation ${String(interaction.confirmation)}.`,
  );
  if (interaction.risk === "destructive") {
    assert(
      interaction.confirmation !== "none",
      `${label} is destructive and must declare a confirmation gate.`,
    );
  }
  assert(
    isNonEmptyStringArray(interaction.implementation),
    `${label} needs implementation references.`,
  );
  for (const reference of interaction.implementation ?? []) {
    const { file, symbol } = splitReference(reference);
    assert(exists(file), `${label} implementation file does not exist: ${file}.`);
    if (symbol && exists(file)) {
      assert(
        read(file).includes(symbol),
        `${label} implementation symbol ${symbol} is missing from ${file}.`,
      );
    }
  }
  const effectInspection = inspectEffectChecks(interaction);
  failures.push(...effectInspection.issues);
  if (effectInspection.uncheckedEffects.length === 0) {
    mechanicallyCheckedEntries.push(label);
  } else {
    humanReviewEntries.push({
      id: label,
      effects: effectInspection.uncheckedEffects,
    });
  }
  const guidance = interaction.user_guidance;
  assert(
    guidance && typeof guidance === "object" && !Array.isArray(guidance),
    `${label} needs user_guidance.`,
  );
  if (guidance && typeof guidance === "object" && !Array.isArray(guidance)) {
    const expectedAudience = internalQaInteractionIds.has(label) ? "internal_qa" : "user";
    assert(
      guidance.audience === expectedAudience,
      `${label} user_guidance.audience must be ${expectedAudience}.`,
    );
    assert(
      isNonEmptyStringArray(guidance.references),
      `${label} user_guidance.references must be a unique non-empty string array.`,
    );

    for (const reference of Array.isArray(guidance.references)
      ? guidance.references
      : []) {
      if (!isNonEmptyString(reference)) continue;
      const { file, symbol: anchor } = splitReference(reference);
      assert(
        /^docs\/user-guide\/[^/#]+\.md$/.test(file) && !file.includes(".."),
        `${label} user guidance must use a docs/user-guide/*.md#anchor reference: ${reference}.`,
      );
      assert(isNonEmptyString(anchor), `${label} user guidance needs an anchor: ${reference}.`);
      assert(exists(file), `${label} user guidance file does not exist: ${file}.`);
      if (expectedAudience === "internal_qa") {
        assert(
          file === `${userGuideDirectory}/internal-qa.md`,
          `${label} internal QA guidance must stay in ${userGuideDirectory}/internal-qa.md.`,
        );
      } else {
        assert(
          file !== `${userGuideDirectory}/internal-qa.md`,
          `${label} user guidance must not point to the internal QA appendix.`,
        );
      }
      if (exists(file) && isNonEmptyString(anchor)) {
        assert(
          markdownHeadingAnchors(file).has(anchor),
          `${label} user guidance anchor does not resolve: ${reference}.`,
        );
      }
    }
  }
  const coverage = interaction.test_coverage;
  assert(coverage && typeof coverage === "object", `${label} needs test_coverage.`);
  if (coverage && typeof coverage === "object") {
    assert(
      allowedCoverageLevels.has(coverage.level),
      `${label} has invalid test coverage level ${String(coverage.level)}.`,
    );
    assert(Array.isArray(coverage.references), `${label} test references must be an array.`);
    assert(typeof coverage.notes === "string", `${label} test coverage notes must be a string.`);
    if (coverage.level === "direct" || coverage.level === "indirect") {
      assert(
        coverage.references.length > 0,
        `${label} ${coverage.level} test coverage needs at least one reference.`,
      );
    }
    if (coverage.level === "none") {
      assert(
        coverage.references.length === 0,
        `${label} test coverage level none must not cite evidence.`,
      );
    }
    for (const reference of coverage.references ?? []) {
      const { file, symbol } = splitReference(reference);
      assert(exists(file), `${label} test reference does not exist: ${file}.`);
      assert(
        isCoverageEvidenceReference(file),
        `${label} test evidence must use tests/*.(test|spec).* or a repository check-* script: ${file}.`,
      );
      if (coverage.level === "direct") {
        assert(
          isAutomatedTestReference(file),
          `${label} direct test coverage must cite an automated test under tests/: ${file}.`,
        );
      }
      if (symbol && exists(file)) {
        assert(
          read(file).includes(symbol),
          `${label} test symbol ${symbol} is missing from ${file}.`,
        );
      }
    }
  }
}

for (const source of sourceInventory) {
  assert(isNonEmptyString(source.path), "Every source_inventory entry needs a path.");
  assert(!sourcePaths.has(source.path), `Duplicate source_inventory path: ${source.path}.`);
  sourcePaths.add(source.path);
  assert(exists(source.path), `Interactive source does not exist: ${source.path}.`);
  assert(
    Number.isInteger(source.interaction_marker_count) &&
      source.interaction_marker_count > 0,
    `${source.path} interaction_marker_count must be a positive integer.`,
  );
  if (exists(source.path)) {
    const actualMarkerCount = interactionMarkerCount(read(source.path));
    assert(
      source.interaction_marker_count === actualMarkerCount,
      `${source.path} interaction marker count changed: registry=${String(
        source.interaction_marker_count,
      )}, source=${actualMarkerCount}. Review its interaction ids and update the registry count.`,
    );
  }
  assert(
    source.classification === "cataloged" || source.classification === "excluded",
    `${source.path} has invalid classification ${String(source.classification)}.`,
  );
  assert(Array.isArray(source.interaction_ids), `${source.path} interaction_ids must be an array.`);
  if (source.classification === "cataloged") {
    assert(
      source.interaction_ids.length > 0,
      `${source.path} is cataloged but has no interaction ids.`,
    );
  } else {
    assert(
      source.interaction_ids.length === 0,
      `${source.path} is excluded and must not list interaction ids.`,
    );
    assert(isNonEmptyString(source.reason), `${source.path} exclusion needs a reason.`);
  }
  for (const interactionId of source.interaction_ids ?? []) {
    assert(
      interactionIds.has(interactionId),
      `${source.path} references unknown interaction ${interactionId}.`,
    );
  }
}

const inventoriedInteractionIds = new Set(
  sourceInventory.flatMap((source) => source.interaction_ids ?? []),
);
for (const interactionId of interactionIds) {
  assert(
    inventoriedInteractionIds.has(interactionId),
    `${interactionId} is not linked from source_inventory.`,
  );
}

const scannedSources = interactiveSourceFiles();
for (const scannedSource of scannedSources) {
  assert(
    sourcePaths.has(scannedSource),
    `Interactive source is missing from source_inventory: ${scannedSource}.`,
  );
}
for (const sourcePath of sourcePaths) {
  assert(
    scannedSources.includes(sourcePath),
    `source_inventory path no longer contains a recognized interaction marker: ${sourcePath}.`,
  );
}

const journeyIds = [...read(journeyPath).matchAll(/^### (J\d{2})\b/gm)].map(
  (match) => match[1],
);
const knownJourneyIds = new Set(journeyIds);
const coveredJourneyIds = new Set(interactions.flatMap((interaction) => interaction.journeys));
for (const interaction of interactions) {
  for (const journey of interaction.journeys) {
    assert(
      knownJourneyIds.has(journey),
      `${interaction.id} references journey ${journey}, which is missing from ${journeyPath}.`,
    );
  }
}
for (const journeyId of journeyIds) {
  assert(
    coveredJourneyIds.has(journeyId),
    `${journeyId} has no interaction in ${registryPath}.`,
  );
}

const positiveEffectFixture = readJson(
  "tests/fixtures/governance/interaction-side-effect-positive.json",
);
const alteredEffectFixture = readJson(
  "tests/fixtures/governance/interaction-side-effect-altered.json",
);
if (positiveEffectFixture && alteredEffectFixture) {
  assert(
    inspectEffectChecks(positiveEffectFixture).issues.length === 0,
    "The positive interaction side-effect fixture must pass handler evidence checks.",
  );
  assert(
    inspectEffectChecks(alteredEffectFixture).issues.length > 0,
    "The deliberately altered interaction side-effect fixture must fail handler evidence checks.",
  );
}

report();

function report() {
  if (failures.length > 0) {
    console.error(`interactions:check failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `interactions:check passed (${mechanicallyCheckedEntries.length} mechanically checked entries; ${humanReviewEntries.length} entries require human side-effect review).`,
  );
  if (humanReviewEntries.length > 0) {
    console.log("human review:");
    for (const entry of humanReviewEntries) {
      console.log(`- ${entry.id}: ${entry.effects.join(", ")}`);
    }
  }
  process.exit(0);
}
