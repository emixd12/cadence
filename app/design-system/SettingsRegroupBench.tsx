"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { GripVertical } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ScreenFrame } from "@/components/layout/ScreenFrame";
import { SettingsPanel, SettingsPanelGrid } from "@/components/settings/SettingsPanels";
import { settingsFixtureCategories, settingsFixturePanels, settingsFixtureStatus, type SettingsFixturePanels, type SettingsFixtureState,
  type SettingsFixtureStatus, type SettingsRowStatus } from "./SettingsRegroupFixtures";
import styles from "./settings-regroup-bench.module.css";

// Settings regroup proposal (usability evaluation, 2026-11-09; second round 2026-11-10).
// A mock, not product UI: it arranges the real Settings panels in four groups and sketches
// a drag-to-reorder Categories list and a one-choice Daily Brief. Nothing here is wired to an account, and
// `/settings` is unchanged.

type Layout = "current" | "proposed";
type RegroupQuery = Readonly<Record<"layout" | "state", string | null>>;

const pick = <T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** `query` holds the page's `layout` and `state` values, so one URL reproduces one view. */
export function SettingsRegroupBench({ query }: Readonly<{ query: RegroupQuery }>) {
  const [layout, setLayout] = useState<Layout>(() => pick(query.layout, ["proposed", "current"], "proposed"));
  const [state, setState] = useState<SettingsFixtureState>(() => pick(query.state, ["fresh", "connected", "attention"], "fresh"));
  const panels = useMemo(() => settingsFixturePanels(state), [state]);
  const view = `${layout}-${state}`;
  const preview = useRef<HTMLDivElement>(null);
  const metrics = usePreviewMetrics(preview, view);
  const proposed = layout === "proposed";

  return (
    <AppShell>
      <aside aria-label="Bench controls" className="grid gap-3 border-b border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-950 sm:px-6 lg:px-10"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <a href="/design-system" className="underline underline-offset-4">Back to the design-system bench</a>
          <strong>Settings regroup proposal</strong>
          <span className="text-neutral-600">Mock. Real panels and sketches, synthetic data, nothing is saved.</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Choice label="Layout" value={layout} onChange={setLayout} options={[["proposed", "Proposed"], ["current", "Current"]]} />
          <Choice label="Account" value={state} onChange={setState}
            options={[["fresh", "New account"], ["connected", "Everything connected"], ["attention", "Outlook needs reconnection"]]} />
        </div>
        <p role="status" data-bench-metrics className="text-neutral-700" style={{ fontVariantNumeric: "tabular-nums" }}>
          {metrics ? `Preview: ${metrics.height.toLocaleString("en-US")} px tall, ${metrics.screens} screens at this window height, ${metrics.words.toLocaleString("en-US")} visible words, ${metrics.controls} controls.`
            : "Measuring the preview."}
        </p>
        <details>
          <summary className="cursor-pointer underline underline-offset-4">What the proposal changes, and what is only a sketch</summary>
          <div className="mt-2 grid max-w-3xl gap-2 leading-6 text-neutral-800">
            <ul className="list-disc pl-5">
              <li>Four groups replace the flat list of 12 sections. A four-link index stays in view while the page scrolls.</li>
              <li>Each source is one closed row that shows its state. A row that needs action opens by itself, and a link to an anchor inside a row opens it.</li>
              <li>Categories, Travel and Daily Brief keep their title, purpose and state in view. One button below them opens the controls.</li>
              <li>Sources carry official provider icons.</li>
              <li>In the Categories list, a handle drags a category to a new position. Arrow keys on the handle do the same.</li>
              <li>Note shortcuts has no Settings control: the proposal turns it on for everyone and drops the per-Behavior switch. The stored switch stays so it can return later.</li>
              <li>Trust and legal becomes one line of links. Delete account is a plain link at the end of the page.</li>
              <li>Body text keeps the current 12px size.</li>
            </ul>
            <p>Sketches, not real panels: the Categories list and the Daily Brief row. Their controls change nothing outside this page. Daily Brief shows one choice for every connected source and no second Google Calendar connection. Sketch wording is a first draft for the messaging track.</p>
          </div>
        </details>
      </aside>
      <div ref={preview} key={view}>
        <ScreenFrame title="Settings">
          {proposed ? <ProposedSettings panels={panels} state={state} /> : <CurrentSettings panels={panels} />}
        </ScreenFrame>
      </div>
    </AppShell>
  );
}

