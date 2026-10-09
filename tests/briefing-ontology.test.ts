import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BRIEFING_FIXTURE_IDS } from "@/lib/services/briefing-fixtures";

type Term = {
  id: string;
  label: string;
  category: string;
  definition: string;
  contracts: Array<{ path: string; symbol: string }>;
  relatedIds: string[];
};

const root = resolve(import.meta.dirname, "..");
const ontology = JSON.parse(readFileSync(resolve(root, "docs/ontology/briefing-workbench.json"), "utf8")) as {
  version: string;
  scope: string;
  terms: Term[];
};

it("defines every selectable evaluation fixture in the existing glossary", () => {
  for (const fixtureId of BRIEFING_FIXTURE_IDS) {
    const term = ontology.terms.find(term => term.id === `workbench.fixture.${fixtureId.replaceAll("_", "-")}`);
    expect(term?.label).toContain(fixtureId);
    expect(term?.contracts).toContainEqual({ path: "lib/services/briefing-fixtures.ts", symbol: "briefingFixture" });
  }
});
const ids = new Set(ontology.terms.map(({ id }) => id));

function sourceFile(path: string): ts.SourceFile {
  const absolute = resolve(root, path);
  return ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function declarations(path: string): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile(path).statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement))
      && statement.name
    ) names.add(statement.name.text);
  }
  return names;
}

function typeAlias(file: ts.SourceFile, name: string): ts.TypeNode {
  const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!declaration) throw new Error(`Missing type alias ${name}`);
  return declaration.type;
}

function unwrap(node: ts.TypeNode): ts.TypeNode {
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) return unwrap(node.type);
  if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1 && ts.isIdentifier(node.typeName)
      && node.typeName.text === "Readonly") return unwrap(node.typeArguments[0]);
  return node;
}

function property(type: ts.TypeNode, name: string): ts.TypeNode {
  const node = unwrap(type);
  if (!ts.isTypeLiteralNode(node)) throw new Error(`Expected object before ${name}`);
  const member = node.members.find((candidate): candidate is ts.PropertySignature =>
    ts.isPropertySignature(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name);
  if (!member?.type) throw new Error(`Missing property ${name}`);
  return member.type;
}

function stringLiterals(node: ts.Node): string[] {
  const values: string[] = [];
  const visit = (candidate: ts.Node) => {
    if (ts.isLiteralTypeNode(candidate) && ts.isStringLiteral(candidate.literal)) values.push(candidate.literal.text);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return [...new Set(values)];
}

function configLeaves(node: ts.TypeNode, prefix = "", file?: ts.SourceFile): string[] {
  const current = unwrap(node);
  if (file && ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
    const typeName = current.typeName.text;
    const declaration = file.statements.find((statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === typeName);
    if (declaration) return configLeaves(declaration.type, prefix, file);
  }
  if (ts.isTypeLiteralNode(current)) return current.members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) return [];
    return configLeaves(member.type, prefix ? `${prefix}.${member.name.text}` : member.name.text, file);
  });
  if (ts.isArrayTypeNode(current)) {
    const element = unwrap(current.elementType);
    return ts.isTypeLiteralNode(element) ? configLeaves(element, prefix, file) : [prefix];
  }
  return [prefix];
}

const termIdsFor = (prefix: string, values: readonly string[]) =>
  values.map((value) => `${prefix}.${value.replaceAll("_", "-")}`).sort();

