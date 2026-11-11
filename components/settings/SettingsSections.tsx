"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import { SettingsHeadingScope, useSettingsHeading } from "@/components/settings/settings-heading";
import {
  SETTINGS_SECTION_CHECKING,
  isSettingsSectionChecking,
  type SettingsSectionState,
} from "@/lib/ui/settings-sections";

// Ticket 301. Settings in four groups with a sticky section index. A connected
// source is one closed row; Travel, Daily Brief and Categories are drawers that
// keep their title, purpose and state in view. A row or drawer whose state
// needs action opens by itself, and a link to an anchor inside one opens it.

export const SETTINGS_GROUPS = [
  { id: "settings-general", label: "General", title: "General" },
  { id: "settings-connections", label: "Connections", title: "Connections" },
  { id: "settings-planning", label: "Planning", title: "Planning" },
  { id: "settings-account", label: "Account", title: "Account and data" },
] as const;
/** Ticket 302: the Mac's own group (database, updates, Setup guide), after Account and data. */
export const SETTINGS_MAC_GROUP = { id: "settings-mac", label: "Mac", title: "This Mac" } as const;
export const DESKTOP_SETTINGS_GROUPS = [...SETTINGS_GROUPS, SETTINGS_MAC_GROUP] as const;
export type SettingsGroupMeta = (typeof DESKTOP_SETTINGS_GROUPS)[number];
export type SettingsGroupId = SettingsGroupMeta["id"];

/**
 * Where the sticky index sits and where anchors land. The default clears the
 * index, and on small screens the 4rem app header above it. The offsets also
 * apply to every `section[id]` inside the page, so existing panel anchors
 * (`#timezone`, `#notifications`, `#connected-apps`) land below both.
 * `shellCue` adds the Mac's 4rem sync-conflict cue above the index (Ticket 302).
 */
type SettingsLayout = Readonly<{ groups: readonly SettingsGroupMeta[]; indexTop: readonly [string, string]; anchor: string; nestedAnchor: string }>;
const WEB_LAYOUT: SettingsLayout = {
  groups: SETTINGS_GROUPS,
  indexTop: ["top-16", "lg:top-0"],
  anchor: "scroll-mt-32 lg:scroll-mt-16",
  nestedAnchor: "[&_section[id]]:scroll-mt-32 lg:[&_section[id]]:scroll-mt-16",
};
const CUE_OFFSETS = {
  indexTop: ["top-32", "lg:top-16"],
  anchor: "scroll-mt-48 lg:scroll-mt-32",
  nestedAnchor: "[&_section[id]]:scroll-mt-48 lg:[&_section[id]]:scroll-mt-32",
} as const;
const SettingsLayoutContext = createContext<SettingsLayout>(WEB_LAYOUT);
const useAnchorOffset = () => useContext(SettingsLayoutContext).anchor;

type Report = (state: SettingsSectionState) => void;
const SettingsSectionReportContext = createContext<Report | null>(null);

/**
 * A panel inside a row or drawer reports its state line. Pass `null` when the
 * panel is not the section's own panel (for example the Daily Brief Google
 * Calendar panel), so it never replaces the section's state.
 */
export function useReportSettingsSection(state: SettingsSectionState | null): void {
  const report = useContext(SettingsSectionReportContext);
  const text = state?.text;
  const attention = state?.attention;
  const on = state?.on;
  useEffect(() => {
    if (!report || text === undefined) return;
    report({ text, attention: attention === true, on: on === true });
  }, [report, text, attention, on]);
}

function useSectionState(fixed: SettingsSectionState | undefined): [SettingsSectionState, Report] {
  const [reported, setReported] = useState<SettingsSectionState | null>(null);
  const report = useCallback<Report>((next) => setReported((previous) =>
    previous && previous.text === next.text && previous.attention === next.attention && previous.on === next.on ? previous : next), []);
  return [fixed ?? reported ?? SETTINGS_SECTION_CHECKING, report];
}

/** Reports a fixed state from a server-rendered panel, such as a source that cannot connect here. */
export function SettingsSectionReport({ state }: Readonly<{ state: SettingsSectionState }>) {
  useReportSettingsSection(state);
  return null;
}

/** Opens a row or drawer when its state starts needing action. The person can close it again. */
function useOpenOnAttention(attention: boolean): RefObject<HTMLDetailsElement | null> {
  const details = useRef<HTMLDetailsElement>(null);
  const previous = useRef(false);
  useEffect(() => {
    const element = details.current;
    if (attention && !previous.current && element) element.open = true;
    previous.current = attention;
  }, [attention]);
  return details;
}

function StateText({ state }: Readonly<{ state: SettingsSectionState }>) {
  return <span data-settings-state={state.attention ? "attention" : state.on ? "on" : "off"}
    className={["text-sm leading-6", state.attention ? "font-bold text-foreground" : state.on ? "text-foreground" : "text-muted-readable"].join(" ")}>
    {state.text}
  </span>;
}

