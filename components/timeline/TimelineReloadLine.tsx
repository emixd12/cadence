import { Notice } from "@/components/feedback/Notice";

export type ReloadNoticeId = "timeline.reloaded" | "timeline.reload-incomplete" | "timeline.reload-offline";

/**
 * The small line at the top of the Timeline during and after a reload, on the web and
 * the Mac: progress in Readable Ash, then the result in its notice style.
 */
export function TimelineReloadLine({ result, feedback }: Readonly<{ result: ReloadNoticeId | null; feedback: string }>) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] z-30 -translate-x-1/2 border border-line bg-background px-3 py-1.5 text-xs leading-5 motion-safe:transition-opacity motion-reduce:transition-none"
      role="status"
      data-timeline-reload-line
    >
      {result ? <Notice id={result} announce={false} size="small" /> : <p className="text-muted-readable">{feedback}</p>}
    </div>
  );
}
