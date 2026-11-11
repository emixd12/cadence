"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { GripVertical } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ScreenFrame } from "@/components/layout/ScreenFrame";
import { ConnectorLibrary } from "@/components/settings/ConnectorLibrary";
import { SettingsPanel, SettingsPanelGrid } from "@/components/settings/SettingsPanels";
import { SETTINGS_DAILY_BRIEF_PURPOSE, SETTINGS_TRAVEL_PURPOSE, SettingsDrawer, SettingsExportEntry, SettingsGroup, SettingsPageEnd,
  SettingsSections } from "@/components/settings/SettingsSections";
import { categoriesSectionState } from "@/lib/ui/settings-sections";
import { settingsFixtureCategories, settingsFixtureDailyBriefState, settingsFixturePanels, type SettingsFixturePanels,
  type SettingsFixtureState } from "./SettingsRegroupFixtures";

// Settings regroup (usability evaluation, 2026-11-09; second round 2026-11-10).
// "Proposed" renders the Ticket 301 Settings layout from the real components on
// synthetic data. Two parts stay sketches for later tickets: the drag-to-reorder
// Categories list (Ticket 304) and the one-choice Daily Brief (Tickets 306–307).

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
          <span className="text-neutral-600">Real Settings components and two sketches, synthetic data, nothing is saved.</span>
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
          <summary className="cursor-pointer underline underline-offset-4">What changed, and what is only a sketch</summary>
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
            <p>Ticket 301 ships the groups, index, rows, drawers, legal links and Delete account link on <code>/settings</code>; Proposed renders those components. Sketches, not real panels: the Categories list (Ticket 304) and the Daily Brief controls (Tickets 306–307). Their controls change nothing outside this page. Daily Brief shows one choice for every connected source and no second Google Calendar connection. Sketch wording is a first draft for the messaging track.</p>
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
        description="Optional read-only context from other services. Sources never change Behaviors, Occurrences, statuses, Notes, or tracked time. Each source works on its own.">
        <ul className="grid min-w-0 divide-y divide-line border-t border-line">
          {[panels.google, panels.outlook, panels.icloud, panels.hevy].map((panel, index) => <li key={index} className="min-w-0 pt-4 last:pb-0">{panel}</li>)}
        </ul>
      </SettingsPanel>
      {panels.travel}{panels.dailyBrief}{panels.connectedApps}{panels.categories}{panels.noteShortcuts}{panels.trust}{panels.deleteAccount}
    </SettingsPanelGrid>
  );
}

const SOURCES = [
  { key: "google", title: "Google Calendar" },
  { key: "outlook", title: "Outlook Calendar" },
  { key: "icloud", title: "iCloud Calendar" },
  { key: "hevy", title: "Hevy" },
] as const;

/** The `/settings` layout (Ticket 301), with the Categories and Daily Brief sketches in place of the real panels. */
function ProposedSettings({ panels, state }: Readonly<{ panels: SettingsFixturePanels; state: SettingsFixtureState }>) {
  const dailyBrief = settingsFixtureDailyBriefState(state);
  return (
    <SettingsSections>
      <SettingsGroup id="settings-general">
        {panels.profile}{panels.timezone}{panels.notifications}
        <CategoriesSketch />
      </SettingsGroup>
      <SettingsGroup id="settings-connections">
        <ConnectorLibrary rows sources={[
          { id: "google_calendar", content: panels.google },
          { id: "outlook_calendar", content: panels.outlook },
          { id: "icloud_calendar", content: panels.icloud },
          { id: "hevy", content: panels.hevy },
        ]} />
        {panels.connectedApps}
      </SettingsGroup>
      <SettingsGroup id="settings-planning">
        <SettingsDrawer title="Travel" description={SETTINGS_TRAVEL_PURPOSE} label="Travel settings" setupLabel="Set up Travel">{panels.travel}</SettingsDrawer>
        <SettingsDrawer title="Daily Brief" description={SETTINGS_DAILY_BRIEF_PURPOSE} state={dailyBrief}
          label="Daily Brief settings" setupLabel="Set up Daily Brief"><DailyBriefSketch state={state} /></SettingsDrawer>
      </SettingsGroup>
      <SettingsGroup id="settings-account">
        <SettingsExportEntry />
      </SettingsGroup>
      <SettingsPageEnd deleteAccount={panels.deleteAccount} />
    </SettingsSections>
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
    <SettingsDrawer title="Categories" description="Group your Behaviors your way." label={`Edit ${order.length} categories`}
      state={categoriesSectionState(order.length)}>
      <div id="categories">
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
      </div>
    </SettingsDrawer>
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
