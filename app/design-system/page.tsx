import { CalendarSettingsBench, CalendarDetailsBench, CalendarTimelineBench } from "./CalendarBench";
import { TravelSettingsBench } from "./TravelBench";
import { DailyBriefBubbleBench, DailyBriefSettingsBench, DailyBriefWorkbench } from "./DailyBriefBench";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  CalendarDays,
  Download,
  ListChecks,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";

import manifestJson from "@/design-system.manifest.json";
import surfacesJson from "@/design-system.surfaces.json";
import usageJson from "@/design-system.usage.json";
import { BehaviorCreateSection } from "@/components/behaviors/BehaviorCreateSection";
import { BehaviorForm } from "@/components/behaviors/BehaviorForm";
import { BehaviorList } from "@/components/behaviors/BehaviorList";
import { ReminderEditor } from "@/components/behaviors/ReminderEditor";
import { BehaviorLogImportPanel } from "@/components/export/BehaviorLogImportPanel";
import { BehaviorLogRestorePanel } from "@/components/export/BehaviorLogRestorePanel";
import { ExportPanel } from "@/components/export/ExportPanel";
import { ExportRangeSelector } from "@/components/export/ExportRangeSelector";
import { MarkdownSummaryActions } from "@/components/export/MarkdownSummaryActions";
import { PromptCopyAction } from "@/components/export/PromptCopyAction";
import { PromptLibraryPanel } from "@/components/export/PromptLibraryPanel";
import { AppShell } from "@/components/layout/AppShell";
import { WebRuntimeProvider } from "@/components/layout/WebRuntimeProvider";
import {
  CadencePageBanner,
  ScreenContentLoading,
  ScreenFrame,
} from "@/components/layout/ScreenFrame";
import { FirstRunOnboardingPanel } from "@/components/onboarding/FirstRunOnboardingPanel";
import { NoteShortcutSettings, type NoteShortcutAction } from "@/components/note-shortcuts/NoteShortcutControls";
import {
  AccountDeletionPanel,
  type DeleteAccountAction,
} from "@/components/settings/AccountDeletionPanel";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { NotificationPermissionPanel } from "@/components/settings/NotificationPermissionPanel";
import {
  TimezonePanel,
  type TimezoneUpdateAction,
} from "@/components/settings/TimezonePanel";
import { TrustAndLegalPanel } from "@/components/settings/SettingsPanels";
import { TrustEvidencePanel } from "@/components/trust/TrustEvidencePanel";
import { MobileTimelinePullToRefresh } from "@/components/timeline/MobileTimelinePullToRefresh";
import { NeedsDecisionDialog } from "@/components/timeline/NeedsDecisionDialog";
import { OccurrenceNoteForm } from "@/components/timeline/OccurrenceNoteForm";
import type { NoteShortcut, NoteShortcutView } from "@cadence/core/types/note-shortcut";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import { StatusButtons } from "@/components/timeline/StatusButtons";
import { TimeTracker } from "@/components/timeline/TimeTracker";
import { Timeline } from "@/components/timeline/Timeline";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import { GoogleLoginButton } from "@/app/(auth)/login/GoogleLoginButton";
import { DayProgressBench } from "@/app/design-system/DayProgressBench";
import { EXPORT_PROMPT_TEMPLATES } from "@/lib/export-prompts";
import { APP_NAV_ITEMS, type AppNavHref } from "@/lib/navigation";
import type { AnalyticsView } from "@/lib/types/analytics";
import { resolveBehaviorLogImportMergePreview } from "@/lib/resolvers/behaviorlog-import.resolver";
import type {
  BehaviorActionState,
  BehaviorFormAction,
  BehaviorRecurrenceFormDefaults,
  BehaviorView,
  CategoryOption,
} from "@/lib/types/behavior";
import type { BehaviorLogImportMergePreviewResult } from "@/lib/types/behaviorlog-import";
import type {
  BehaviorLogImportActionState,
  BehaviorLogImportFormAction,
  BehaviorLogImportPageData,
} from "@/lib/types/behaviorlog-import-ui";
import type { BehaviorLogRestorePreview } from "@/lib/types/behaviorlog-restore";
import type {
  BehaviorLogRestoreActionState,
  BehaviorLogRestoreFormAction,
  BehaviorLogRestorePageData,
} from "@/lib/types/behaviorlog-restore-ui";
import type { ExportBundle } from "@/lib/types/export";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";
import type { PublicTrustView } from "@/lib/services/public-trust-evidence.service";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineDaySection,
  TimelineOccurrenceView,
  TimelineView,
} from "@/lib/types/timeline";

export const metadata: Metadata = {
  title: "Design system bench",
};

type ManifestEntry = {
  id: string;
  name: string;
  kind: string;
  source: string;
  exportName: string;
  benchAnchor: string;
  trackUsages: string;
  status: string;
  notes: string;
};

type Manifest = {
  components: ManifestEntry[];
};

type SurfaceEntry = {
  id: string;
  name: string;
  status: string;
  runtime: string;
  sourceRoots: string[];
  nativeBench: string | null;
  inventory: string | null;
  notes: string;
};

type SurfaceImplementation = {
  surfaceId: string;
  status: string;
  parity: string;
  sources: string[];
  implementationIds: string[];
  notes: string;
};

type ComponentFamily = {
  id: string;
  name: string;
  tier: string;
  definition: string;
  sharedContract: string[];
  surfaceImplementations: SurfaceImplementation[];
};

type SurfaceCatalog = {
  summary: string;
  rules: string[];
  surfaces: SurfaceEntry[];
  componentFamilies: ComponentFamily[];
};

type UsageEntry = {
  componentId: string;
  file: string;
  line: number;
  route: string | null;
  usageKind: string;
  confidence: string;
};

type Usage = {
  usages: UsageEntry[];
  summary: {
    productUsages: number;
    benchPreviews: number;
  };
};

const manifest = manifestJson as Manifest;
const surfaceCatalog = surfacesJson as SurfaceCatalog;
const usage = usageJson as Usage;
const manifestById = new Map(
  manifest.components.map((entry) => [entry.id, entry] as const),
);

const kindOrder = [
  "navigation",
  "layout",
  "flow",
  "module",
  "composite",
  "primitive",
  "token",
];

const familyTierOrder = [
  "foundation",
  "primitive",
  "brand",
  "navigation",
  "layout",
  "pattern",
  "flow",
  "module",
];

const navIcons: Record<AppNavHref, LucideIcon> = {
  "/timeline": CalendarDays,
  "/behaviors": ListChecks,
  "/export": Download,
  "/settings": Settings,
};

async function benchBehaviorAction(
  previousState: BehaviorActionState,
  formData: FormData,
): Promise<BehaviorActionState> {
  "use server";

  void previousState;
  void formData;

  return {
    status: "success",
    message: "Bench action only. No product data changed.",
  };
}

async function benchOccurrenceAction(
  previousState: OccurrenceActionState,
  formData: FormData,
): Promise<OccurrenceActionState> {
  "use server";

  void previousState;

  const status = formData.get("status");
  const nextStatus =
    status === "completed" || status === "not_completed" ? status : undefined;

  return {
    status: "success",
    message: "Bench action only. No occurrence was changed.",
    ...(nextStatus ? { nextStatus } : {}),
  };
}

async function benchTimeTrackingAction(
  previousState: TimeTrackingActionState,
  formData: FormData,
): Promise<TimeTrackingActionState> {
  "use server";

  void previousState;

  const requestId = String(formData.get("client_action_id") ?? "");
  const didReset = requestId.startsWith("reset-");

  return {
    status: "success",
    message: didReset
      ? "Tracked time reset."
      : "Bench action only. No tracked time changed.",
    requestId,
    tracking: {
      recordedSeconds: didReset ? 0 : 65,
      runningStartedAt: null,
    },
  };
}

async function benchTimezoneAction(
  previousState: Awaited<ReturnType<TimezoneUpdateAction>>,
  formData: FormData,
): ReturnType<TimezoneUpdateAction> {
  "use server";

  void previousState;

  const timezone = String(formData.get("timezone") ?? "America/New_York");

  return {
    status: "success",
    message: "Bench action only. No timezone was changed.",
    timezone,
    activeBehaviorCount: 0,
  };
}

async function benchDeleteAccountAction(
  previousState: Awaited<ReturnType<DeleteAccountAction>>,
  formData: FormData,
): ReturnType<DeleteAccountAction> {
  "use server";

  void previousState;
  void formData;

  return {
    status: "error",
    message: "Bench action only. No account was deleted.",
  };
}

async function benchBehaviorLogImportAction(
  previousState: BehaviorLogImportActionState,
  formData: FormData,
): Promise<BehaviorLogImportActionState> {
  "use server";

  if (
    formData.get("intent") !== "apply" ||
    previousState.status === "error"
  ) {
    return previousState;
  }

  return {
    ...previousState,
    status: "applied",
    message:
      "Accepted-preview fixture applied. The bench did not change product data.",
    applyResult: {
      mode: "create_missing_only",
      importRun: {
        id: "bench-import-apply",
        import_mode: "create_missing_only",
        status: "applied",
        started_at: "2026-06-08T21:11:00Z",
        completed_at: "2026-06-08T21:11:02Z",
        failure_message: null,
      },
      created: {
        behaviors: 1,
        schedules: 0,
        occurrences: 0,
        statusEvents: 0,
        notes: 1,
        interventions: 0,
        mappings: 2,
      },
      skipped: {
        behaviors: 0,
        schedules: 0,
        occurrences: 0,
        statusEvents: 0,
        notes: 0,
        interventions: 0,
      },
    },
  };
}

async function benchBehaviorLogRestoreAction(
  previousState: BehaviorLogRestoreActionState,
  formData: FormData,
): Promise<BehaviorLogRestoreActionState> {
  "use server";

  void formData;

  return {
    ...previousState,
    status: "error",
    message: "Restore apply is disabled in the fixture bench.",
  };
}

type DesignSystemPageProps = Readonly<{
  searchParams?: Promise<{
    preview?: string | string[];
    state?: string | string[];
  }>;
}>;

