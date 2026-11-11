"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";

// Ticket 301: one heading per Settings section. A group, row or drawer sets the
// level its contents start at. A row or drawer that already shows the section
// title "owns" it, so the panel directly inside drops its own heading.

export type SettingsHeadingLevel = 2 | 3 | 4 | 5;
export type SettingsHeadingTag = "h2" | "h3" | "h4" | "h5";

type SettingsHeadingScopeValue = Readonly<{ level: SettingsHeadingLevel; owned: boolean }>;

const SettingsHeadingContext = createContext<SettingsHeadingScopeValue>({ level: 2, owned: false });

/** Sets the heading level for the panels inside. `owned` means a row or drawer above already shows the title. */
export function SettingsHeadingScope({ level, owned = false, children }: Readonly<{
  level: SettingsHeadingLevel; owned?: boolean; children: ReactNode }>) {
  return <SettingsHeadingContext.Provider value={{ level, owned }}>{children}</SettingsHeadingContext.Provider>;
}

export type SettingsHeading = Readonly<{
  /** False when a row or drawer above shows the title, or the caller passed `null`. */
  show: boolean;
  level: SettingsHeadingLevel;
  Tag: SettingsHeadingTag;
  /** The level for headings inside this section. */
  childLevel: SettingsHeadingLevel;
}>;

const TAGS: Readonly<Record<SettingsHeadingLevel, SettingsHeadingTag>> = { 2: "h2", 3: "h3", 4: "h4", 5: "h5" };

export function settingsHeadingTag(level: SettingsHeadingLevel): SettingsHeadingTag {
  return TAGS[level];
}

function next(level: SettingsHeadingLevel): SettingsHeadingLevel {
  return level >= 5 ? 5 : ((level + 1) as SettingsHeadingLevel);
}

/**
 * The heading a section should render. An explicit level wins over the scope;
 * `null` renders no heading (no-heading mode).
 */
export function useSettingsHeading(explicit?: SettingsHeadingLevel | null): SettingsHeading {
  const scope = useContext(SettingsHeadingContext);
  const level = explicit ?? scope.level;
  const show = explicit !== null && !scope.owned;
  return { show, level, Tag: TAGS[level], childLevel: next(level) };
}

/** A hand-built section's title that follows the scope (Timezone, Notifications). */
export function SettingsSectionHeading({ id, children }: Readonly<{ id?: string; children: ReactNode }>) {
  const heading = useSettingsHeading();
  if (!heading.show) return null;
  return <heading.Tag id={id} className="text-xl leading-tight">{children}</heading.Tag>;
}

/** An item title inside a section, one level below it (a connected app, a category). */
export function SettingsItemHeading({ className, children }: Readonly<{ className: string; children: ReactNode }>) {
  const heading = useSettingsHeading();
  return <heading.Tag className={className}>{children}</heading.Tag>;
}

/** A part inside a section, one level below the section's heading (Reminder coverage, Storage recovery). */
export function SettingsPartHeading({ className, children }: Readonly<{ className: string; children: ReactNode }>) {
  return createElement(settingsHeadingTag(useSettingsHeading().childLevel), { className }, children);
}
