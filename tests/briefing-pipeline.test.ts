import { expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_PRESETS, DEFAULT_BRIEFING_CONFIG } from "@cadence/core/services/briefing-config";
import { BRIEFING_FIXTURE_IDS, briefingFixture } from "@/lib/services/briefing-fixtures";
import { briefingConfigurationRevision, prepareBriefing } from "@/lib/services/briefing-pipeline";
import { generateDailyBrief } from "@/lib/services/daily-brief-consumer";

it("withholds nonexistent spring-forward windows without shifting them into another hour", () => {
  const config = { ...DEFAULT_BRIEFING_CONFIG, planner: { ...DEFAULT_BRIEFING_CONFIG.planner, preference: "earliest" as const, bufferMinutes: 0, movableBehaviorRefs: ["behavior_fixture"] } };
  const base = briefingFixture("sparse", config);
  const localDate = "2026-03-08", capturedAt = "2026-03-08T06:00:00Z";
  const context = { ...base, localDate, capturedAt, expiresAt: "2026-03-08T06:04:00Z",
    dayStartAt: "2026-03-08T05:00:00Z", dayEndAt: "2026-03-09T04:00:00Z",
    cadence: { ...base.cadence, observedAt: capturedAt,
      occurrences: base.cadence.occurrences.map(item => ({ ...item, localDate, scheduledFor: "2026-03-08T16:30:00Z" })),
      recordedElapsedDurations: base.cadence.recordedElapsedDurations?.map((sample, index) => ({ ...sample, localDate: Temporal.PlainDate.from(localDate).subtract({ days: index + 1 }).toString() })),
      history: { ...base.cadence.history, startLocalDate: Temporal.PlainDate.from(localDate).subtract({ days: 90 }).toString(), endLocalDateExclusive: localDate } },
    connectors: base.connectors.map(connector => connector.state === "not_requested" ? connector : ({ ...connector, fetchedAt: capturedAt, events: [],
      coverage: connector.coverage.map(row => ({ ...row, startLocalDate: localDate, endLocalDate: localDate })) })) };
  for (const permittedWindows of [[{ startMinute: 120, endMinute: 180 }], [{ startMinute: 135, endMinute: 165 }]]) {
    const result = prepareBriefing(context, { ...config, planner: { ...config.planner, permittedWindows } }, capturedAt);
    expect(result.plan.outcome).toBe("no_feasible_option");
    expect(result.plan.options).toEqual([]);
    expect(result.plan.rejections[0].code).toBe("no_feasible_window");
  }
  const available = prepareBriefing(context, { ...config, planner: { ...config.planner, permittedWindows: [{ startMinute: 120, endMinute: 180 }, { startMinute: 180, endMinute: 240 }] } }, capturedAt);
  expect(available.plan.options[0].intervals.proposed.startAt).toBe("2026-03-08T07:00:00Z");
});

it("runs the complete synthetic matrix through the shared pipeline without a provider", async () => {
  for (const fixtureId of BRIEFING_FIXTURE_IDS) for (const preset of BRIEFING_PRESETS) {
    const context = briefingFixture(fixtureId, preset.config);
    const original = JSON.stringify(context);
    const result = await generateDailyBrief(context, { config: preset.config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
      generate: async () => ({ text: "Review the supplied day context.", occurrenceRefs: [], suggestions: [] }) });
    expect(result.versions?.configuration).toBeTruthy();
    expect(JSON.stringify(context)).toBe(original);
  }
});

it("supplies only validated options and withholds availability when scope hides commitments", async () => {
  const config = { ...DEFAULT_BRIEFING_CONFIG, planner: { ...DEFAULT_BRIEFING_CONFIG.planner, movableBehaviorRefs: ["behavior_fixture"] } };
  const context = briefingFixture("sparse", config);
  const prepared = prepareBriefing(context, config, context.capturedAt);
  expect(prepared.plan.options.length).toBeGreaterThan(0);
  const option = prepared.plan.options[0];
  const result = await generateDailyBrief(context, { config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
    generate: async () => ({ text: "Your walk overlaps a fixed commitment.", occurrenceRefs: [option.occurrenceRef], suggestions: [{ text: "Consider the supplied hypothetical option.", occurrenceRefs: [option.occurrenceRef], optionId: option.id, referenceIds: [] }] }) });
  expect(result.suggestions?.[0].option).toEqual(option);
  const other = { ...context.cadence.occurrences[0], ref: "occurrence_other", behaviorRef: "behavior_other" };
  const full = { ...context, cadence: { ...context.cadence, occurrences: [...context.cadence.occurrences, other], history: { ...context.cadence.history, behaviors: [...context.cadence.history.behaviors, { ...context.cadence.history.behaviors[0], behaviorRef: "behavior_other" }] } } };
  const narrow = prepareBriefing(full, { ...config, scope: { ...config.scope, behaviorRefs: ["behavior_fixture"] } }, context.capturedAt);
  expect(narrow.plan.options).toEqual([]);
  expect(narrow.plan.rejections[0].code).toBe("fixed_commitments_incomplete");
});