/**
 * The whole Settings page body: the sticky section index, the groups, and anchor
 * handling. Web shows the four groups; the Mac passes `DESKTOP_SETTINGS_GROUPS`
 * and, while its sync-conflict cue shows, `shellCue` (Ticket 302).
 */
export function SettingsSections({ groups = SETTINGS_GROUPS, shellCue = false, children }: Readonly<{
  groups?: readonly SettingsGroupMeta[]; shellCue?: boolean; children: ReactNode }>) {
  useOpenAnchorTarget();
  const layout = useMemo<SettingsLayout>(() => ({ ...(shellCue ? CUE_OFFSETS : WEB_LAYOUT), groups }), [groups, shellCue]);
  return (
    <SettingsLayoutContext.Provider value={layout}>
      <div className={["grid min-w-0 grid-cols-1 gap-12", layout.nestedAnchor].join(" ")}>
        <SettingsSectionIndex />
        <div className="grid min-w-0 max-w-xl gap-12">{children}</div>
      </div>
    </SettingsLayoutContext.Provider>
  );
}

/** One link per group that stays in view while the page scrolls. On small screens it sits below the app header. */
export function SettingsSectionIndex() {
  const layout = useContext(SettingsLayoutContext);
  return (
    <nav aria-label="Settings sections"
      className={`sticky ${layout.indexTop[0]} z-30 -mx-4 -mt-6 border-b border-line bg-background px-4 sm:-mx-6 sm:px-6 ${layout.indexTop[1]} lg:mx-0 lg:px-0`}>
      <ul className="flex gap-x-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:gap-x-6 [&::-webkit-scrollbar]:hidden">
        {layout.groups.map((group) => <li key={group.id}>
          <a href={`#${group.id}`} className="product-action product-action-secondary min-h-11 text-base">{group.label}</a>
        </li>)}
      </ul>
    </nav>
  );
}

/** One group. Its `text-2xl` title is the page's level-2 heading; sections inside start at level 3. */
export function SettingsGroup({ id, children }: Readonly<{ id: SettingsGroupId; children: ReactNode }>) {
  const group = DESKTOP_SETTINGS_GROUPS.find((item) => item.id === id)!;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={useAnchorOffset()}>
      <h2 id={`${id}-title`} className="border-b border-line pb-4 text-2xl leading-tight">{group.title}</h2>
      <div className="mt-8 grid min-w-0 grid-cols-1 divide-y divide-line">
        <SettingsHeadingScope level={3}>{children}</SettingsHeadingScope>
      </div>
    </section>
  );
}

/**
 * One closed disclosure row: icon, title, kind and state on the summary; the
 * existing panel inside. The panel drops its own heading. `state` is for a row
 * whose state is known up front; otherwise the panel reports it.
 */
export function SettingsRow({ title, kind, icon, state: fixed, children }: Readonly<{
  title: string; kind: string; icon?: ReactNode; state?: SettingsSectionState; children: ReactNode }>) {
  const heading = useSettingsHeading();
  const [state, report] = useSectionState(fixed);
  const details = useOpenOnAttention(state.attention);
  const anchor = useAnchorOffset();
  return (
    // The browser opens a row itself when a link targets an anchor inside it, before hydration.
    <details ref={details} data-settings-row suppressHydrationWarning className={["min-w-0", anchor].join(" ")}>
      <summary className="product-disclosure-trigger flex min-h-11 items-start gap-2 py-4">
        <span aria-hidden="true" className="product-disclosure-indicator mt-2" />
        {icon}
        <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-6">
          <span className="grid min-w-0 gap-1">
            <heading.Tag className={heading.level >= 4 ? "text-lg leading-tight" : "text-xl leading-tight"}>{title}</heading.Tag>
            <span className="text-sm leading-6 text-muted-readable">{kind}</span>
          </span>
          <StateText state={state} />
        </span>
      </summary>
      <div className="min-w-0 pb-6 pl-4">
        <SettingsSectionReportContext.Provider value={report}>
          <SettingsHeadingScope level={heading.level} owned>{children}</SettingsHeadingScope>
        </SettingsSectionReportContext.Provider>
      </div>
    </details>
  );
}

/**
 * A section whose title, one-line purpose and state stay in view. One button
 * below them opens the controls; it starts closed unless the state needs action.
 * `setupLabel` replaces `label` while the section is off ("Set up Travel").
 */