/** The live order of `app/(app)/settings/page.tsx`, for comparison. */
function CurrentSettings({ panels }: Readonly<{ panels: SettingsFixturePanels }>) {
  return (
    <SettingsPanelGrid>
      {panels.profile}{panels.timezone}{panels.notifications}
      <SettingsPanel title="Connected sources"
        description="Optional read-only context from other services. Sources never change Behaviors, Occurrences, statuses, Notes, or tracked time. Each source connects and fails separately.">
        <ul className="grid min-w-0 divide-y divide-line border-t border-line">
          {[panels.google, panels.outlook, panels.icloud, panels.hevy].map((panel, index) => <li key={index} className="min-w-0 pt-4 last:pb-0">{panel}</li>)}
        </ul>
      </SettingsPanel>
      {panels.travel}{panels.dailyBrief}{panels.connectedApps}{panels.categories}{panels.noteShortcuts}{panels.trust}{panels.deleteAccount}
    </SettingsPanelGrid>
  );
}

const GROUPS = [
  { id: "settings-general", label: "General", title: "General" },
  { id: "settings-connections", label: "Connections", title: "Connections" },
  { id: "settings-planning", label: "Planning", title: "Planning" },
  { id: "settings-account", label: "Account", title: "Account and data" },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];
/** Clears the sticky index, and on small screens the app header above it. */
const ANCHOR_OFFSET = "scroll-mt-32 lg:scroll-mt-16";

/** Each icon is the provider's own asset, bundled unchanged (`public/brand/*-source.md`). */
const SOURCES = [
  { key: "google", title: "Google Calendar", kind: "Calendar", icon: "/brand/google-calendar.svg" },
  { key: "outlook", title: "Outlook Calendar", kind: "Calendar", icon: "/brand/outlook-calendar.svg" },
  { key: "icloud", title: "iCloud Calendar", kind: "Calendar", icon: "/brand/icloud-calendar.png" },
  { key: "hevy", title: "Hevy", kind: "Workouts", icon: "/brand/hevy.png" },
] as const;

function ProposedSettings({ panels, state }: Readonly<{ panels: SettingsFixturePanels; state: SettingsFixtureState }>) {
  useOpenAnchorTarget();
  const status: SettingsFixtureStatus = settingsFixtureStatus(state);
  return (
    <div className={["grid min-w-0 grid-cols-1 gap-12", styles.proposal].join(" ")}>
      <nav aria-label="Settings sections" className="sticky top-16 z-30 -mx-4 -mt-6 border-b border-line bg-background px-4 sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:px-0">
        <ul className={["flex gap-x-4 overflow-x-auto whitespace-nowrap sm:gap-x-6", styles.index].join(" ")}>
          {GROUPS.map((group) => <li key={group.id}>
            <a href={`#${group.id}`} className="product-action product-action-secondary min-h-11 text-base">{group.label}</a>
          </li>)}
        </ul>
      </nav>
      <div className="grid max-w-xl gap-12">
        <Group id="settings-general">
          {panels.profile}{panels.timezone}{panels.notifications}
          <CategoriesSketch />
        </Group>
        <Group id="settings-connections">
          <SettingsPanel title="Connected sources"
            description="Bring your calendar and workouts into your day. Cadence only reads them, and your tracking never depends on them.">
            <div className="grid min-w-0 divide-y divide-line border-t border-line">
              {SOURCES.map((source) => <Row key={source.key} title={source.title} kind={source.kind} level={4} status={status[source.key]}
                icon={<SourceIcon src={source.icon} />}>{panels[source.key]}</Row>)}
            </div>
          </SettingsPanel>
          {panels.connectedApps}
        </Group>
        <Group id="settings-planning">
          <Drawer title="Travel" description="Know when to leave for events and Behaviors that have a place." status={status.travel}
            label={status.travel.on ? "Travel settings" : "Set up Travel"}>{panels.travel}</Drawer>
          <Drawer title="Daily Brief" description="A short briefing the first time you open Timeline each day." status={status.dailyBrief}
            label={status.dailyBrief.on ? "Daily Brief settings" : "Set up Daily Brief"}><DailyBriefSketch state={state} /></Drawer>
        </Group>
        <Group id="settings-account">
          <SettingsPanel title="Export" description="Download your history as JSONL, CSV, full JSON, or a BehaviorLog bundle.">
            <a href="/export" className="product-action product-action-primary min-h-11 text-sm">Open Export</a>
          </SettingsPanel>
        </Group>
        <footer className="grid gap-2 border-t border-line pt-4 text-sm">
          <ul className="flex flex-wrap gap-x-6">
            {[["/privacy", "Privacy"], ["/terms", "Terms"], ["/trust", "Trust"]].map(([href, label]) => <li key={href}>
              <a href={href} className="product-action product-action-secondary min-h-11">{label}</a>
            </li>)}
          </ul>
          <details data-settings-row suppressHydrationWarning className={ANCHOR_OFFSET}>
            <summary className="product-disclosure-trigger product-action product-action-secondary min-h-11 w-fit">Delete account</summary>
            <div className={["pt-2", styles.rowBody].join(" ")}>{panels.deleteAccount}</div>
          </details>
        </footer>
      </div>
    </div>
  );
}

