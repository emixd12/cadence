"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Ticket 303. Settings save as they change. Each section shows one result line:
// "Saving…", then "Saved", or one specific error that says what to do. The line
// is the section's only live region, so no message is announced twice.

export const SETTINGS_SAVING = "Saving…";
export const SETTINGS_SAVED = "Saved";
/** Appended to a failed save: the control is back to its saved value. */
export const SETTINGS_UNDONE = "Your change was undone.";

/** A failed save's message: what went wrong and what to do, then that the change was undone. */
export function settingsSaveFailed(reason: string): string {
  return `${reason} ${SETTINGS_UNDONE}`;
}

export type SettingsResult = Readonly<{ text: string; error: boolean }>;
type Report = (result: SettingsResult | null) => void;

const SettingsResultContext = createContext<Report | null>(null);

export type SettingsResultChannel = Readonly<{
  /** This section's own result, shown by its line. Null while a part reports to an enclosing section. */
  result: SettingsResult | null;
  /** True when this section renders the line; false when an enclosing section's line shows its results. */
  owns: boolean;
  report: Report;
  saving: () => void;
  saved: (text?: string) => void;
  failed: (text: string) => void;
  info: (text: string) => void;
  clear: () => void;
}>;

/**
 * A section's result channel. A part inside another section (Home's current location
 * inside Travel) reports to that section's line; `own` gives a sub-section its own line.
 */
export function useSettingsResult(own = false): SettingsResultChannel {
  const outer = useContext(SettingsResultContext);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const owns = own || outer === null;
  const report: Report = owns ? setResult : outer;
  return useMemo(() => ({
    result: owns ? result : null,
    owns,
    report,
    saving: () => report({ text: SETTINGS_SAVING, error: false }),
    saved: (text = SETTINGS_SAVED) => report({ text, error: false }),
    failed: (text: string) => report({ text, error: true }),
    info: (text: string) => report({ text, error: false }),
    clear: () => report(null),
  }), [owns, report, result]);
}

/** Parts inside report to this channel's line. */
export function SettingsResultScope({ channel, children }: Readonly<{ channel: SettingsResultChannel; children: ReactNode }>) {
  return <SettingsResultContext.Provider value={channel.report}>{children}</SettingsResultContext.Provider>;
}

/** The section's one live region. It stays mounted, visually hidden while empty, so screen readers hear each change. */
export function SettingsLiveLine({ text, error = false, className = "" }: Readonly<{ text: string | null | undefined; error?: boolean; className?: string }>) {
  return <p role="status" data-settings-result
    className={text ? [className, error ? "text-accent" : ""].filter(Boolean).join(" ") : "sr-only"}>{text ?? ""}</p>;
}

/** The channel's line, or nothing when an enclosing section shows it. */
export function SettingsResultLine({ channel, className }: Readonly<{ channel: SettingsResultChannel; className?: string }>) {
  if (!channel.owns) return null;
  return <SettingsLiveLine text={channel.result?.text} error={channel.result?.error} className={className} />;
}

/**
 * Runs saves one at a time, in order. Each task reads the latest saved revision when it
 * starts, so a change made while another saves never sends a stale revision.
 */
export function useSerialSaves(): (task: () => Promise<void>) => void {
  const queue = useRef<Promise<void>>(Promise.resolve());
  return useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task, task).catch(() => undefined);
  }, []);
}

type AutosaveHandlers<R> = Readonly<{
  /** `latest` is false while a newer change waits to save. */
  saved: (result: R, latest: boolean) => void;
  failed: (error: unknown) => void;
  /** After the newest change saved. */
  settled?: () => Promise<void> | void;
}>;

/**
 * Saves a whole value as it changes (calendar selection and display). One save runs at a
 * time; changes made meanwhile collapse into one save of the newest value. A failure drops
 * the waiting change and reports, so the caller puts the controls back to the saved value.
 */
export function useAutosave<T, R>(commit: (value: T) => Promise<R>, handlers: AutosaveHandlers<R>): Readonly<{
  change: (value: T) => void; saving: boolean; cancel: () => void }> {
  const latest = useRef({ commit, handlers });
  useEffect(() => { latest.current = { commit, handlers }; });
  const waiting = useRef<{ value: T } | null>(null);
  const running = useRef(false);
  const generation = useRef(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => () => { generation.current++; }, []);
  const drain = useCallback(async () => {
    const current = generation.current;
    running.current = true; setSaving(true);
    try {
      while (waiting.current) {
        const { value } = waiting.current;
        waiting.current = null;
        let result: R;
        try { result = await latest.current.commit(value); }
        catch (error) {
          if (current !== generation.current) return;
          waiting.current = null;
          latest.current.handlers.failed(error);
          return;
        }
        if (current !== generation.current) return;
        latest.current.handlers.saved(result, waiting.current === null);
      }
      await latest.current.handlers.settled?.();
    } finally {
      if (current === generation.current) { running.current = false; setSaving(false); }
    }
  }, []);
  const change = useCallback((value: T) => {
    waiting.current = { value };
    if (!running.current) void drain();
  }, [drain]);
  const cancel = useCallback(() => {
    generation.current++;
    waiting.current = null; running.current = false; setSaving(false);
  }, []);
  return { change, saving, cancel };
}