export default async function DesignSystemPage({
  searchParams,
}: DesignSystemPageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const selectedPreviewId = firstSearchParam(params?.preview);
  const selectedFixtureState = firstSearchParam(params?.state);

  if (selectedPreviewId === "briefing-workbench") return <DailyBriefWorkbench repositoryRoot={process.cwd()} />;

  if (selectedPreviewId === "day-progress") {
    return (
      <WebRuntimeProvider>
        <DayProgressBench
          statusAction={benchOccurrenceAction}
          noteAction={benchOccurrenceAction}
          startTimeTrackingAction={benchTimeTrackingAction}
          stopTimeTrackingAction={benchTimeTrackingAction}
          resetTimeTrackingAction={benchTimeTrackingAction}
        />
      </WebRuntimeProvider>
    );
  }
  const usageByComponent = groupUsages(usage.usages);
  const previews = buildPreviews(selectedPreviewId, selectedFixtureState);

  return (
    <WebRuntimeProvider>
      <main
        className="min-h-dvh bg-neutral-100 text-neutral-950"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:px-8">
          <BenchHeader />
          <BenchNav />
          <Foundations />
          <SurfaceModel />
          <CanonicalInventory />
          <TraceInventory usageByComponent={usageByComponent} previews={previews} />
        </div>
      </main>
    </WebRuntimeProvider>
  );
}

function BenchHeader() {
  return (
    <header className="grid gap-4 border border-neutral-300 bg-white p-5 sm:p-6">
      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Local design-system bench
        </p>
        <h1 className="text-3xl font-semibold tracking-normal text-neutral-950">
          Cadence UI traceability
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-neutral-600">
          This route renders fixture-backed product UI for inspection. It is not
          in primary navigation, does not query Supabase, and is disabled in
          production builds.
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Surfaces" value={surfaceCatalog.surfaces.length} />
        <Metric
          label="Canonical families"
          value={surfaceCatalog.componentFamilies.length}
        />
        <Metric label="Tracked web items" value={manifest.components.length} />
        <Metric label="Product usages" value={usage.summary.productUsages} />
        <Metric label="Theme toggle" value="Not detected" />
      </dl>
    </header>
  );
}

function Metric({
  label,
  value,
}: Readonly<{
  label: string;
  value: string | number;
}>) {
  return (
    <div className="border border-neutral-300 bg-neutral-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">
        {value}
      </dd>
    </div>
  );
}

function BenchNav() {
  return (
    <nav
      aria-label="Bench sections"
      className="flex flex-wrap gap-2 border border-neutral-300 bg-white p-3 text-sm"
    >
      <BenchAnchor href="#ds-foundations">Foundations</BenchAnchor>
      <BenchAnchor href="#ds-primitives">Primitives</BenchAnchor>
      <BenchAnchor href="#bench-surface-model">Surfaces</BenchAnchor>
      <BenchAnchor href="#bench-canonical-inventory">Canonical inventory</BenchAnchor>
      <BenchAnchor href="#bench-traces">Trace cards</BenchAnchor>
    </nav>
  );
}

function BenchAnchor({
  href,
  children,
}: Readonly<{
  href: string;
  children: ReactNode;
}>) {
  return (
    <a
      href={href}
      className="border border-neutral-300 bg-neutral-50 px-3 py-2 font-semibold text-neutral-800 hover:bg-neutral-200"
    >
      {children}
    </a>
  );
}