function Group({ id, children }: Readonly<{ id: GroupId; children: ReactNode }>) {
  const group = GROUPS.find((item) => item.id === id)!;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={ANCHOR_OFFSET}>
      <h2 id={`${id}-title`} className="border-b border-line pb-4 text-2xl leading-tight">{group.title}</h2>
      <div className="mt-8 grid min-w-0 grid-cols-1 divide-y divide-line">{children}</div>
    </section>
  );
}

function SourceIcon({ src }: Readonly<{ src: string }>) {
  // The product already serves a bundled provider mark as a plain image (DayProgressTimeline).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={20} height={20} className="mt-1 h-5 w-5 shrink-0" />;
}

/**
 * A section whose title, purpose and state stay in view. One button below them opens the
 * controls. It starts closed unless its state needs action.
 */
function Drawer({ id, title, description, status, label, level = 3, children }: Readonly<{
  id?: string; title: string; description: string; status?: SettingsRowStatus; label: string; level?: 2 | 3; children: ReactNode }>) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section id={id} data-settings-drawer className={["bg-background py-4 first:pt-0 last:pb-0", ANCHOR_OFFSET].join(" ")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <Heading className="text-xl leading-tight">{title}</Heading>
        {status ? <span className={["text-sm leading-6", status.attention ? "font-bold text-foreground" : status.on ? "text-foreground" : "text-muted-readable"].join(" ")}>{status.text}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-readable">{description}</p>
      {/* The browser opens a drawer itself when a link targets an anchor inside it, before hydration. */}
      <details data-settings-row open={Boolean(status?.attention)} suppressHydrationWarning className={["mt-1", styles.drawer].join(" ")}>
        <summary className="product-disclosure-trigger flex min-h-11 w-fit items-center text-sm">
          <span aria-hidden="true" className="product-disclosure-indicator" />
          <span className="product-disclosure-trigger-label">{label}</span>
        </summary>
        <div className={["pb-2 pt-2", styles.rowBody].join(" ")}>{children}</div>
      </details>
    </section>
  );
}

/**
 * One native disclosure row: title, one line of purpose, and the state on the summary.
 * It starts closed unless its state needs action. The body is the existing panel.
 */
function Row({ title, kind, status, level = 3, icon, children }: Readonly<{
  title: string; kind: string; status?: SettingsRowStatus; level?: 3 | 4; icon?: ReactNode; children: ReactNode }>) {
  const Heading = level === 4 ? "h4" : "h3";
  return (
    // The browser opens a row itself when a link targets an anchor inside it, before hydration.
    <details data-settings-row open={Boolean(status?.attention)} suppressHydrationWarning className={["min-w-0", ANCHOR_OFFSET].join(" ")}>
      <summary className="product-disclosure-trigger flex min-h-11 items-start gap-2 py-4">
        <span aria-hidden="true" className="product-disclosure-indicator mt-2" />
        {icon}
        <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-6">
          <span className="grid min-w-0 gap-1">
            <Heading className={level === 4 ? "text-lg leading-tight" : "text-xl leading-tight"}>{title}</Heading>
            <span className="text-sm leading-6 text-muted-readable">{kind}</span>
          </span>
          {status ? <span className={["text-sm leading-6", status.attention ? "font-bold text-foreground" : status.on ? "text-foreground" : "text-muted-readable"].join(" ")}>{status.text}</span> : null}
        </span>
      </summary>
      <div className={["pb-6 pl-4", styles.rowBody].join(" ")}>{children}</div>
    </details>
  );
}