it("binds input selection and duration policy into the effective recipe revision", () => {
  const base = briefingConfigurationRevision(DEFAULT_BRIEFING_CONFIG);
  for (const context of [
    { ...DEFAULT_BRIEFING_CONFIG.context, includeCompletionHistory: true },
    { ...DEFAULT_BRIEFING_CONFIG.context, includeRecordedElapsedDurations: true },
    { ...DEFAULT_BRIEFING_CONFIG.context, duration: { ...DEFAULT_BRIEFING_CONFIG.context.duration, preference: "historical_average" } },
    { ...DEFAULT_BRIEFING_CONFIG.context, duration: { ...DEFAULT_BRIEFING_CONFIG.context.duration, fallback: "none" } },
  ]) expect(briefingConfigurationRevision({ ...DEFAULT_BRIEFING_CONFIG, context })).not.toBe(base);
  expect(() => briefingConfigurationRevision({ ...DEFAULT_BRIEFING_CONFIG, recipe: { id: "daily_brief", version: "99.0" } })).toThrow(/incompatible/);
});

it("never uses disabled duration candidates to construct a model-visible scheduling option", () => {
  const config = { ...DEFAULT_BRIEFING_CONFIG,
    context: { ...DEFAULT_BRIEFING_CONFIG.context, duration: { ...DEFAULT_BRIEFING_CONFIG.context.duration, includeConfiguredDefault: false, includeHistoricalAverage: false } },
    planner: { ...DEFAULT_BRIEFING_CONFIG.planner, movableBehaviorRefs: ["behavior_fixture"] },
  };
  const context = briefingFixture("sparse", config);
  const prepared = prepareBriefing(context, config, context.capturedAt);
  expect(prepared.plan.options).toEqual([]);
  expect(prepared.plan.rejections).toContainEqual(expect.objectContaining({ code: "duration_unknown" }));
  expect(prepared.facts.cadence.occurrences[0]).not.toHaveProperty("duration");
  expect(JSON.stringify(prepared)).not.toContain('durationCandidates');
});

it("supplies day evidence without movable Behaviors and never treats it as move permission", async () => {
  const config = { ...DEFAULT_BRIEFING_CONFIG,
    allowedSuggestionTypes: ["recap"] as const,
    planner: { ...DEFAULT_BRIEFING_CONFIG.planner, movableBehaviorRefs: [], bufferMinutes: 0 },
  };
  const context = briefingFixture("sparse", config);
  const original = JSON.stringify(context);
  const prepared = prepareBriefing(context, config, context.capturedAt);
  expect(prepared.plan.options).toEqual([]);
  expect(prepared.plan.dayEvidence.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "known_overlap", refs: { occurrenceRefs: ["occurrence_fixture"], calendarEventRefs: ["event_fixture"] } }),
    expect.objectContaining({ kind: "feasible_opportunity", occurrenceRef: "occurrence_fixture", hypotheticalMoveRequired: true }),
  ]));
  await generateDailyBrief(context, { config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
    generate: async ({ facts, instructions, ...capabilities }) => {
      const payload = JSON.parse(facts);
      expect(Object.keys(capabilities)).toEqual(["signal"]);
      expect(payload.plan.dayEvidence.findings).toEqual(prepared.plan.dayEvidence.findings);
      expect(payload.plan).not.toHaveProperty("rejections");
      expect(instructions).toContain("independently of move permission");
      expect(instructions).toContain("Never calculate gaps, overlaps, transitions or fits");
      return { text: "Your midday walk overlaps a fixed commitment.", occurrenceRefs: ["occurrence_fixture"], suggestions: [] };
    },
  });
  expect(JSON.stringify(context)).toBe(original);
  await expect(generateDailyBrief(context, { config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
    generate: async () => ({ text: "Review the overlap.", occurrenceRefs: [], suggestions: [{
      text: "Move the walk.", occurrenceRefs: ["occurrence_fixture"], referenceIds: [], optionId: "evidence_1",
    }] }),
  })).rejects.toMatchObject({ code: "advisor_unavailable" });
});

it("keeps unsupported-fit diagnostics in the inspector and excludes them from the model plan", async () => {
  const config = { ...DEFAULT_BRIEFING_CONFIG,
    context: { ...DEFAULT_BRIEFING_CONFIG.context, duration: { ...DEFAULT_BRIEFING_CONFIG.context.duration, includeConfiguredDefault: false, includeHistoricalAverage: false } },
    planner: { ...DEFAULT_BRIEFING_CONFIG.planner, movableBehaviorRefs: [] },
  };
  const context = briefingFixture("sparse", config);
  const inspector = prepareBriefing(context, config, context.capturedAt);
  expect(inspector.plan.dayEvidence.findings).toContainEqual(expect.objectContaining({ kind: "unknown_feasibility" }));
  await generateDailyBrief(context, { config, now: () => Temporal.Instant.from(context.capturedAt), signal: new AbortController().signal,
    generate: async ({ facts }) => {
      const { plan } = JSON.parse(facts);
      expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
      expect(plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "unknown_feasibility" }));
      expect(plan).not.toHaveProperty("rejections");
      expect(facts).not.toContain("durationCandidates");
      return { text: "No specific timing recommendation today.", occurrenceRefs: [], suggestions: [] };
    },
  });
});