describe("briefing workbench ontology", () => {
  it("has stable terms, valid relationships, and traceable source symbols", () => {
    expect(ontology).toMatchObject({ version: "1.5", scope: "Briefing workbench" });
    expect(ontology.terms.length).toBeGreaterThan(0);
    expect(ids.size).toBe(ontology.terms.length);

    const declarationCache = new Map<string, Set<string>>();
    for (const term of ontology.terms) {
      expect(Object.keys(term).sort()).toEqual(["category", "contracts", "definition", "id", "label", "relatedIds"]);
      expect(term.id).toMatch(/^[a-z][A-Za-z0-9]*(?:[.-][a-z][A-Za-z0-9]*)*$/);
      expect(term.label.trim()).toBe(term.label);
      expect(term.category).toMatch(/^[A-Z][A-Za-z ]+$/);
      expect(term.definition.length).toBeGreaterThan(20);
      expect(term.contracts.length).toBeGreaterThan(0);
      expect(term.relatedIds.length, term.id).toBeGreaterThan(0);
      expect(new Set(term.relatedIds).size).toBe(term.relatedIds.length);
      expect(term.relatedIds).not.toContain(term.id);
      for (const relatedId of term.relatedIds) expect(ids.has(relatedId), `${term.id} -> ${relatedId}`).toBe(true);
      for (const contract of term.contracts) {
        expect(Object.keys(contract).sort()).toEqual(["path", "symbol"]);
        expect(contract.path.startsWith("/")).toBe(false);
        const available = declarationCache.get(contract.path) ?? declarations(contract.path);
        declarationCache.set(contract.path, available);
        expect(available.has(contract.symbol), `${term.id}: ${contract.path}#${contract.symbol}`).toBe(true);
      }
    }
  });

  it("covers every configuration leaf and every configuration enum value", () => {
    const file = sourceFile("packages/core/src/types/briefing-config.ts");
    const config = typeAlias(file, "BriefingConfigV1");
    expect(configLeaves(config, "", file).map((path) => `config.${path}`).sort()).toEqual(
      [...ids].filter((id) => [
        "config.version", "config.recipe", "config.tone", "config.directness", "config.encouragement", "config.length.maxWords",
        "config.priorities", "config.allowedSuggestionTypes", "config.alternatives", "config.scope.behaviorRefs",
        "config.scope.historyDays", "config.scope.includeCalendar", "config.context.includeCompletionHistory",
        "config.context.includeHistoricalCompletionTimes", "config.context.includeRecordedElapsedDurations",
        "config.context.duration.includeHistoricalAverage", "config.context.duration.includeConfiguredDefault",
        "config.context.duration.preference", "config.context.duration.fallback", "config.referenceIds", "config.planner.bufferMinutes",
        "config.planner.preference", "config.planner.movableBehaviorRefs", "config.planner.permittedWindows.startMinute",
        "config.planner.permittedWindows.endMinute", "config.analysis.lanes", "config.analysis.maxTips", "config.analysis.cooldownDays",
      ].includes(id)).sort(),
    );

    const aliases = [
      ["BriefingTone", "config.tone"],
      ["BriefingDirectness", "config.directness"],
      ["BriefingEncouragement", "config.encouragement"],
      ["BriefingPriority", "config.priorities"],
      ["BriefingSuggestionType", "config.allowedSuggestionTypes"],
    ] as const;
    for (const [alias, prefix] of aliases) {
      expect(termIdsFor(prefix, stringLiterals(typeAlias(file, alias)))).toEqual(
        [...ids].filter((id) => id.startsWith(`${prefix}.`) && id !== `${prefix}.all`).sort(),
      );
    }
    expect(termIdsFor("config.planner.preference", stringLiterals(property(property(config, "planner"), "preference")))).toEqual(
      [...ids].filter((id) => id.startsWith("config.planner.preference.")).sort(),
    );
    expect(ontology.terms.find(term => term.id === "config.recipe")?.contracts).toContainEqual({
      path: "packages/core/src/types/briefing-config.ts", symbol: "DAILY_BRIEF_RECIPE",
    });
    const context = typeAlias(file, "BriefingContextConfig");
    for (const leaf of [
      "includeCompletionHistory", "includeHistoricalCompletionTimes", "includeRecordedElapsedDurations",
      "duration.includeHistoricalAverage", "duration.includeConfiguredDefault", "duration.preference", "duration.fallback",
    ]) expect(ids.has(`config.context.${leaf}`), `config.context.${leaf}`).toBe(true);
    expect(termIdsFor("config.context.duration.preference", stringLiterals(typeAlias(file, "BriefingDurationSource")))).toEqual(
      [...ids].filter((id) => id.startsWith("config.context.duration.preference.")).sort(),
    );
    expect(termIdsFor("config.context.duration.fallback", stringLiterals(property(property(context, "duration"), "fallback")))).toEqual(
      [...ids].filter((id) => id.startsWith("config.context.duration.fallback.")).sort(),
    );
  });

  it("documents recipe policy, source semantics, and projection boundaries", () => {
    expect([...ids]).toEqual(expect.arrayContaining([
      "config.recipe", "config.recipe.id.daily-brief", "config.recipe.version", "config.legacy-version",
      "config.context.finished-at", "config.context.elapsed-duration", "config.context.duration.sample-eligibility",
      "config.context.exclusion", "config.context.derived-independence", "policy.daily-brief",
      "policy.version", "result.warnings",
    ]));
    const configFile = sourceFile("packages/core/src/types/briefing-config.ts");
    const dailyBriefFile = sourceFile("packages/core/src/types/daily-brief.ts");
    expect([...declarations("packages/core/src/types/briefing-config.ts")]).toEqual(expect.arrayContaining(
      ["BRIEFING_CONFIG_VERSION", "LEGACY_BRIEFING_CONFIG_VERSION", "DAILY_BRIEF_RECIPE"],
    ));
    expect([...declarations("packages/core/src/types/daily-brief.ts")]).toEqual(expect.arrayContaining(["DAILY_BRIEF_POLICY_VERSION"]));
    expect(typeAlias(configFile, "BriefingContextProjection")).toBeDefined();
    expect(typeAlias(configFile, "BriefingModelFacts")).toBeDefined();
    expect(typeAlias(configFile, "BriefingContextControls")).toBeDefined();
    const dailyBrief = typeAlias(dailyBriefFile, "DailyBriefing");
    expect(typeAlias(dailyBriefFile, "DailyBriefing")).toBeDefined();
    expect([...ids]).toEqual(expect.arrayContaining(["result.versions.recipe", "result.versions.policy"]));
    expect(property(property(dailyBrief, "versions"), "recipe")).toBeDefined();
    expect(property(property(dailyBrief, "versions"), "policy")).toBeDefined();
  });

  it("tracks planner, context, status, reference, and workbench enum drift", () => {
    const planFile = sourceFile("packages/core/src/types/briefing-plan.ts");
    const plan = typeAlias(planFile, "BriefingPlanResult");
    expect(property(plan, "dayEvidence")).toBeDefined();
    expect([...ids]).toEqual(expect.arrayContaining([
      "planner.day-evidence", "planner.day-evidence.known-overlap",
      "planner.day-evidence.tight-transition", "planner.day-evidence.feasible-opportunity",
      "planner.day-evidence.unknown-feasibility",
    ]));
    expect(termIdsFor("planner.route", stringLiterals(property(plan, "route")))).toEqual(
      [...ids].filter((id) => id.startsWith("planner.route.")).sort(),
    );
    expect(termIdsFor("planner.outcome", stringLiterals(property(plan, "outcome")))).toEqual(
      [...ids].filter((id) => id.startsWith("planner.outcome.")).sort(),
    );
    expect(termIdsFor("planner.rejection", stringLiterals(typeAlias(planFile, "BriefingPlanRejectionCode")))).toEqual(
      [...ids].filter((id) => id.startsWith("planner.rejection.")).sort(),
    );
    expect(ontology.terms.find(term => term.id === "planner.rejection")!.relatedIds.slice().sort()).toEqual(
      termIdsFor("planner.rejection", stringLiterals(typeAlias(planFile, "BriefingPlanRejectionCode"))),
    );

    const contextFile = sourceFile("packages/core/src/types/advisor-day-context.ts");
    expect(termIdsFor("context.status", stringLiterals(property(typeAlias(contextFile, "AdvisorDayContextV1"), "status")))).toEqual(
      [...ids].filter((id) => id.startsWith("context.status.")).sort(),
    );
    const briefFile = sourceFile("packages/core/src/types/daily-brief.ts");
    expect(termIdsFor("result.coverage", stringLiterals(property(typeAlias(briefFile, "DailyBriefing"), "coverage")))).toEqual(
      [...ids].filter((id) => id.startsWith("result.coverage.")).sort(),
    );
    const calendarStates = [
      ...stringLiterals(property(typeAlias(contextFile, "AdvisorCalendarConnector"), "state")),
      ...stringLiterals(property(typeAlias(contextFile, "AdvisorCalendarNotRequested"), "state")),
    ];
    expect(termIdsFor("calendar.state", calendarStates)).toEqual(
      [...ids].filter((id) => id.startsWith("calendar.state.")).sort(),
    );

    const databaseFile = sourceFile("packages/core/src/types/database.ts");
    expect(termIdsFor("occurrence.status", stringLiterals(typeAlias(databaseFile, "OccurrenceStatus")))).toEqual(
      [...ids].filter((id) => id.startsWith("occurrence.status.")).sort(),
    );

    const referencesFile = sourceFile("packages/core/src/services/briefing-references.ts");
    const reference = typeAlias(referencesFile, "BriefingReference");
    expect(termIdsFor("reference.kind", stringLiterals(property(reference, "kind")))).toEqual(
      [...ids].filter((id) => id.startsWith("reference.kind.")).sort(),
    );
    expect(termIdsFor("reference.status", stringLiterals(property(reference, "status")))).toEqual(
      [...ids].filter((id) => id.startsWith("reference.status.")).sort(),
    );

    const workbenchFile = sourceFile("app/design-system/DailyBriefBench.tsx");
    expect(stringLiterals(typeAlias(workbenchFile, "Comparison")).sort()).toEqual(["account", "error", "ready", "synthetic"]);
    for (const id of ["workbench.mode.account", "workbench.mode.synthetic", "workbench.result.error", "workbench.result.ready"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("covers error codes emitted by comparison, account capture, authentication and client fallbacks", () => {
    const codes = new Set<string>();
    const collect = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && /^[a-z]+(?:_[a-z]+)+$/.test(node.text)) codes.add(node.text);
      ts.forEachChild(node, collect);
    };
    const visit = (node: ts.Node, responseCode = false) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
          ["DailyBriefError", "AdvisorDayContextServiceError", "CalendarConnectionError", "Error"].includes(node.expression.text) && node.arguments?.[0]) {
        collect(node.arguments[0]);
      }
      if (ts.isPropertyAssignment(node) && node.name.getText() === "error") collect(node.initializer);
      if (responseCode && ts.isVariableDeclaration(node) && node.name.getText() === "code" && node.initializer) collect(node.initializer);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "setError" && node.arguments[0]) collect(node.arguments[0]);
      ts.forEachChild(node, child => visit(child, responseCode));
    };
    for (const path of [
      "lib/services/briefing-workbench.service.ts", "lib/services/briefing-account-context.service.ts",
      "lib/services/daily-brief-consumer.ts", "lib/services/advisor-day-context.service.ts",
      "lib/services/google-calendar-request.ts", "app/design-system/DailyBriefBench.tsx",
    ]) visit(sourceFile(path), path === "lib/services/briefing-workbench.service.ts");
    // Account authorization calls this reader; OAuth setup errors are a separate surface.
    const calendar = sourceFile("lib/services/google-calendar.service.ts").statements.find(statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "getCalendarConnection");
    expect(calendar).toBeDefined();
    visit(calendar!);
    const storageCodes = stringLiterals(typeAlias(sourceFile("lib/db/daily-brief.repo.ts"), "DailyBriefStorageErrorCode"));
    for (const code of storageCodes) codes.add(code === "session" ? "unauthenticated" : code === "unavailable" ? "advisor_unavailable" : code);
    for (const id of termIdsFor("workbench.error", [...codes])) expect(ids.has(id), id).toBe(true);
    expect(ontology.terms.find(term => term.id === "workbench.error")!.relatedIds.slice().sort()).toEqual(
      [...ids].filter(id => id.startsWith("workbench.error.")).sort(),
    );
  });

  it("covers the event and source statuses shown inside the context inspector", () => {
    const dayProgress = sourceFile("packages/core/src/types/day-progress.ts");
    for (const [alias, prefix] of [
      ["ExternalEventState", "calendar.event.state"],
      ["ExternalEventAvailability", "calendar.event.availability"],
      ["ExternalEventResponseStatus", "calendar.event.response"],
      ["ExternalEventSourceTimezoneFallback", "calendar.event.timezone-fallback"],
    ]) {
      expect(termIdsFor(prefix, stringLiterals(typeAlias(dayProgress, alias)))).toEqual(
        [...ids].filter(id => id.startsWith(`${prefix}.`)).sort(),
      );
    }
    const context = sourceFile("packages/core/src/types/advisor-day-context.ts");
    expect(termIdsFor("calendar.failure", stringLiterals(typeAlias(context, "AdvisorSourceFailureCode")))).toEqual(
      [...ids].filter(id => id.startsWith("calendar.failure.")).sort(),
    );
    expect(termIdsFor("occurrence.schedule", stringLiterals(property(property(typeAlias(context, "AdvisorOccurrence"), "schedule"), "kind")))).toEqual(
      [...ids].filter(id => id.startsWith("occurrence.schedule.")).sort(),
    );
  });
});