/** Sketch: one choice covers every connected source, with a per-source list under Advanced. */
function DailyBriefSketch({ state }: Readonly<{ state: SettingsFixtureState }>) {
  const connected = state === "fresh" ? [] : SOURCES.filter((source) => !(state === "attention" && source.key === "outlook"));
  const [enabled, setEnabled] = useState(state !== "fresh");
  const [useSources, setUseSources] = useState(state !== "fresh");
  return (
    <div className="grid gap-3 text-sm leading-6">
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Daily Brief</label>
      <div>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={enabled && useSources && connected.length > 0} disabled={!enabled || connected.length === 0} onChange={(event) => setUseSources(event.target.checked)} />
          Plan around my connected sources
        </label>
        <p className="pl-7 text-muted-readable">{connected.length === 0 ? "Nothing is connected yet. Connect a calendar or Hevy above and the brief can plan around it."
          : `Uses timing from ${connected.map((source) => source.title).join(", ")}. Titles, descriptions, locations and attendees are never sent.`}</p>
      </div>
      {connected.length > 0 ? <details>
        <summary className="product-disclosure-trigger product-action product-action-secondary min-h-11 w-fit">Advanced: choose sources</summary>
        <ul className="grid gap-1 pl-7 pt-1">
          {connected.map((source) => <li key={source.key}><label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" defaultChecked disabled={!enabled || !useSources} />{source.title}</label></li>)}
        </ul>
      </details> : null}
      <p className="text-muted-readable">The brief is read-only. It can suggest, and it never changes your tracking or your calendar.</p>
    </div>
  );
}

type Category = (typeof settingsFixtureCategories)[number];

/**
 * Sketch: the section keeps its title, and an Edit categories button below it opens the list.
 * A handle drags a category to a new position; arrow keys on the handle do the same.
 * The new order would save when the category is dropped.
 */
function CategoriesSketch() {
  const [order, setOrder] = useState<readonly Category[]>(settingsFixtureCategories);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLUListElement>(null);

  const moveTo = (id: string, to: number) => {
    const from = order.findIndex((category) => category.id === id);
    if (from < 0 || to < 0 || to >= order.length || to === from) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrder(next);
    setAnnouncement(`${moved!.name} moved to position ${to + 1} of ${next.length}.`);
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditing(null);
    setDragging(id);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-category-row]")];
    const over = rows.findIndex((row) => { const box = row.getBoundingClientRect(); return event.clientY >= box.top && event.clientY <= box.bottom; });
    if (over >= 0) moveTo(dragging, over);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, id: string) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveTo(id, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  return (
    <Drawer id="categories" level={2} title="Categories" description="Group your Behaviors your way." label={`Edit ${order.length} categories`}>
      <p id="category-reorder-hint" className="text-sm leading-6 text-muted-readable">Drag a handle to reorder, or focus it and press the arrow keys.</p>
      <p role="status" className="sr-only">{announcement}</p>
      <ul ref={list} className="mt-2 divide-y divide-line border-y border-line">
        {order.map((category, index) => <li key={category.id}>
          <div data-category-row className={["flex min-h-11 items-center gap-2", dragging === category.id ? "bg-surface" : ""].join(" ")}>
            <button type="button" aria-label={`Reorder ${category.name}`} aria-describedby="category-reorder-hint"
              className="grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center text-muted-readable active:cursor-grabbing"
              onPointerDown={(event) => onPointerDown(event, category.id)} onPointerMove={onPointerMove}
              onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)} onKeyDown={(event) => onKeyDown(event, index, category.id)}>
              <GripVertical aria-hidden="true" size={16} />
            </button>
            <span className="min-w-0 flex-1 break-words text-base">{category.name}</span>
            <button type="button" aria-expanded={editing === category.id} aria-label={`Edit ${category.name}`} className="product-action product-action-secondary min-h-11 text-sm"
              onClick={() => setEditing(editing === category.id ? null : category.id)}>Edit</button>
          </div>
          {editing === category.id ? <div className="pl-10 pt-2"><CategoryFormSketch category={category} onClose={() => setEditing(null)} /></div> : null}
        </li>)}
      </ul>
      {editing === "new" ? <div className="mt-4"><CategoryFormSketch onClose={() => setEditing(null)} /></div>
        : <button type="button" className="product-action product-action-primary mt-2 min-h-11 text-sm" onClick={() => setEditing("new")}>Add category</button>}
    </Drawer>
  );
}