it("honors Calendar, scope and completion exclusions for independent day evidence", () => {
  const config = DEFAULT_BRIEFING_CONFIG;
  const context = briefingFixture("sparse", config);
  const hidden = prepareBriefing(context, { ...config, scope: { ...config.scope, includeCalendar: false } }, context.capturedAt);
  expect(hidden.plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
  expect(hidden.plan.dayEvidence.findings.every(finding => finding.refs.calendarEventRefs.length === 0)).toBe(true);
  for (const id of ["calendar_partial", "calendar_absent", "no_feasible"] as const) {
    const source = briefingFixture(id, config);
    expect(prepareBriefing(source, config, source.capturedAt).plan.dayEvidence.findings)
      .not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
  }
  const other = { ...context.cadence.occurrences[0], ref: "occurrence_other", behaviorRef: "behavior_other" };
  const full = { ...context, cadence: { ...context.cadence, occurrences: [...context.cadence.occurrences, other],
    history: { ...context.cadence.history, behaviors: [...context.cadence.history.behaviors, { ...context.cadence.history.behaviors[0], behaviorRef: "behavior_other" }] } } };
  const narrowed = prepareBriefing(full, { ...config, scope: { ...config.scope, behaviorRefs: ["behavior_fixture"] } }, context.capturedAt);
  expect(narrowed.plan.dayEvidence.findings).not.toContainEqual(expect.objectContaining({ kind: "feasible_opportunity" }));
  expect(JSON.stringify(narrowed.plan)).not.toContain("occurrence_other");
  for (const status of ["completed", "not_completed"] as const) {
    const resolved = { ...context, cadence: { ...context.cadence, occurrences: context.cadence.occurrences.map(item => ({ ...item, status })) } };
    const result = prepareBriefing(resolved, config, context.capturedAt);
    expect(result.plan.dayEvidence.findings).toEqual([]);
    expect(resolved.cadence.occurrences[0].status).toBe(status);
  }
});

it("plans around disclosed Outlook events but never treats recorded workouts as busy or free time (Ticket 239)", async () => {
  const { connectorDayContext, outlookDaySnapshot } = await import("./helpers/connector-day-context");
  const context = connectorDayContext();
  const config = { ...DEFAULT_BRIEFING_CONFIG, planner: { ...DEFAULT_BRIEFING_CONFIG.planner, bufferMinutes: 0 } };
  const googleOnly = prepareBriefing({ ...context, version: "1.0", connectors: [context.connectors[0]!] } as never, config, context.capturedAt);
  const prepared = prepareBriefing(context, config, context.capturedAt);
  const outlookRefs = context.connectors.find((item) => item.source === "outlook_calendar")!;
  const outlookEventRef = "events" in outlookRefs ? outlookRefs.events[0]!.ref : "";
  // The Outlook event overlapping the 17:30Z Walk becomes day evidence; the workout does not.
  expect(JSON.stringify(prepared.plan.dayEvidence.findings)).toContain(outlookEventRef);
  expect(JSON.stringify(googleOnly.plan.dayEvidence.findings)).not.toContain(outlookEventRef);
  const hevy = context.connectors.find((item) => item.source === "hevy")!;
  const activityRef = "activities" in hevy ? hevy.activities[0]!.ref : "";
  expect(JSON.stringify(prepared.plan)).not.toContain(activityRef);
  expect(prepared.facts).toMatchObject({ version: "1.1", status: "complete", connectorSources: { recordedActivity: { semantics: "past_recorded_activity" } } });
  expect(prepared.plan.dayEvidence.coverage.calendar).toBe("current_complete");

  // An unavailable Outlook source blocks free-time claims even while Google is complete.
  const failed = outlookDaySnapshot();
  failed.completeness = "incomplete";
  failed.coverage = failed.coverage.map((row: Record<string, unknown>) => ({ ...row, paginationComplete: false }));
  failed.failures = [{ code: "timeout", message: "Outlook read timed out.", retryable: true, retryAfterSeconds: null, calendarId: "calendar-1" }];
  failed.freshness = { ...failed.freshness, state: "incomplete", label: "Outlook Calendar incomplete", canAssertNoOverlap: false };
  const partial = prepareBriefing(connectorDayContext({ outlook: failed }), config, context.capturedAt);
  expect(partial.plan.dayEvidence.coverage).toMatchObject({ calendar: "current_partial", canClaimFeasibleOpportunities: false });
  expect(partial.facts.status).toBe("partial");
  expect(partial.plan.dayEvidence.findings.some((finding) => finding.kind === "feasible_opportunity")).toBe(false);
});