export function SettingsDrawer({ title, description, label, setupLabel, state: fixed, children }: Readonly<{
  title: string; description: string; label: string; setupLabel?: string; state?: SettingsSectionState; children: ReactNode }>) {
  const heading = useSettingsHeading();
  const [state, report] = useSectionState(fixed);
  const details = useOpenOnAttention(state.attention);
  const buttonLabel = setupLabel && !state.on && !isSettingsSectionChecking(state) ? setupLabel : label;
  const anchor = useAnchorOffset();
  return (
    <section data-settings-drawer className={["bg-background py-4 first:pt-0 last:pb-0", anchor].join(" ")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <heading.Tag className="text-xl leading-tight">{title}</heading.Tag>
        <StateText state={state} />
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">{description}</p>
      {/* The browser opens a drawer itself when a link targets an anchor inside it, before hydration. */}
      <details ref={details} data-settings-row suppressHydrationWarning className="mt-1 [&:not([open])]:-mb-2.5">
        <summary className="product-disclosure-trigger flex min-h-11 w-fit items-center text-sm">
          <span aria-hidden="true" className="product-disclosure-indicator" />
          <span className="product-disclosure-trigger-label">{buttonLabel}</span>
        </summary>
        <div className="grid min-w-0 divide-y divide-line pb-2 pt-2">
          <SettingsSectionReportContext.Provider value={report}>
            <SettingsHeadingScope level={heading.level} owned>{children}</SettingsHeadingScope>
          </SettingsSectionReportContext.Provider>
        </div>
      </details>
    </section>
  );
}

/** A provider's own mark, bundled unchanged (`public/brand/connector-icons-source.md`). Decorative: the row names the source. */
export function SettingsSourceIcon({ src }: Readonly<{ src: string }>) {
  // The product already serves a bundled provider mark as a plain image (DayProgressTimeline).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={20} height={20} className="mt-1 h-5 w-5 shrink-0" />;
}

/** Account and data: the way to Export from Settings. The Mac passes `onOpen` to switch to its Export screen. */
export function SettingsExportEntry({ onOpen }: Readonly<{ onOpen?: () => void }>) {
  return (
    <SettingsPanel title="Export" description="Download your history as JSONL, CSV, full JSON, or a BehaviorLog bundle.">
      {onOpen ? <button type="button" onClick={onOpen} className="product-action product-action-primary min-h-11 text-sm">Open Export</button>
        : <a href="/export" className="product-action product-action-primary min-h-11 text-sm">Open Export</a>}
    </SettingsPanel>
  );
}

const LEGAL_LINKS = [["/privacy", "Privacy"], ["/terms", "Terms"], ["/trust", "Trust"]] as const;

/**
 * The end of the page: one line of Privacy, Terms and Trust links, then Delete
 * account as a plain link that opens the existing form.
 */
export function SettingsPageEnd({ deleteAccount }: Readonly<{ deleteAccount: ReactNode }>) {
  const anchor = useAnchorOffset();
  return (
    <footer className="grid gap-2 border-t border-line pt-4 text-sm">
      <ul aria-label="Privacy, Terms and Trust" className="flex flex-wrap gap-x-6">
        {LEGAL_LINKS.map(([href, label]) => <li key={href}>
          <a href={href} className="product-action product-action-secondary min-h-11">{label}</a>
        </li>)}
      </ul>
      <details id="delete-account" data-settings-row suppressHydrationWarning className={anchor}>
        <summary className="product-disclosure-trigger product-action product-action-secondary min-h-11 w-fit">Delete account</summary>
        <div className="pt-2">{deleteAccount}</div>
      </details>
    </footer>
  );
}

const STOP_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Opens the row or drawer that holds `target` and scrolls to it. Panels above
 * keep loading for a moment, so the target is brought back into place until the
 * reader scrolls, types or taps, or for at most 4 seconds. Returns a function
 * that stops holding it. The Mac calls this for its in-app navigation anchors
 * (Ticket 302); `options` is passed to `scrollIntoView`.
 */
export function revealSettingsTarget(target: HTMLElement, options?: ScrollIntoViewOptions): () => void {
  const drawer = target.closest<HTMLElement>("[data-settings-drawer]");
  // `closest` includes the target itself, so `#delete-account` opens its own disclosure.
  const row = target.closest<HTMLDetailsElement>("details[data-settings-row]")
    ?? drawer?.querySelector<HTMLDetailsElement>("details[data-settings-row]");
  if (row) row.open = true;
  const place = drawer ?? row ?? target;
  const scroll = () => { if (typeof place.scrollIntoView === "function") place.scrollIntoView(options); };
  scroll();
  if (typeof ResizeObserver === "undefined") return () => undefined;
  let settle: ResizeObserver | null = new ResizeObserver(scroll);
  settle.observe(document.body);
  const stop = () => {
    settle?.disconnect(); settle = null;
    window.clearTimeout(timer);
    for (const type of STOP_EVENTS) window.removeEventListener(type, stop);
  };
  const timer = window.setTimeout(stop, 4000);
  for (const type of STOP_EVENTS) window.addEventListener(type, stop, { passive: true });
  return stop;
}

/** Opens and holds the row or drawer that holds the page's linked anchor (`#travel`). */
export function useOpenAnchorTarget(): void {
  useEffect(() => {
    let stop: () => void = () => undefined;
    const reveal = () => {
      stop();
      stop = () => undefined;
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      let target: HTMLElement | null = null;
      try { target = document.getElementById(decodeURIComponent(hash)); } catch { return; }
      if (target) stop = revealSettingsTarget(target);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      stop();
      window.removeEventListener("hashchange", reveal);
    };
  }, []);
}