function CategoryFormSketch({ category, onClose }: Readonly<{ category?: Category; onClose: () => void }>) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onClose(); }} className="grid max-w-md gap-3 pb-3 text-sm">
      <label className="grid gap-2">Name<input defaultValue={category?.name ?? ""} className="min-h-11 min-w-0 w-full border border-line bg-background px-3" /></label>
      <label className="grid gap-2">Description (optional)<textarea rows={2} defaultValue={category?.description ?? ""} className="min-w-0 w-full border border-line bg-background p-3" /></label>
      <div className="flex flex-wrap gap-4">
        <button type="submit" className="product-action product-action-primary min-h-11">Save</button>
        <button type="button" className="product-action product-action-secondary min-h-11" onClick={onClose}>Cancel</button>
        {category ? <button type="button" className="product-action product-action-danger min-h-11" onClick={onClose}>Delete…</button> : null}
      </div>
    </form>
  );
}

/**
 * Opens the row or drawer that holds the linked anchor and scrolls to it. Panels above keep
 * loading for a moment, so the target is brought back into place until the reader scrolls.
 */
function useOpenAnchorTarget() {
  useEffect(() => {
    let settle: ResizeObserver | null = null;
    const stop = () => { settle?.disconnect(); settle = null; };
    const reveal = () => {
      stop();
      const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (!target) return;
      const drawer = target.closest<HTMLElement>("[data-settings-drawer]");
      const row = target.closest<HTMLDetailsElement>("details[data-settings-row]") ?? drawer?.querySelector<HTMLDetailsElement>("details[data-settings-row]");
      if (row) row.open = true;
      const place = drawer ?? row ?? target;
      place.scrollIntoView();
      settle = new ResizeObserver(() => place.scrollIntoView());
      settle.observe(document.body);
      window.setTimeout(stop, 4000);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(type, stop, { passive: true });
    return () => {
      stop();
      window.removeEventListener("hashchange", reveal);
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) window.removeEventListener(type, stop);
    };
  }, []);
}

function Choice<T extends string>({ label, value, options, onChange, disabled = false }: Readonly<{
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; disabled?: boolean }>) {
  return (
    <fieldset disabled={disabled} className="grid gap-1 disabled:opacity-50">
      <legend className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</legend>
      <div className="flex flex-wrap">
        {options.map(([option, text]) => <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}
          className={["-ml-px min-h-9 border border-neutral-400 px-3 first:ml-0", option === value ? "bg-neutral-900 text-white" : "bg-white text-neutral-900"].join(" ")}>{text}</button>)}
      </div>
    </fieldset>
  );
}

type PreviewMetrics = Readonly<{ height: number; screens: number; words: number; controls: number }>;

/** Measures the rendered preview: height, visible words outside selects, and visible controls. */
function usePreviewMetrics(preview: RefObject<HTMLDivElement | null>, view: string): PreviewMetrics | null {
  const [metrics, setMetrics] = useState<PreviewMetrics | null>(null);
  useEffect(() => {
    const root = preview.current;
    if (!root) return;
    const read = () => setMetrics(measurePreview(root));
    const observer = new ResizeObserver(read);
    observer.observe(root);
    return () => observer.disconnect();
  }, [preview, view]);
  return metrics;
}

function measurePreview(root: HTMLElement): PreviewMetrics {
  const shown = (element: Element) => element.checkVisibility({ visibilityProperty: true }) && element.getClientRects().length > 0;
  let words = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest("select, .sr-only") || !shown(parent)) continue;
    words += (node.textContent?.trim().match(/\S+/g) ?? []).length;
  }
  const controls = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary")].filter(shown).length;
  const height = Math.round(root.getBoundingClientRect().height);
  return { height, screens: Math.round((height / window.innerHeight) * 10) / 10, words, controls };
}