function Foundations() {
  return (
    <section id="ds-foundations" className="grid gap-4">
      <SectionHeading
        eyebrow="Required coverage"
        title="Foundations"
        description="Product tokens and primitive patterns are shown visually here. Bench chrome stays neutral; product samples use the app's actual Tailwind tokens."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <FoundationPanel
          id="ds-foundation-typography"
          title="Typography"
          preview={
            <ProductPreview>
              <div className="grid gap-3 bg-background text-foreground">
                <p className="border border-line bg-surface px-3 py-2 text-sm font-bold text-foreground">
                  Font family: IBM Plex Sans
                </p>
                <p className="text-sm font-bold text-muted-readable">
                  Private behavior ledger
                </p>
                <h2 className="text-4xl font-bold leading-tight">
                  Timeline
                </h2>
                <p className="max-w-prose text-base leading-7 text-muted-readable">
                  Thursday, June 11
                </p>
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-font-scale"
          title="Font scale"
          preview={
            <ProductPreview>
              <div className="grid gap-3 bg-background text-foreground">
                <p className="text-4xl font-bold leading-tight">Display 30</p>
                <p className="text-3xl font-bold leading-tight">Heading 24</p>
                <p className="text-2xl font-bold leading-tight">Section 20</p>
                <p className="text-base leading-7">Body 14 with open leading</p>
                <p className="text-sm font-bold text-muted-readable">
                  Label 12
                </p>
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-color"
          title="Color"
          preview={
            <ProductPreview>
              <div className="grid gap-3 sm:grid-cols-2">
                <Swatch name="Background" className="bg-background text-foreground" />
                <Swatch name="Surface" className="bg-surface text-foreground" />
                <Swatch name="Foreground" className="bg-foreground text-background" />
                <Swatch
                  name="Primary"
                  className="bg-primary text-primary-foreground"
                />
                <Swatch name="Accent" className="bg-accent text-background" />
                <Swatch name="Calendar overlap border" className="border border-[var(--calendar-overlap)] text-foreground" />
                <Swatch
                  name="Readable muted"
                  className="bg-background text-muted-readable"
                />
                <Swatch
                  name="Timeline row hover"
                  className="bg-timeline-row-hover text-foreground"
                />
                <Swatch
                  name="Needs decision hover"
                  className="bg-timeline-needs-decision-hover text-foreground"
                />
                <Swatch
                  name="Completed row hover"
                  className="bg-timeline-completed-hover text-primary-foreground"
                />
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-spacing"
          title="Spacing"
          preview={
            <ProductPreview>
              <div className="grid gap-4 bg-background text-foreground">
                {[8, 16, 24, 40, 64].map((size) => (
                  <div key={size} className="flex items-center gap-3">
                    <span className="w-12 text-sm font-bold">{size}px</span>
                    <span
                      className="block h-4 bg-primary"
                      style={{ width: `${size * 2}px` }}
                    />
                  </div>
                ))}
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-radius"
          title="Radius"
          preview={
            <ProductPreview>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="border-y border-line bg-background py-4 text-sm font-bold">
                  0px card
                </div>
                <button
                  type="button"
                  className="product-action product-action-primary w-fit py-3 text-sm font-bold"
                >
                  0px text button
                </button>
                <label className="grid gap-1 text-sm">
                  <span>0px line field</span>
                  <input
                    aria-label="Square line input sample"
                    defaultValue="0px input"
                    className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
                  />
                </label>
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-border"
          title="Border"
          preview={
            <ProductPreview>
              <div className="grid bg-background text-foreground">
                <div className="border-t border-line py-3 text-sm">
                  Single-line divider
                </div>
                <div className="border-t border-line py-3 text-sm font-bold">
                  Avoid perimeter boxes unless the control needs enclosure
                </div>
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-shadow"
          title="Shadow"
          preview={
            <ProductPreview>
              <div className="border-t border-line bg-background pt-4 text-sm leading-6 text-muted-readable shadow-none">
                Elevation is intentionally flat: borders, spacing, and fills
                carry hierarchy.
              </div>
            </ProductPreview>
          }
        />

        <FoundationPanel
          id="ds-foundation-motion"
          title="Motion"
          preview={
            <ProductPreview>
              <button
                type="button"
                className="product-action product-action-primary py-3 text-sm font-bold duration-200 motion-reduce:transition-none"
              >
                200ms state transition
              </button>
            </ProductPreview>
          }
        />
      </div>

      <section id="ds-primitives" className="grid gap-4">
        <SectionHeading
          eyebrow="Required coverage"
          title="Primitive patterns"
          description="The app does not have primitive component files yet, so this section shows the current product classes used for common controls. Status labels live inside product modules rather than a standalone primitive."
        />
        <ProductPreview>
          <div className="grid gap-5 bg-background text-foreground">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="product-action product-action-primary min-h-11 py-2 text-sm font-bold"
              >
                Primary
              </button>
              <button
                type="button"
                className="product-action product-action-secondary min-h-11 py-2 text-sm font-bold"
              >
                Secondary
              </button>
              <button
                type="button"
                className="product-action product-action-danger min-h-11 py-2 text-sm font-bold"
              >
                Danger
              </button>
              <button
                type="button"
                disabled
                className="product-action product-action-secondary min-h-11 py-2 text-sm font-bold"
              >
                Disabled
              </button>
            </div>

            <details className="border-t border-line pt-3">
              <summary className="product-disclosure-trigger flex min-h-11 items-center text-base text-foreground">
                <span
                  aria-hidden="true"
                  className="product-disclosure-indicator"
                />
                <span className="product-disclosure-trigger-label">
                  Disclosure trigger
                </span>
              </summary>
              <div className="grid gap-1 pt-4 text-sm leading-6 text-muted-readable">
                <p>Content starts on the same flat surface.</p>
                <p>Use this for hide/show sections and drawer-like detail areas.</p>
              </div>
            </details>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span>Line input</span>
                <input
                  aria-label="Primitive line input sample"
                  defaultValue="Evening reset"
                  className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Line select</span>
                <select
                  aria-label="Primitive line select sample"
                  defaultValue="daily"
                  className="min-h-8 border-0 border-b border-line bg-background px-0 py-1 text-sm text-foreground"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>

            <div className="grid gap-2 border-t border-line pt-4">
              <label className="grid gap-1 text-sm">
                <span>Enclosed note field</span>
                <textarea
                  aria-label="Primitive enclosed note field sample"
                  defaultValue="Enclosure is reserved for longer text, confirmation fields, and controls that need a clear boundary."
                  className="min-h-24 border border-line bg-background px-3 py-2 text-base text-foreground"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <article className="border-y border-line bg-background py-4">
                <h3 className="text-lg font-bold">Card surface</h3>
                <p className="mt-2 text-sm leading-6 text-muted-readable">
                  Square, flat, and structured by spacing and single rules.
                </p>
              </article>
              <div className="bg-background p-4">
                <h3 className="text-lg font-bold">Overlay panel</h3>
                <p className="mt-2 text-sm leading-6 text-muted-readable">
                  Modal vocabulary uses the same white product surface.
                </p>
              </div>
            </div>

            <a
              href="/timeline"
              className="product-action product-action-primary w-fit text-sm font-bold"
            >
              Product link
            </a>
          </div>
        </ProductPreview>
      </section>
    </section>
  );
}

function SurfaceModel() {
  return (
    <section id="bench-surface-model" className="grid gap-4">
      <SectionHeading
        eyebrow="Global model"
        title="Surfaces"
        description={surfaceCatalog.summary}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {surfaceCatalog.surfaces.map((surface) => (
          <article
            key={surface.id}
            id={`bench-surface-${surface.id}`}
            className="grid gap-4 border border-neutral-300 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-xl font-semibold tracking-normal text-neutral-950">
                  {surface.name}
                </h3>
                <p className="mt-1 text-sm text-neutral-600">{surface.runtime}</p>
              </div>
              <span className="border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-600">
                {surface.status}
              </span>
            </div>

            <dl className="grid gap-2 text-sm text-neutral-700">
              <div>
                <dt className="font-semibold text-neutral-950">Source roots</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {surface.sourceRoots.map((root) => (
                    <code
                      key={root}
                      className="border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs"
                    >
                      {root}
                    </code>
                  ))}
                </dd>
              </div>
              <SurfaceFact label="Native bench" value={surface.nativeBench ?? "None yet"} />
              <SurfaceFact label="Inventory" value={surface.inventory ?? "None yet"} />
            </dl>

            <p className="text-sm leading-6 text-neutral-600">{surface.notes}</p>
          </article>
        ))}
      </div>

      <details className="border border-neutral-300 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-800">
          Cross-surface rules
        </summary>
        <ul className="grid gap-2 border-t border-neutral-300 p-4 text-sm leading-6 text-neutral-700">
          {surfaceCatalog.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function SurfaceFact({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div>
      <dt className="font-semibold text-neutral-950">{label}</dt>
      <dd className="mt-1 break-words text-neutral-700">{value}</dd>
    </div>
  );
}

function CanonicalInventory() {
  const grouped = groupComponentFamilies(surfaceCatalog.componentFamilies);

  return (
    <section id="bench-canonical-inventory" className="grid gap-5">
      <SectionHeading
        eyebrow="Global inventory"
        title="Canonical component families"
        description="These families are runtime-agnostic contracts. The web app can link to live React trace cards; other surfaces can satisfy the same contract with Astro templates, native components, generated token outputs, or planned implementation notes."
      />

      {grouped.map(([tier, families]) => (
        <section key={tier} className="grid gap-3">
          <h3 className="border-b border-neutral-400 pb-2 text-lg font-semibold capitalize tracking-normal text-neutral-950">
            {tier}
          </h3>
          <div className="grid gap-4">
            {families.map((family) => (
              <ComponentFamilyCard key={family.id} family={family} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function ComponentFamilyCard({
  family,
}: Readonly<{
  family: ComponentFamily;
}>) {
  return (
    <article
      id={`bench-canonical-${slugifyFamilyId(family.id)}`}
      data-ds-family-id={family.id}
      className="grid gap-4 border border-neutral-300 bg-white p-4"
    >
      <div className="grid gap-2">
        <p className="font-mono text-xs text-neutral-500">{family.id}</p>
        <h4 className="text-xl font-semibold tracking-normal text-neutral-950">
          {family.name}
        </h4>
        <p className="max-w-4xl text-sm leading-6 text-neutral-600">
          {family.definition}
        </p>
      </div>

      <div className="grid gap-2">
        <h5 className="text-sm font-semibold text-neutral-950">Shared contract</h5>
        <ul className="grid gap-1 text-sm leading-6 text-neutral-700 sm:grid-cols-2">
          {family.sharedContract.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="border-b border-neutral-300 px-3 py-2 font-semibold">
                Surface
              </th>
              <th className="border-b border-neutral-300 px-3 py-2 font-semibold">
                State
              </th>
              <th className="border-b border-neutral-300 px-3 py-2 font-semibold">
                Implementation
              </th>
              <th className="border-b border-neutral-300 px-3 py-2 font-semibold">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {surfaceCatalog.surfaces.map((surface) => {
              const implementation = implementationForSurface(family, surface.id);

              return (
                <tr key={surface.id} className="align-top">
                  <th className="border-b border-neutral-200 px-3 py-3 font-semibold text-neutral-950">
                    <a
                      href={`#bench-surface-${surface.id}`}
                      className="underline decoration-neutral-400 underline-offset-4 hover:decoration-neutral-950"
                    >
                      {surface.name}
                    </a>
                  </th>
                  <td className="border-b border-neutral-200 px-3 py-3 text-neutral-700">
                    {implementation ? (
                      <span>
                        {implementation.status}
                        <span className="text-neutral-400"> · </span>
                        {implementation.parity}
                      </span>
                    ) : (
                      "Unmapped"
                    )}
                  </td>
                  <td className="border-b border-neutral-200 px-3 py-3">
                    {implementation ? (
                      <ImplementationSources implementation={implementation} />
                    ) : (
                      <span className="text-neutral-500">No mapping yet</span>
                    )}
                  </td>
                  <td className="border-b border-neutral-200 px-3 py-3 leading-6 text-neutral-600">
                    {implementation?.notes ?? "Add a surface implementation mapping when this surface starts."}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ImplementationSources({
  implementation,
}: Readonly<{
  implementation: SurfaceImplementation;
}>) {
  return (
    <div className="grid gap-2">
      {implementation.implementationIds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {implementation.implementationIds.map((id) => {
            const entry = manifestById.get(id);
            const anchor = entry ? anchorFragment(entry.benchAnchor) : null;

            return anchor ? (
              <a
                key={id}
                href={`#${anchor}`}
                className="border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-800 underline decoration-neutral-400 underline-offset-4 hover:bg-neutral-200 hover:decoration-neutral-950"
              >
                {id}
              </a>
            ) : (
              <code
                key={id}
                className="border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-xs text-amber-900"
              >
                {id}
              </code>
            );
          })}
        </div>
      ) : null}

      {implementation.sources.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {implementation.sources.map((source) => (
            <code
              key={source}
              className="border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-700"
            >
              {source}
            </code>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>) {
  return (
    <header className="grid gap-1 border border-neutral-300 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-semibold tracking-normal text-neutral-950">
        {title}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-neutral-600">
        {description}
      </p>
    </header>
  );
}

function FoundationPanel({
  id,
  title,
  preview,
}: Readonly<{
  id: string;
  title: string;
  preview: ReactNode;
}>) {
  return (
    <article id={id} className="grid gap-3 border border-neutral-300 bg-white p-4">
      <h3 className="text-base font-semibold tracking-normal text-neutral-950">
        {title}
      </h3>
      {preview}
    </article>
  );
}

function Swatch({
  name,
  className,
}: Readonly<{
  name: string;
  className: string;
}>) {
  return (
    <div className={["border border-line p-4 text-sm font-bold", className].join(" ")}>
      {name}
    </div>
  );
}

function TraceInventory({
  usageByComponent,
  previews,
}: Readonly<{
  usageByComponent: Map<string, UsageEntry[]>;
  previews: Record<string, ReactNode>;
}>) {
  const grouped = groupManifestEntries(manifest.components);

  return (
    <section id="bench-traces" className="grid gap-5">
      <SectionHeading
        eyebrow="Inventory"
        title="Trace cards"
        description="Each tracked item shows source ownership, fixture preview coverage, and product usage locations. Usage drawers are closed by default."
      />

      {grouped.map(([kind, entries]) => (
        <section key={kind} className="grid gap-3">
          <h3 className="border-b border-neutral-400 pb-2 text-lg font-semibold capitalize tracking-normal text-neutral-950">
            {kind}
          </h3>
          <div className="grid gap-4">
            {entries.map((entry) => (
              <TraceCard
                key={entry.id}
                entry={entry}
                usages={usageByComponent.get(entry.id) ?? []}
                preview={previews[entry.id]}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function TraceCard({
  entry,
  usages,
  preview,
}: Readonly<{
  entry: ManifestEntry;
  usages: UsageEntry[];
  preview: ReactNode;
}>) {
  const anchor = anchorFragment(entry.benchAnchor);
  const hasPreviewFactory = entry.id in previewFactories;
  const hasRenderedPreview = Boolean(preview);
  const needsVisibleStatus = !hasPreviewFactory || usages.length === 0;

  return (
    <article
      id={anchor}
      data-ds-id={entry.id}
      data-ds-status={hasPreviewFactory ? "covered" : "missing-preview"}
      className="grid gap-4 border border-neutral-300 bg-white p-4"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="break-words text-xl font-semibold tracking-normal text-neutral-950">
              {entry.name}
            </h4>
            {needsVisibleStatus ? (
              <span className="border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                {!hasPreviewFactory ? "Missing preview" : "Unused"}
              </span>
            ) : null}
          </div>
          <p className="mt-2 break-words text-sm text-neutral-600">
            {entry.source} · export {entry.exportName}
          </p>
          {entry.notes ? (
            <p className="mt-2 text-sm leading-6 text-neutral-600">{entry.notes}</p>
          ) : null}
        </div>

        <p className="border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-800">
          {usages.length} product {usages.length === 1 ? "usage" : "usages"}
        </p>
      </div>

      {hasRenderedPreview ? (
        <>
          {preview}
          <a
            href={`#${anchor}`}
            className="w-fit border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-200"
          >
            Close preview
          </a>
        </>
      ) : hasPreviewFactory ? (
        <a
          href={`?preview=${encodeURIComponent(entry.id)}#${anchor}`}
          className="w-fit border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-200"
        >
          Render preview
        </a>
      ) : null}

      <details className="border border-neutral-300 bg-neutral-50">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-neutral-800">
          Usage locations
        </summary>
        <div className="border-t border-neutral-300 p-3">
          {usages.length === 0 ? (
            <p className="text-sm text-neutral-600">No product usages found.</p>
          ) : (
            <ul className="grid gap-2 text-sm text-neutral-700">
              {usages.map((item) => (
                <li key={`${item.file}:${item.line}:${item.usageKind}`}>
                  <code className="font-mono">
                    {item.file}:{item.line}
                  </code>
                  <span> · {item.route ?? "component"} · {item.confidence}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </article>
  );
}

function ProductPreview({
  children,
  maxHeight = "44rem",
}: Readonly<{
  children: ReactNode;
  maxHeight?: string;
}>) {
  return (
    <div
      className="relative overflow-auto border border-neutral-300 bg-white p-3"
      style={{
        contain: "layout paint",
        maxHeight,
        transform: "translateZ(0)",
      }}
    >
      <div
        className="bg-background text-foreground"
        style={{
          fontFamily:
            'var(--font-ibm-plex-sans), "IBM Plex Sans", Arial, Helvetica, sans-serif',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function buildPreviews(
  selectedPreviewId: string | null,
  selectedFixtureState: string | null,
): Record<string, ReactNode> {
  if (!selectedPreviewId) {
    return {};
  }

  const factory = previewFactories[selectedPreviewId];

  if (!factory) {
    return {};
  }

  return {
    [selectedPreviewId]: factory(selectedFixtureState),
  };
}

const behaviorAction: BehaviorFormAction = benchBehaviorAction;
const occurrenceAction: OccurrenceFormAction = benchOccurrenceAction;
const noteShortcutFixture: NoteShortcut[] = [{
  key: "morning-walk-shortcut",
  text: "Took a shorter walk.",
  status: "accepted",
  source: "repeated_text",
  evidence: [],
  created_at: "2026-09-07T00:00:00Z",
  expires_at: null,
}];
const noteShortcutViewFixture: NoteShortcutView = {
  state: {
    id: "bench-note-shortcuts",
    user_id: "bench-user",
    behavior_id: "bench-behavior",
    enabled: true,
    entries: noteShortcutFixture,
    excluded_occurrence_ids: [],
    revision: 1,
    updated_at: "2026-09-07T00:00:00Z",
  },
  globalEnabled: true,
  available: true,
  entries: noteShortcutFixture,
};
const noteShortcutAction: NoteShortcutAction = async () => ({
  status: "success",
  message: "Note shortcut saved.",
  view: noteShortcutViewFixture,
});
const timeTrackingAction: TimeTrackingFormAction = benchTimeTrackingAction;
const timezoneAction: TimezoneUpdateAction = benchTimezoneAction;
const deleteAccountAction: DeleteAccountAction = benchDeleteAccountAction;
const behaviorLogImportAction: BehaviorLogImportFormAction =
  benchBehaviorLogImportAction;
const behaviorLogRestoreAction: BehaviorLogRestoreFormAction =
  benchBehaviorLogRestoreAction;

const previewFactories: Record<
  string,
  (fixtureState: string | null) => ReactNode
> = {
  "navigation.primary-app-nav": () => (
    <ProductPreview maxHeight="38rem">
      <div className="grid gap-5 bg-background text-foreground xl:grid-cols-[16rem_4rem_minmax(18rem,1fr)]">
        <section aria-label="Expanded desktop navigation" className="grid gap-2">
          <p className="text-sm text-muted-readable">Expanded desktop</p>
          <nav
            aria-label="Primary route registry expanded"
            className="flex h-[22rem] w-64 flex-col overflow-hidden border-r border-line bg-card"
          >
            <div className="relative grid h-16 grid-cols-[4rem_1fr] items-center">
              <a
                href="/timeline"
                className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center text-left transition-opacity duration-150 ease-out hover:opacity-70"
              >
                <span className="flex h-16 w-16 items-center justify-center">
                  <Image
                    src="/brand/cadence-logo.png"
                    alt=""
                    aria-hidden="true"
                    width={24}
                    height={24}
                    sizes="24px"
                    className="h-6 w-6 object-contain"
                  />
                </span>
                <span className="min-w-0 pr-12">
                  <span className="block truncate text-lg">Cadence</span>
                </span>
              </a>
              <button
                type="button"
                aria-label="Collapse navigation"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center hover:bg-surface"
              >
                <PanelLeftClose
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={2}
                />
              </button>
            </div>

            <div className="flex flex-1 flex-col py-3">
              {APP_NAV_ITEMS.map((item, index) => {
                const Icon = navIcons[item.href];
                const isActive = index === 0;

                return (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "group flex h-10 w-full items-center overflow-hidden text-sm transition-colors",
                      isActive
                        ? "bg-timeline-row-hover text-foreground"
                        : "text-muted-foreground hover:bg-surface hover:text-foreground",
                    ].join(" ")}
                  >
                    <span className="flex h-10 w-16 shrink-0 items-center justify-center">
                      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 overflow-hidden whitespace-nowrap">
                      {item.label}
                    </span>
                  </a>
                );
              })}
            </div>

            <a
              href="/settings"
              className="group flex h-[60px] w-full items-center overflow-hidden border-t border-line text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <span className="flex h-[60px] w-16 shrink-0 items-center justify-center">
                <span className="flex h-8 w-8 items-center justify-center border border-line bg-background text-xs text-foreground">
                  A
                </span>
              </span>
              <span className="min-w-0 truncate">Account</span>
            </a>
          </nav>
        </section>

        <section aria-label="Collapsed desktop navigation" className="grid gap-2">
          <p className="text-sm text-muted-readable">Collapsed</p>
          <nav
            aria-label="Primary route registry collapsed"
            className="flex h-[22rem] w-16 flex-col overflow-hidden border-r border-line bg-card"
          >
            <button
              type="button"
              aria-label="Expand navigation"
              title="Expand navigation"
              className="group relative flex h-16 w-16 items-center justify-center transition-opacity duration-150 ease-out hover:opacity-70"
            >
              <Image
                src="/brand/cadence-logo.png"
                alt=""
                aria-hidden="true"
                width={24}
                height={24}
                sizes="24px"
                className="h-6 w-6 object-contain transition-opacity duration-200 group-hover:opacity-0"
              />
              <PanelLeftOpen
                aria-hidden="true"
                className="absolute h-4 w-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                strokeWidth={2}
              />
            </button>
            <div className="flex flex-1 flex-col py-3">
              {APP_NAV_ITEMS.map((item, index) => {
                const Icon = navIcons[item.href];
                const isActive = index === 0;

                return (
                  <a
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className="group flex h-10 w-full items-center overflow-hidden text-sm text-muted-foreground transition-colors"
                  >
                    <span
                      className={[
                        "flex h-10 w-16 shrink-0 items-center justify-center transition-colors group-hover:bg-surface group-hover:text-foreground",
                        isActive ? "bg-timeline-row-hover text-foreground" : "",
                      ].join(" ")}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                    </span>
                  </a>
                );
              })}
            </div>
          </nav>
        </section>

        <section aria-label="Mobile navigation" className="grid gap-2">
          <p className="text-sm text-muted-readable">Mobile header and drawer</p>
          <div className="grid overflow-hidden border border-line bg-background">
            <header className="relative grid h-16 grid-cols-[minmax(0,1fr)_4rem] bg-card">
              <a
                href="/timeline"
                className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center transition-opacity duration-150 ease-out hover:opacity-70"
              >
                <span className="flex h-16 w-16 items-center justify-center">
                  <Image
                    src="/brand/cadence-logo.png"
                    alt=""
                    aria-hidden="true"
                    width={24}
                    height={24}
                    sizes="24px"
                    className="h-6 w-6 object-contain"
                  />
                </span>
                <span className="truncate text-lg">Cadence</span>
              </a>
              <button
                type="button"
                aria-label="Open navigation"
                className="flex h-16 w-16 items-center justify-center hover:bg-surface"
              >
                <Menu aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              </button>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line"
              />
            </header>

            <div className="grid min-h-56 grid-cols-[60%_1fr] bg-foreground/10">
              <nav
                aria-label="Mobile drawer route registry"
                className="flex flex-col overflow-hidden border-r border-line bg-card shadow-lg"
              >
                <div className="grid h-16 grid-cols-[minmax(0,1fr)_3.5rem] items-center">
                  <a
                    href="/timeline"
                    className="grid h-16 min-w-0 grid-cols-[4rem_1fr] items-center transition-opacity duration-150 ease-out hover:opacity-70"
                  >
                    <span className="flex h-16 w-16 items-center justify-center">
                      <Image
                        src="/brand/cadence-logo.png"
                        alt=""
                        aria-hidden="true"
                        width={24}
                        height={24}
                        sizes="24px"
                        className="h-6 w-6 object-contain"
                      />
                    </span>
                    <span className="truncate pr-3 text-lg">Cadence</span>
                  </a>
                </div>
                <div className="flex flex-1 flex-col py-3">
                  {APP_NAV_ITEMS.map((item, index) => {
                    const Icon = navIcons[item.href];
                    const isActive = index === 0;

                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={[
                          "flex h-10 w-full items-center overflow-hidden text-sm transition-colors",
                          isActive
                            ? "bg-timeline-row-hover text-foreground"
                            : "text-muted-foreground hover:bg-surface hover:text-foreground",
                        ].join(" ")}
                      >
                        <span className="flex h-10 w-16 shrink-0 items-center justify-center">
                          <Icon
                            aria-hidden="true"
                            className="h-4 w-4"
                            strokeWidth={2}
                          />
                        </span>
                        <span className="min-w-0 truncate whitespace-nowrap">
                          {item.label}
                        </span>
                      </a>
                    );
                  })}
                </div>
              </nav>
              <div aria-hidden="true" />
            </div>
          </div>
        </section>
      </div>
    </ProductPreview>
  ),
  "layout.app-shell": () => (
      <ProductPreview maxHeight="38rem">
        <AppShell>
          <div className="p-6">
            <section className="border-y border-line bg-background py-5">
              <h2 className="text-2xl font-bold">App shell preview</h2>
              <p className="mt-2 text-sm leading-6 text-muted-readable">
                Sidebar, expanded-state brand Timeline links, the collapsed
                expand-only affordance, mobile navigation, and the scroll-faded
                mobile header divider render from the live shell.
              </p>
            </section>
          </div>
        </AppShell>
      </ProductPreview>
    ),
  "layout.cadence-page-banner": () => (
      <ProductPreview>
        <CadencePageBanner />
      </ProductPreview>
    ),
  "layout.screen-frame": () => (
      <ProductPreview>
        <ScreenFrame
          title="Screen frame"
          description="Shared route frame for protected product screens."
        >
          <div className="border-t border-line pt-5 text-sm leading-6 text-muted-readable">
            Screen content sits below a consistent title and description.
          </div>
          <div className="mt-6">
            <ScreenContentLoading label="Loading screen frame preview" />
          </div>
        </ScreenFrame>
      </ProductPreview>
    ),
  "flow.google-login-button": () => (
      <ProductPreview>
        <GoogleLoginButton disabled nextPath="/timeline" />
      </ProductPreview>
    ),
  "flow.first-run-onboarding-panel": () => (
      <ProductPreview maxHeight="28rem">
        <div className="relative min-h-[24rem] bg-background">
          <FirstRunOnboardingPanel
            onboarding={onboardingFixture}
            storageKey="cadence-first-run-bench-dismissed"
          />
        </div>
      </ProductPreview>
    ),
  "flow.account-deletion-panel": () => (
      <ProductPreview>
        <AccountDeletionPanel
          confirmationLabel="DELETE"
          deleteAccountAction={deleteAccountAction}
        />
      </ProductPreview>
    ),
  "module.google-calendar-panel": () => <ProductPreview><CalendarSettingsBench /></ProductPreview>,
  "module.travel-settings-panel": () => <ProductPreview><TravelSettingsBench /></ProductPreview>,
  "module.daily-brief-bubble": () => <ProductPreview><DailyBriefBubbleBench /></ProductPreview>,
  "module.daily-brief-settings-panel": () => <ProductPreview><DailyBriefSettingsBench /></ProductPreview>,
  "composite.external-event-details": () => <ProductPreview><CalendarDetailsBench /></ProductPreview>,
  "composite.external-event-preview": () => <ProductPreview><CalendarDetailsBench preview /></ProductPreview>,
  "module.day-progress-timeline": () => <ProductPreview maxHeight="48rem"><CalendarTimelineBench /></ProductPreview>,
  "module.timeline": () => (
      <ProductPreview maxHeight="48rem">
        <Timeline
          timeline={timelineFixture}
          statusAction={occurrenceAction}
          noteAction={occurrenceAction}
          startTimeTrackingAction={timeTrackingAction}
          stopTimeTrackingAction={timeTrackingAction}
          resetTimeTrackingAction={timeTrackingAction}
        />
      </ProductPreview>
    ),
  "module.mobile-timeline-pull-to-refresh": () => (
      <ProductPreview maxHeight="32rem">
        <MobileTimelinePullToRefresh>
          <TimelineGroup
            section={todaySection}
            statusAction={occurrenceAction}
            noteAction={occurrenceAction}
            startTimeTrackingAction={timeTrackingAction}
            stopTimeTrackingAction={timeTrackingAction}
            resetTimeTrackingAction={timeTrackingAction}
          />
        </MobileTimelinePullToRefresh>
      </ProductPreview>
    ),
  "module.timeline-group": () => (
      <ProductPreview>
        <TimelineGroup
          section={todaySection}
          statusAction={occurrenceAction}
          noteAction={occurrenceAction}
          startTimeTrackingAction={timeTrackingAction}
          stopTimeTrackingAction={timeTrackingAction}
          resetTimeTrackingAction={timeTrackingAction}
        />
      </ProductPreview>
    ),
  "composite.occurrence-row": () => (
      <ProductPreview>
        <div className="grid gap-3">
          {[needsDecisionOccurrence, completedOccurrence, notCompletedOccurrence].map(
            (occurrence) => (
              <OccurrenceRow
                key={occurrence.id}
                occurrence={occurrence}
                statusAction={occurrenceAction}
                noteAction={occurrenceAction}
                startTimeTrackingAction={timeTrackingAction}
                stopTimeTrackingAction={timeTrackingAction}
                resetTimeTrackingAction={timeTrackingAction}
              />
            ),
          )}
        </div>
      </ProductPreview>
    ),
  "module.status-buttons": () => (
      <ProductPreview>
        <StatusButtons
          occurrenceId="bench-occurrence-current"
          currentStatus="unresolved"
          action={occurrenceAction}
        />
      </ProductPreview>
    ),
  "module.time-tracker": () => (
      <ProductPreview>
        <div className="grid gap-3">
          <div
            className="timeline-occurrence-row bg-timeline-row-hover p-4"
            data-visual-tone="default"
          >
            <TimeTracker
              occurrenceId="bench-time-default"
              tracking={{ recordedSeconds: 0, runningStartedAt: null }}
              canStart
              startAction={timeTrackingAction}
              stopAction={timeTrackingAction}
              resetAction={timeTrackingAction}
            />
          </div>
          <div
            className="timeline-occurrence-row bg-timeline-completed-hover p-4"
            data-visual-tone="completed"
          >
            <TimeTracker
              occurrenceId="bench-time-completed"
              tracking={{
                recordedSeconds: 65,
                runningStartedAt: "2099-01-01T00:00:00Z",
              }}
              canStart
              startAction={timeTrackingAction}
              stopAction={timeTrackingAction}
              resetAction={timeTrackingAction}
            />
          </div>
          <div
            className="timeline-occurrence-row bg-accent p-4"
            data-visual-tone="not_completed"
          >
            <TimeTracker
              occurrenceId="bench-time-not-completed"
              tracking={{ recordedSeconds: 65, runningStartedAt: null }}
              canStart
              startAction={timeTrackingAction}
              stopAction={timeTrackingAction}
              resetAction={timeTrackingAction}
            />
          </div>
        </div>
      </ProductPreview>
    ),
  "composite.occurrence-note-form": () => (
      <ProductPreview>
        <OccurrenceNoteForm
          occurrenceId="bench-occurrence-note"
          note="Slept poorly, but completed the evening reset."
          action={occurrenceAction}
          shortcuts={noteShortcutFixture}
        />
      </ProductPreview>
    ),
  "module.note-shortcut-controls": () => (
      <ProductPreview>
        <NoteShortcutSettings behaviorId="bench-behavior" view={noteShortcutViewFixture} action={noteShortcutAction} />
      </ProductPreview>
    ),
  "module.needs-decision-dialog": () => (
      <ProductPreview maxHeight="24rem">
        <NeedsDecisionDialog title="Needs decision" occurrenceCount={1}>
          <TimelineGroup
            section={needsDecisionSection}
            statusAction={occurrenceAction}
            noteAction={occurrenceAction}
            startTimeTrackingAction={timeTrackingAction}
            stopTimeTrackingAction={timeTrackingAction}
            resetTimeTrackingAction={timeTrackingAction}
            variant="needsDecisionDialog"
          />
          <TimelineGroup
            section={retainedNeedsDecisionSection}
            statusAction={occurrenceAction}
            noteAction={occurrenceAction}
            startTimeTrackingAction={timeTrackingAction}
            stopTimeTrackingAction={timeTrackingAction}
            resetTimeTrackingAction={timeTrackingAction}
            variant="needsDecisionDialog"
          />
        </NeedsDecisionDialog>
      </ProductPreview>
    ),
  "module.behavior-create-section": () => (
      <ProductPreview maxHeight="48rem">
        <BehaviorCreateSection
          action={behaviorAction}
          categories={categoryOptions}
          defaultTimezone="America/New_York"
          defaultOpen
        />
      </ProductPreview>
    ),
  "composite.behavior-form": () => (
      <ProductPreview maxHeight="48rem">
        <BehaviorForm
          mode="create"
          action={behaviorAction}
          categories={categoryOptions}
        />
      </ProductPreview>
    ),
  "module.behavior-list": () => (
      <ProductPreview maxHeight="50rem">
        <BehaviorList
          activeBehaviors={[activeBehavior]}
          archivedBehaviors={[{ ...archivedBehavior, endDate: "2026-06-10", autoArchivedAt: "2026-06-10T04:00:00Z" }]}
          categories={categoryOptions}
          analytics={analyticsFixture}
          updateAction={behaviorAction}
          archiveAction={behaviorAction}
          restoreAction={behaviorAction}
          archiveNoteAction={behaviorAction}
          statusAction={occurrenceAction}
          noteAction={occurrenceAction}
          stopTimeTrackingAction={timeTrackingAction}
          resetTimeTrackingAction={timeTrackingAction}
        />
      </ProductPreview>
    ),
  "module.reminder-editor": () => (
      <ProductPreview>
        <ReminderEditor
          browserReminderEnabled
          emailReminderEnabled={false}
          reminderOffsetMinutes={60}
        />
      </ProductPreview>
    ),
  "module.export-range-selector": () => (
      <ProductPreview>
        <ExportRangeSelector
          rangeOptions={exportFixture.rangeOptions}
          selectedRangeKey={exportFixture.range.key}
        />
      </ProductPreview>
    ),
  "module.export-panel": () => (
      <ProductPreview maxHeight="50rem">
        <ExportPanel
          exportData={{ ...exportFixture, markdownSummary: undefined, markdownFileName: undefined }}
          importData={importPageFixture}
          restoreData={restorePageFixture}
          importAction={behaviorLogImportAction}
          restoreAction={behaviorLogRestoreAction}
        />
      </ProductPreview>
    ),
  "module.behavior-log-import-panel": (fixtureState) => (
      <ProductPreview maxHeight="38rem">
        <BehaviorLogImportPanel
          allowNativeReminderConversion
          recentRuns={importPageFixture.recentRuns}
          timezone={exportFixture.timezone}
          action={behaviorLogImportAction}
          initialState={behaviorLogImportStateFixture(fixtureState)}
        />
      </ProductPreview>
    ),
  "module.behavior-log-restore-panel": () => (
      <ProductPreview maxHeight="38rem">
        <BehaviorLogRestorePanel
          allowNativeReminderConversion
          recentRuns={restorePageFixture.recentRuns}
          timezone={exportFixture.timezone}
          action={behaviorLogRestoreAction}
          initialState={behaviorLogRestoreStateFixture}
        />
      </ProductPreview>
    ),
  "module.markdown-summary-actions": () => (
      <ProductPreview>
        <MarkdownSummaryActions
          summary={exportFixture.markdownSummary}
          fileName={exportFixture.markdownFileName}
        />
      </ProductPreview>
    ),
  "module.prompt-library-panel": () => (
      <ProductPreview maxHeight="38rem">
        <PromptLibraryPanel />
      </ProductPreview>
    ),
  "module.prompt-copy-action": () => (
      <ProductPreview>
        <PromptCopyAction
          prompt={EXPORT_PROMPT_TEMPLATES[0].prompt}
          templateTitle={EXPORT_PROMPT_TEMPLATES[0].title}
        />
      </ProductPreview>
    ),
  "module.category-panel": () => (
    <ProductPreview><CategoryPanel categories={[{ id: "health", name: "Health", description: "Movement and rest", sort_order: 0, updated_at: "2026-09-05T00:00:00Z" }]} assignments={[]}
      action={async () => { "use server"; return { status: "error", message: "Preview only. Your draft remains available." }; }} /></ProductPreview>
  ),
  "module.timezone-panel": () => (
      <ProductPreview>
        <TimezonePanel
          currentTimezone="America/New_York"
          updateTimezoneAction={timezoneAction}
        />
      </ProductPreview>
    ),
  "module.notification-permission-panel": () => (
      <ProductPreview>
        <NotificationPermissionPanel vapidPublicKey="" />
      </ProductPreview>
  ),
  "module.trust-and-legal-panel": () => (
      <ProductPreview>
        <TrustAndLegalPanel />
      </ProductPreview>
  ),
  "module.trust-evidence-panel": () => (
      <ProductPreview maxHeight="48rem">
        <TrustEvidencePanel evidence={trustEvidenceFixture} />
      </ProductPreview>
  ),
};

function firstSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function groupUsages(items: UsageEntry[]) {
  const grouped = new Map<string, UsageEntry[]>();

  for (const item of items) {
    const existing = grouped.get(item.componentId) ?? [];
    existing.push(item);
    grouped.set(item.componentId, existing);
  }

  return grouped;
}

function groupManifestEntries(entries: ManifestEntry[]) {
  const grouped = new Map<string, ManifestEntry[]>();

  for (const entry of entries) {
    const existing = grouped.get(entry.kind) ?? [];
    existing.push(entry);
    grouped.set(entry.kind, existing);
  }

  return [...grouped.entries()].sort(
    ([kindA], [kindB]) => kindRank(kindA) - kindRank(kindB),
  );
}

function groupComponentFamilies(entries: ComponentFamily[]) {
  const grouped = new Map<string, ComponentFamily[]>();

  for (const entry of entries) {
    const existing = grouped.get(entry.tier) ?? [];
    existing.push(entry);
    grouped.set(entry.tier, existing);
  }

  return [...grouped.entries()].sort(
    ([tierA], [tierB]) => familyTierRank(tierA) - familyTierRank(tierB),
  );
}

function kindRank(kind: string) {
  const index = kindOrder.indexOf(kind);
  return index === -1 ? kindOrder.length : index;
}

function familyTierRank(tier: string) {
  const index = familyTierOrder.indexOf(tier);
  return index === -1 ? familyTierOrder.length : index;
}

function implementationForSurface(family: ComponentFamily, surfaceId: string) {
  return family.surfaceImplementations.find((item) => item.surfaceId === surfaceId);
}

function anchorFragment(anchor: string) {
  return anchor.split("#", 2)[1] ?? anchor;
}

function slugifyFamilyId(id: string) {
  return id.replaceAll(".", "-");
}

const categoryOptions: CategoryOption[] = [
  { id: "category-health", name: "Health" },
  { id: "category-home", name: "Home" },
  { id: "category-focus", name: "Focus" },
];

const weeklyRecurrenceDefaults: BehaviorRecurrenceFormDefaults = {
  kind: "weekly",
  dailyInterval: 1,
  everyDays: 2,
  weeklyInterval: 1,
  weeklyDays: ["monday", "wednesday", "friday"],
  monthlyInterval: 1,
  monthlyDay: 31,
};

const trustEvidenceFixture: PublicTrustView = {
  schema: "cadence.public-trust-view",
  schema_version: 1,
  feed_state: "live",
  feed_message: null,
  snapshot: {
    id: "20260827T044110Z-1ca208a5b445",
    url: "https://example.com/immutable-evidence",
    source_commit: "1ca208a5b4456a43506316b8d88fa372e6967c5e",
    application_deployment_id: "dpl_application",
    application_deployment_url: "https://cadence-blush-three.vercel.app",
    marketing_deployment_id: "dpl_marketing",
    marketing_deployment_url: "https://cadence-marketing-two.vercel.app",
    workflow_url: "https://github.com/emixd12/cadence/actions/runs/123456789",
    built_at: "2026-08-27T04:35:10Z",
    verified_at: "2026-08-27T04:41:10Z",
    freshness_deadline: "2026-08-28T04:41:10Z",
  },
  checks: ["passed", "failed", "stale", "not_run", "unavailable", "passed", "passed", "failed", "passed"].map((status, index) => ({
    id: ["source_to_deployment_provenance", "production_dependency_vulnerabilities", "code_scanning", "secret_scanning", "public_artifact_integrity", "application_live_route_comparison", "marketing_live_route_comparison", "hosted_migration_boundary", "cross_account_rls_isolation"][index] as PublicTrustView["checks"][number]["id"],
    label: ["Source to deployment provenance", "Production dependency scanning", "Code scanning", "Secret scanning", "Public artifact integrity", "Application routes", "Marketing routes", "Hosted migration boundary", "Cross-account RLS isolation"][index],
    status: status as PublicTrustView["checks"][number]["status"],
    scope: "A bounded public verification scope for the named release.",
    scope_limit: "This result does not establish assurance outside the named scope and time.",
    summary: "Fixture summary for the named public check.",
    unavailable_reason: status === "unavailable" ? "The platform did not expose a safe aggregate result." : null,
    completed_at: ["not_run", "unavailable"].includes(status) ? null : "2026-08-27T04:41:10Z",
    freshness_deadline: ["not_run", "unavailable"].includes(status) ? null : "2026-08-28T04:41:10Z",
    evidence_url: "https://example.com/immutable-evidence",
  })),
};

const onboardingFixture: FirstRunOnboardingState = {
  hasAnyBehavior: false,
  hasImportRuns: false,
  timezone: "America/New_York",
  vapidPublicKey: "",
};

const activeBehavior: BehaviorView = {
  id: "behavior-reset",
  title: "Evening reset",
  description: "Close the day with a short checklist and note anything unusual.",
  categoryId: "category-home",
  categoryName: "Home",
  recurrenceSummary: "Weekly on Mon, Wed, Fri",
  recurrenceDefaults: weeklyRecurrenceDefaults,
  scheduledTime: "21:30",
  scheduledTimeLabel: "9:30 PM",
  scheduleSlots: [
    {
      id: "slot-evening-reset",
      kind: "exact",
      preset: null,
      startTime: "21:30",
      endTime: null,
      sortOrder: 0,
      label: "9:30 PM",
    },
  ],
  scheduleSummary: "9:30 PM",
  timezone: "America/New_York",
  browserReminderEnabled: true,
  emailReminderEnabled: false,
  reminderOffsetMinutes: 60,
  reminderSummary: "Browser notifications, 1 hour before",
  active: true,
  archivedAt: null,
  archiveNotes: [],
  createdAt: "2026-05-01T12:00:00Z",
  updatedAt: "2026-06-08T12:00:00Z",
};

const archivedBehavior: BehaviorView = {
  ...activeBehavior,
  id: "behavior-archived",
  title: "Archive sample",
  description: "Past behavior kept for history.",
  active: false,
  archivedAt: "2026-06-01T12:00:00Z",
  archiveNotes: [
    { id: "11111111-1111-4111-8111-111111111111", archivedAt: "2026-05-15T12:00:00Z", updatedAt: "2026-05-15T12:00:00Z", note: "Program finished." },
    { id: "22222222-2222-4222-8222-222222222222", archivedAt: "2026-06-01T12:00:00Z", updatedAt: "2026-06-01T12:00:00Z", note: "This is now part of my routine." },
  ],
  reminderSummary: "No reminders",
};

const needsDecisionOccurrence: TimelineOccurrenceView = {
  id: "occurrence-prior",
  behaviorId: "behavior-reset",
  title: "Evening reset",
  scheduledFor: "2026-06-07T01:30:00Z",
  scheduledTimeLabel: "9:30 PM",
  localDate: "2026-06-06",
  status: "unresolved",
  statusMarkedAt: null,
  statusLabel: "Unresolved",
  statusDetail: "Awaiting decision",
  expandedStatusActionLabel: "Mark this occurrence",
  visualTone: "needs_decision",
  isVisibleInNeedsDecision: true,
  canShowDecisionActionsWhenUnresolved: true,
  showDecisionActions: true,
  showCollapsedStatusLabel: false,
  description: activeBehavior.description,
  categoryName: activeBehavior.categoryName,
  scheduleSummary: activeBehavior.recurrenceSummary,
  note: "",
  timeTracking: { recordedSeconds: 0, runningStartedAt: null },
  canStartTimeTracking: true,
};

const currentOccurrence: TimelineOccurrenceView = {
  ...needsDecisionOccurrence,
  id: "occurrence-current",
  behaviorId: "behavior-water",
  scheduledFor: "2026-06-08T13:00:00Z",
  scheduledTimeLabel: "Morning",
  localDate: "2026-06-08",
  title: "Drink water",
  visualTone: "default",
  isVisibleInNeedsDecision: false,
  canShowDecisionActionsWhenUnresolved: true,
  showDecisionActions: true,
  description: "Start the morning with one full glass.",
  categoryName: "Health",
  scheduleSummary: "Daily",
  canStartTimeTracking: true,
};

const currentGroupedCompletedOccurrence: TimelineOccurrenceView = {
  ...currentOccurrence,
  id: "occurrence-current-evening",
  scheduledFor: "2026-06-08T22:00:00Z",
  scheduledTimeLabel: "Evening",
  status: "completed",
  statusMarkedAt: "2026-06-08T22:05:00Z",
  statusLabel: "Completed",
  statusDetail: "Resolved as Completed",
  expandedStatusActionLabel: "Change logged action",
  visualTone: "completed",
  showDecisionActions: false,
  showCollapsedStatusLabel: true,
  note: "Finished after work.",
};

const completedOccurrence: TimelineOccurrenceView = {
  ...currentOccurrence,
  id: "occurrence-completed",
  behaviorId: "behavior-walk",
  title: "Walk outside",
  scheduledFor: "2026-06-08T16:00:00Z",
  scheduledTimeLabel: "12:00 PM",
  status: "completed",
  statusMarkedAt: "2026-06-08T16:10:00Z",
  statusLabel: "Completed",
  statusDetail: "Resolved as Completed",
  expandedStatusActionLabel: "Change logged action",
  visualTone: "completed",
  showDecisionActions: false,
  showCollapsedStatusLabel: true,
  note: "Short walk after lunch.",
};

const notCompletedOccurrence: TimelineOccurrenceView = {
  ...currentOccurrence,
  id: "occurrence-not-completed",
  behaviorId: "behavior-desk",
  title: "Desk reset",
  scheduledFor: "2026-06-08T22:00:00Z",
  scheduledTimeLabel: "6:00 PM",
  status: "not_completed",
  statusMarkedAt: "2026-06-08T22:05:00Z",
  statusLabel: "Not Completed",
  statusDetail: "Resolved as Not Completed",
  expandedStatusActionLabel: "Change logged action",
  visualTone: "not_completed",
  showDecisionActions: false,
  showCollapsedStatusLabel: true,
  note: "Skipped while traveling.",
};

const futureOccurrence: TimelineOccurrenceView = {
  ...currentOccurrence,
  id: "occurrence-future",
  title: "Plan tomorrow",
  scheduledFor: "2026-06-10T01:00:00Z",
  scheduledTimeLabel: "9:00 PM",
  localDate: "2026-06-09",
  canShowDecisionActionsWhenUnresolved: false,
  showDecisionActions: false,
  isVisibleInNeedsDecision: false,
};

function toFixtureOccurrenceGroups(occurrences: TimelineOccurrenceView[]) {
  return occurrences.map((occurrence) => ({
    key: `${occurrence.localDate}-${occurrence.id}`,
    behaviorId: occurrence.behaviorId,
    title: occurrence.title,
    occurrences: [occurrence],
    isGroupedStack: false,
  }));
}

const needsDecisionSection: TimelineDaySection = {
  key: "needs-2026-06-06",
  kind: "needs_decision_day",
  localDate: "2026-06-06",
  label: "Saturday, June 6",
  relativeLabel: "Prior unresolved",
  emptyMessage: "No prior unresolved occurrences.",
  occurrences: [needsDecisionOccurrence],
  unresolvedOccurrenceCount: 1,
  occurrenceGroups: toFixtureOccurrenceGroups([needsDecisionOccurrence]),
};

const retainedNeedsDecisionOccurrence: TimelineOccurrenceView = {
  ...completedOccurrence,
  id: "occurrence-prior-completed",
  scheduledFor: "2026-06-06T16:00:00Z",
  localDate: "2026-06-05",
  isVisibleInNeedsDecision: true,
};

const retainedNeedsDecisionSection: TimelineDaySection = {
  key: "needs-2026-06-05",
  kind: "needs_decision_day",
  localDate: "2026-06-05",
  label: "Friday, June 5",
  relativeLabel: "Prior unresolved",
  emptyMessage: "No prior unresolved occurrences.",
  occurrences: [retainedNeedsDecisionOccurrence],
  unresolvedOccurrenceCount: 0,
  occurrenceGroups: toFixtureOccurrenceGroups([
    retainedNeedsDecisionOccurrence,
  ]),
};

const todaySection: TimelineDaySection = {
  key: "today-2026-06-08",
  kind: "today",
  localDate: "2026-06-08",
  label: "Monday, June 8",
  relativeLabel: "Today",
  emptyMessage: "No behaviors on this day.",
  occurrences: [
    currentOccurrence,
    completedOccurrence,
    notCompletedOccurrence,
    currentGroupedCompletedOccurrence,
  ],
  unresolvedOccurrenceCount: 1,
  occurrenceGroups: [
    {
      key: "group-water-2026-06-08",
      behaviorId: "behavior-water",
      title: "Drink water",
      occurrences: [currentOccurrence, currentGroupedCompletedOccurrence],
      isGroupedStack: true,
    },
    ...toFixtureOccurrenceGroups([completedOccurrence, notCompletedOccurrence]),
  ],
};

const futureSection: TimelineDaySection = {
  key: "future-2026-06-09",
  kind: "future",
  localDate: "2026-06-09",
  label: "Tuesday, June 9",
  relativeLabel: "Tomorrow",
  emptyMessage: "No behaviors on this day.",
  occurrences: [futureOccurrence],
  unresolvedOccurrenceCount: 0,
  occurrenceGroups: toFixtureOccurrenceGroups([futureOccurrence]),
};

const timelineFixture: TimelineView = {
  archiveNotifications: [{ behaviorId: "archived-fixture", title: "Course practice", endDate: "2026-06-08" }],
  durationEstimates: {
    "behavior-water": { kind: "known", seconds: 1800, durationLabel: "30m", sampleCount: 0, lookbackDays: 90, provenance: "behavior_default" },
  },
  timezone: "America/New_York",
  todayLocalDate: "2026-06-08",
  visibleFutureDays: 7,
  maxFutureDays: 30,
  nextFutureDays: 14,
  needsDecision: {
    title: "Needs decision",
    emptyMessage: "No prior unresolved occurrences.",
    occurrenceCount: 1,
    daySections: [needsDecisionSection],
  },
  daySections: [todaySection, futureSection],
};

const emptyCounts = {
  completedCount: 0,
  notCompletedCount: 0,
  unresolvedCount: 0,
  resolvedCount: 0,
  totalCount: 0,
};

const analyticsFixture: AnalyticsView = {
  timezone: "America/New_York",
  rangeDays: 30,
  rangeOptions: [7, 30, 90],
  rangeStartLocalDate: "2026-05-10",
  rangeEndLocalDate: "2026-06-08",
  rangeLabel: "Last 30 days",
  summary: {
    completedCount: 18,
    notCompletedCount: 4,
    unresolvedCount: 3,
    resolvedCount: 22,
    totalCount: 25,
    rate: 0.818,
    percentLabel: "82%",
    detailLabel: "18 of 22 resolved occurrences completed",
  },
  overallHeatmap: [
    dayCell("2026-06-02", "Jun 2", "2", "completed", false),
    dayCell("2026-06-03", "Jun 3", "3", "partial", false),
    dayCell("2026-06-04", "Jun 4", "4", "completed", false),
    dayCell("2026-06-05", "Jun 5", "5", "unresolved", false),
    dayCell("2026-06-06", "Jun 6", "6", "empty", false),
    dayCell("2026-06-07", "Jun 7", "7", "completed", false),
    dayCell("2026-06-08", "Jun 8", "8", "not_completed", false),
  ],
  behaviorSummaries: [
    {
      behaviorId: "behavior-reset",
      title: "Evening reset",
      categoryName: "Home",
      completedCount: 8,
      notCompletedCount: 2,
      unresolvedCount: 1,
      resolvedCount: 10,
      totalCount: 11,
      rate: 0.8,
      percentLabel: "80%",
      detailLabel: "8 of 10 resolved",
      trackingStartLocalDate: "2026-06-02",
      trackingStartLabel: "Tuesday, June 2",
      averageTrackedTime: null,
      dailyCells: [
        behaviorCell("2026-06-02", "Jun 2", "2", "full", true),
        behaviorCell("2026-06-03", "Jun 3", "3", "partial"),
        behaviorCell("2026-06-04", "Jun 4", "4", "full"),
        behaviorCell("2026-06-05", "Jun 5", "5", "unresolved"),
        behaviorCell("2026-06-06", "Jun 6", "6", "empty"),
        behaviorCell("2026-06-07", "Jun 7", "7", "full"),
        behaviorCell("2026-06-08", "Jun 8", "8", "not_completed", false, true),
      ],
    },
  ],
  categorySummaries: [
    {
      categoryName: "Home",
      completedCount: 8,
      notCompletedCount: 2,
      unresolvedCount: 1,
      resolvedCount: 10,
      totalCount: 11,
      rate: 0.8,
      percentLabel: "80%",
      detailLabel: "8 of 10 resolved",
    },
    {
      categoryName: "Health",
      completedCount: 10,
      notCompletedCount: 2,
      unresolvedCount: 2,
      resolvedCount: 12,
      totalCount: 14,
      rate: 0.833,
      percentLabel: "83%",
      detailLabel: "10 of 12 resolved",
    },
  ],
  selectedBehaviorDay: {
    behaviorId: "behavior-reset",
    behaviorTitle: "Evening reset",
    localDate: "2026-06-08",
    label: "Monday, June 8",
    occurrences: [
      {
        id: "occurrence-not-completed",
        behaviorId: "behavior-reset",
        title: "Evening reset",
        categoryName: "Home",
        scheduledFor: "2026-06-08T22:00:00Z",
        scheduledTimeLabel: "6:00 PM",
        status: "not_completed",
        statusLabel: "Not Completed",
        note: "Skipped while traveling.",
        trackedTime: null,
      },
    ],
  },
};

const exportReminderOffsetKey = ["reminder", "offset", "minutes"].join(
  "_",
) as keyof ExportBundle["jsonBackup"]["behaviors"][number];

const exportJsonBehaviorFixture = {
  id: "behavior-reset",
  category_id: "category-home",
  category: "Home",
  title: "Evening reset",
  description: activeBehavior.description,
  recurrence_rule: {
    frequency: "weekly",
    interval: 1,
    daysOfWeek: ["monday", "wednesday", "friday"],
  },
  scheduled_time: "21:30",
  schedule_slots: activeBehavior.scheduleSlots,
  timezone: "America/New_York",
  browser_reminder_enabled: true,
  email_reminder_enabled: false,
  [exportReminderOffsetKey]: 60,
  active: true,
  archived_at: null,
} as unknown as ExportBundle["jsonBackup"]["behaviors"][number];

const exportFixture: ExportBundle = {
  timezone: "America/New_York",
  exportedAt: "2026-06-08T21:00:00Z",
  includeArchived: false,
  includeNotes: false,
  includeTimeTracking: false,
  range: {
    key: "30",
    label: "Last 30 days",
    startLocalDate: "2026-05-10",
    endLocalDate: "2026-06-08",
    summaryLabel: "Last 30 days",
  },
  rangeOptions: [
    { key: "7", label: "Last 7 days" },
    { key: "30", label: "Last 30 days" },
    { key: "90", label: "Last 90 days" },
    { key: "all", label: "All time" },
  ],
  categoryCount: 2,
  behaviorCount: 2,
  behaviorConfigurationEventCount: 0,
  occurrenceCount: 4,
  overallCounts: {
    completedCount: 2,
    notCompletedCount: 1,
    unresolvedCount: 1,
    resolvedCount: 3,
    totalCount: 4,
  },
  overallAdherenceLabel: "67%",
  jsonl: "{\"type\":\"behavior\",\"title\":\"Evening reset\"}",
  csv: "behavior_title,status\nEvening reset,completed",
  jsonBackup: {
    exported_at: "2026-06-08T21:00:00Z",
    profile: { timezone: "America/New_York" },
    categories: [
      {
        id: "category-home",
        name: "Home",
        sort_order: 1,
      },
    ],
    behaviors: [
      exportJsonBehaviorFixture,
    ],
    occurrences: [
      {
        id: "occurrence-completed",
        behavior_id: "behavior-reset",
        behavior_schedule_slot_id: "slot-evening-reset",
        behavior_configuration_event_id: null,
        behavior_title: "Evening reset",
        category: "Home",
        scheduled_for: "2026-06-08T16:00:00Z",
        schedule: "9:30 PM",
        schedule_kind: "exact",
        schedule_preset: null,
        schedule_start_time: "21:30",
        schedule_end_time: null,
        local_date: "2026-06-08",
        timezone: "America/New_York",
        status: "completed",
        completed_at: "2026-06-08T16:10:00Z",
        status_marked_at: "2026-06-08T16:10:00Z",
        note: "Short walk after lunch.",
      },
    ],
    status_events: [],
    behavior_definition_events: [],
    behavior_configuration_events: [],
  },
  json: "{\"profile\":{\"timezone\":\"America/New_York\"}}",
  markdownSummary:
    "# Cadence export summary\n\nRange: Last 30 days\n\nDefault adherence: 67%\n\n- Completed: 2\n- Not Completed: 1\n- Unresolved: 1",
  fileBaseName: "cadence-export-2026-06-08",
  markdownFileName: "cadence-summary-2026-06-08.md",
  behaviorLog: {
    fileName: "cadence-export-2026-06-08.behaviorlog.zip",
    files: [
      {
        path: "manifest.json",
        mediaType: "application/json",
        content: "{\"format\":\"behaviorlog.bundle\"}",
      },
      {
        path: "data/status_events.jsonl",
        mediaType: "application/jsonl",
        content:
          "{\"record_type\":\"status_event\",\"status\":\"completed\"}",
      },
    ],
  },
};

const importPageFixture: BehaviorLogImportPageData = {
  recentRuns: [
    {
      id: "import-run-preview",
      import_mode: "merge_preview",
      status: "previewed",
      started_at: "2026-06-08T21:10:00Z",
      completed_at: "2026-06-08T21:10:02Z",
      failure_message: null,
    },
  ],
};

const emptyImportPreviewFixture = resolveBehaviorLogImportMergePreview({
  files: [],
});

const acceptedImportPreviewFixture: BehaviorLogImportMergePreviewResult = {
  ...emptyImportPreviewFixture,
  valid: true,
  summary: {
    ...emptyImportPreviewFixture.summary,
    schemaVersion: "0.1.0-draft",
    fileCount: 8,
    behaviorCount: 1,
    noteCount: 1,
    createCount: 2,
    errorCount: 0,
    warningCount: 1,
  },
  errors: [],
  warnings: [
    {
      severity: "warning",
      code: "high_sensitivity_note_present",
      message:
        "A high-sensitivity note is included. Review it before applying.",
      file: "data/notes.jsonl",
      row: 1,
    },
  ],
  conflicts: [],
  unsupportedFields: [],
  plan: {
    ...emptyImportPreviewFixture.plan,
    behaviors: [
      {
        action: "create",
        skipReasons: [],
        externalId: "bench-behavior",
        title: "Evening reset",
        category: "Home",
        cadenceCategoryName: "Home",
        description: "Reset the kitchen and prepare tomorrow's essentials.",
        createdAtUtc: "2026-06-01T12:00:00Z",
        archivedAtUtc: null,
        cadenceActive: true,
        cadenceBrowserReminderEnabled: true,
        cadenceEmailReminderEnabled: false,
        cadenceReminderOffsetMinutes: 0,
        sourceOriginalId: "bench-behavior",
        sourceConfidence: "high",
      },
    ],
    notes: [
      {
        action: "create",
        skipReasons: [],
        externalId: "bench-note",
        attachedToType: "behavior",
        attachedToId: "bench-behavior",
        bodyMarkdown: "Fixture-only sensitive context.",
        noteRole: "user",
        createdAtUtc: "2026-06-08T21:00:00Z",
        updatedAtUtc: null,
        sensitivity: "high",
        sourceOriginalId: "bench-note",
        sourceCaptureMethod: "manual_text",
        sourceConfidence: "high",
      },
    ],
  },
  mergePreview: {
    ...emptyImportPreviewFixture.mergePreview,
    privacy: {
      profiles: ["core", "notes"],
      redactionLevel: "standard_redaction",
      subjectIdStrategy: "pseudonymous",
      containsNotes: true,
      containsInterventions: false,
      containsRawLocation: false,
      containsHealthData: false,
      containsAiGeneratedContent: false,
    },
    actionCounts: {
      create_new: 2,
      map_to_existing: 0,
      skip_existing: 0,
      conflict_requires_decision: 0,
    },
    conflictCodes: [],
    conflictCount: 0,
    conflicts: [],
    actions: {
      ...emptyImportPreviewFixture.mergePreview.actions,
      behaviors: [
        {
          recordType: "behavior",
          externalId: "bench-behavior",
          action: "create_new",
          localId: null,
          conflictCodes: [],
          reasons: ["No matching local behavior exists."],
        },
      ],
      notes: [
        {
          recordType: "note",
          externalId: "bench-note",
          action: "create_new",
          localId: null,
          conflictCodes: [],
          reasons: ["Stores a passive imported note record."],
          metadata: {
            noteStorageDecision: "create_imported_note_record",
          },
        },
      ],
    },
  },
};

function behaviorLogImportStateFixture(
  fixtureState: string | null,
): BehaviorLogImportActionState {
  const previewRun = {
    id: "bench-import-preview",
    import_mode: "merge_preview" as const,
    status: "previewed" as const,
    started_at: "2026-06-08T21:10:00Z",
    completed_at: "2026-06-08T21:10:02Z",
    failure_message: null,
  };

  if (fixtureState === "invalid") {
    return {
      status: "previewed",
      message: "Preview contains validation errors. Nothing can be applied.",
      upload: {
        fileName: "invalid.behaviorlog.zip",
        fileSize: 481,
      },
      archiveFingerprint: "a".repeat(64),
      preview: emptyImportPreviewFixture,
      previewRun,
      capabilities: {
        canApplyCreateOnly: false,
        createOnlyReason: "Fix validation errors before applying.",
        canApplyMerge: false,
        mergeReason: "Fix validation errors before applying.",
      },
      applyResult: null,
    };
  }

  return {
    status: fixtureState === "stale" ? "error" : "previewed",
    message:
      fixtureState === "stale"
        ? "Local data changed since this import preview. Preview the bundle again before applying."
        : "Accepted preview fixture ready. Review the warning and exact preview binding.",
    upload: {
      fileName: "accepted-preview.behaviorlog.zip",
      fileSize: 2048,
    },
    archiveFingerprint: "b".repeat(64),
    preview: acceptedImportPreviewFixture,
    previewRun,
    capabilities: {
      canApplyCreateOnly: true,
      createOnlyReason: null,
      canApplyMerge: true,
      mergeReason: null,
    },
    applyResult: null,
  };
}

const restorePageFixture: BehaviorLogRestorePageData = {
  recentRuns: [
    {
      id: "restore-run-preview",
      mode: "restore_preview",
      status: "previewed",
      startedAt: "2026-06-08T21:20:00Z",
      completedAt: null,
      failureMessage: null,
    },
  ],
};

const destructiveRestorePreviewFixture: BehaviorLogRestorePreview = {
  mode: "restore_preview",
  valid: true,
  previewFingerprint: "bench-restore-preview-fingerprint",
  localDataFingerprint: "bench-restore-local-fingerprint",
  bundleFingerprint: "bench-restore-bundle-fingerprint",
  statusHistoryPolicy: {
    selected: "preserve_append_only_history",
    default: "preserve_append_only_history",
    available: ["preserve_append_only_history", "replace_status_history"],
    applySupportedInThisTicket: true,
  },
  semantics: {
    jsonlAuthoritative: true,
    csvIgnoredForRestore: true,
    statusEventsAuthoritative: true,
    currentStatusIsSnapshotOnly: true,
    unresolvedIsFailure: false,
    behaviorLogIsNotAccountImage: true,
    providerSideEffects: false,
    reminderDeliverySideEffects: false,
  },
  summary: {
    actionCounts: {
      create: 1,
      replace: 1,
      archive: 1,
      delete: 0,
      keep: 0,
      skip: 0,
    },
    destructiveActionCount: 2,
    createdCount: 1,
    replacedCount: 1,
    archivedCount: 1,
    deletedCount: 0,
    keptCount: 0,
    skippedCount: 0,
    highOrRestrictedNoteCount: 1,
    redactedInterventionFieldCount: 1,
    unsupportedActionCount: 0,
  },
  nonRestorableFields: [
    {
      field: "auth_identity",
      reason: "Authentication identity is managed outside BehaviorLog.",
    },
    {
      field: "push_subscriptions",
      reason: "Push subscriptions belong to the current browser and device.",
    },
  ],
  sensitivity: {
    highOrRestrictedNotesPresent: true,
    noteSensitivities: ["high"],
    redactedInterventionFieldsPresent: true,
  },
  errors: [],
  warnings: [
    {
      severity: "warning",
      code: "high_sensitivity_note_present",
      message: "A high-sensitivity note requires explicit review.",
    },
  ],
  actions: {
    behaviors: [
      {
        recordType: "behavior",
        action: "replace",
        destructive: true,
        externalId: "bench-behavior",
        localId: "bench-behavior",
        reasons: ["The bundle definition differs from the local behavior."],
      },
      {
        recordType: "behavior",
        action: "archive",
        destructive: true,
        externalId: null,
        localId: "bench-local-only-behavior",
        reasons: ["The local behavior is absent from the bundle."],
      },
    ],
    schedules: [],
    occurrences: [],
    statusEvents: [],
    inlineOccurrenceNotes: [],
    importedNotes: [],
    importedInterventions: [
      {
        recordType: "intervention",
        action: "create",
        destructive: false,
        externalId: "bench-intervention",
        localId: null,
        reasons: ["Stores passive history only."],
      },
    ],
  },
};

const behaviorLogRestoreStateFixture: BehaviorLogRestoreActionState = {
  status: "previewed",
  message:
    "Destructive restore fixture ready. The bench will not apply product changes.",
  upload: {
    fileName: "destructive-preview.behaviorlog.zip",
    fileSize: 4096,
  },
  archiveFingerprint: "c".repeat(64),
  preview: destructiveRestorePreviewFixture,
  previewRun: {
    id: "bench-restore-preview",
    mode: "restore_preview",
    status: "previewed",
    startedAt: "2026-06-08T21:20:00Z",
    completedAt: "2026-06-08T21:20:02Z",
    failureMessage: null,
  },
  applyResult: null,
};

function dayCell(
  localDate: string,
  label: string,
  shortLabel: string,
  state: AnalyticsView["overallHeatmap"][number]["state"],
  isSelected: boolean,
) {
  const counts =
    state === "completed"
      ? {
          completedCount: 1,
          notCompletedCount: 0,
          unresolvedCount: 0,
          resolvedCount: 1,
          totalCount: 1,
        }
      : state === "partial"
        ? {
            completedCount: 1,
            notCompletedCount: 1,
            unresolvedCount: 0,
            resolvedCount: 2,
            totalCount: 2,
          }
        : state === "not_completed"
          ? {
              completedCount: 0,
              notCompletedCount: 1,
              unresolvedCount: 0,
              resolvedCount: 1,
              totalCount: 1,
            }
          : state === "unresolved"
            ? {
                completedCount: 0,
                notCompletedCount: 0,
                unresolvedCount: 1,
                resolvedCount: 0,
                totalCount: 1,
              }
            : emptyCounts;

  return {
    key: `overall-${localDate}`,
    localDate,
    label,
    shortLabel,
    isSelected,
    state,
    stateLabel: state,
    completionRate:
      counts.totalCount > 0 && counts.resolvedCount > 0
        ? counts.completedCount / counts.totalCount
        : null,
    counts,
    ariaLabel: `${label}: ${state}`,
  };
}

function behaviorCell(
  localDate: string,
  label: string,
  shortLabel: string,
  state: AnalyticsView["behaviorSummaries"][number]["dailyCells"][number]["state"],
  isTrackingStart = false,
  isSelected = false,
) {
  return {
    key: `behavior-${localDate}`,
    localDate,
    label,
    shortLabel,
    state,
    stateLabel: state,
    isSelected,
    isTrackingStart,
    counts:
      state === "full"
        ? {
            completedCount: 1,
            notCompletedCount: 0,
            unresolvedCount: 0,
            resolvedCount: 1,
            totalCount: 1,
          }
        : state === "partial" || state === "not_completed"
          ? {
              completedCount: state === "partial" ? 1 : 0,
              notCompletedCount: 1,
              unresolvedCount: 0,
              resolvedCount: state === "partial" ? 2 : 1,
              totalCount: state === "partial" ? 2 : 1,
            }
          : state === "unresolved"
            ? {
                completedCount: 0,
                notCompletedCount: 0,
                unresolvedCount: 1,
                resolvedCount: 0,
                totalCount: 1,
              }
            : emptyCounts,
    ariaLabel: `${label}: ${state}${isTrackingStart ? "; tracking started" : ""}`,
  };
}
