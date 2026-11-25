import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "./helpers/render-with-refresh";

import { InlineDurationControl } from "@/components/timeline/InlineDurationControl";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import type {
  DefaultDurationFormAction,
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineOccurrenceView,
} from "@/lib/types/timeline";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const noopOccurrenceAction: OccurrenceFormAction = async (state) => state;
const noopTimeAction: TimeTrackingFormAction = async (state) => state;
const noopDurationAction: DefaultDurationFormAction = async (state) => state;

function makeOccurrence(
  visualTone: TimelineOccurrenceView["visualTone"],
): TimelineOccurrenceView {
  return {
    id: `occ-${visualTone}`,
    behaviorId: "behavior-1",
    title: "Daily Injections",
    scheduledFor: "2026-11-25T06:00:00Z",
    scheduledTimeLabel: "1:00 AM",
    localDate: "2026-11-25",
    status:
      visualTone === "completed"
        ? "completed"
        : visualTone === "not_completed"
          ? "not_completed"
          : "unresolved",
    statusMarkedAt: null,
    statusLabel:
      visualTone === "completed"
        ? "Completed"
        : visualTone === "not_completed"
          ? "Not Completed"
          : "Unresolved",
    statusDetail: "",
    expandedStatusActionLabel: "Change status",
    visualTone,
    isVisibleInNeedsDecision: visualTone === "needs_decision",
    canShowDecisionActionsWhenUnresolved: true,
    showDecisionActions: visualTone === "default" || visualTone === "needs_decision",
    showCollapsedStatusLabel:
      visualTone === "completed" || visualTone === "not_completed",
    description: "Inject daily",
    categoryName: "Medical",
    scheduleSummary: "Daily",
    note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true,
  };
}

describe("Surface-scoped semantic tokens", () => {
  it("keeps theme-level tokens separate from surface scopes for future dark mode", () => {
    const tokens = fs.readFileSync(
      path.join(process.cwd(), "packages/ui/tokens.css"),
      "utf8",
    );

    expect(tokens).toContain("--theme-background:");
    expect(tokens).toContain("--theme-foreground:");
    expect(tokens).toContain("--theme-muted-readable:");
    expect(tokens).toContain("--theme-primary:");
    expect(tokens).toContain("--theme-primary-foreground:");
    expect(tokens).toContain("--theme-accent:");
    expect(tokens).toContain("--theme-accent-foreground:");

    expect(tokens).toContain('[data-surface="default"]');
    expect(tokens).toContain("--foreground: var(--theme-foreground);");
    expect(tokens).toContain("--muted-readable: var(--theme-muted-readable);");
    expect(tokens).toContain('[data-surface="primary"]');
    expect(tokens).toContain('[data-surface="accent"]');
  });

  it("maps OccurrenceRow visual tones to data-surface scopes", () => {
    const cases: ReadonlyArray<
      readonly [TimelineOccurrenceView["visualTone"], "default" | "primary" | "accent"]
    > = [
      ["default", "default"],
      ["needs_decision", "default"],
      ["completed", "primary"],
      ["not_completed", "accent"],
    ];

    for (const [tone, surface] of cases) {
      const html = renderToStaticMarkup(
        <OccurrenceRow
          occurrence={makeOccurrence(tone)}
          statusAction={noopOccurrenceAction}
          noteAction={noopOccurrenceAction}
          startTimeTrackingAction={noopTimeAction}
          stopTimeTrackingAction={noopTimeAction}
          resetTimeTrackingAction={noopTimeAction}
        />,
      );
      expect(html).toContain(`data-visual-tone="${tone}"`);
      expect(html).toContain(`data-surface="${surface}"`);
    }
  });

  it("uses surface-aware action styling in InlineDurationControl and resets NoteEditor textarea surface", () => {
    const durationHtml = renderToStaticMarkup(
      <InlineDurationControl
        behaviorId="behavior-1"
        estimate={{
          kind: "known",
          seconds: 300,
          durationLabel: "5m 0s",
          sampleCount: 0,
          lookbackDays: 30,
          provenance: "description_estimate",
        }}
        action={noopDurationAction}
      />,
    );
    expect(durationHtml).toContain("product-action product-action-primary");
    expect(durationHtml).not.toContain("hover:text-primary");

    const noteHtml = renderToStaticMarkup(
      <NoteEditor
        targetFields={{ occurrence_id: "occ-1" }}
        note=""
        action={noopOccurrenceAction}
      />,
    );
    expect(noteHtml).toContain('data-surface="default"');
  });
});
