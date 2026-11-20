import { NOTICES, noticeTemplateArguments, type NoticeId } from "@cadence/core/notices";
import { Notice } from "@/components/feedback/Notice";

// The notices library on the bench: every notice in its style, grouped by feature,
// with sample values. The words and styles come from packages/core/src/notices; the
// full list with the change record is docs/NOTICES.md.

const SAMPLES: Readonly<Record<string, string | number>> = {
  title: "Gym", time: "10:00 AM", otherTime: "10:30 AM", other: "Lunch", event: "Design review",
  reason: "running late", count: 2, minutes: 30, wait: "2 minutes", until: "December 1", date: "2026-11-20",
  back: "Dec 8", hasOther: "yes", hasEvent: "yes", lines: "yes",
};

const STYLE_ORDER = ["outcome", "question", "note", "error"] as const;

export function NoticeBench() {
  const ids = Object.keys(NOTICES) as NoticeId[];
  const features = [...new Set(ids.map((id) => NOTICES[id].feature))].sort();
  return (
    <div className="grid max-w-2xl gap-8 text-sm leading-6">
      <div className="grid gap-2">
        {STYLE_ORDER.map((style) => {
          const id = ids.find((candidate) => NOTICES[candidate].style === style)!;
          return <div key={style} className="grid grid-cols-[6rem_1fr] gap-3">
            <p className="text-xs text-muted-readable">{style}</p>
            <Notice id={id} params={params(id)} announce={false} className={style === "note" ? "text-xs leading-5" : undefined} />
          </div>;
        })}
      </div>
      {features.map((feature) => <section key={feature} className="grid gap-2 border-t border-line pt-3">
        <p className="text-xs font-bold text-muted-readable">{feature}</p>
        {ids.filter((id) => NOTICES[id].feature === feature).map((id) => <div key={id} className="grid gap-x-3 sm:grid-cols-[14rem_1fr]">
          <p className="text-xs leading-6 text-muted-readable">{id}{NOTICES[id].status === "planned" ? " (planned)" : ""}</p>
          <Notice id={id} params={params(id)} announce={false} className={NOTICES[id].style === "note" ? "text-xs leading-5" : undefined} />
        </div>)}
      </section>)}
    </div>
  );
}

function params(id: NoticeId): Record<string, string | number> {
  return Object.fromEntries([...noticeTemplateArguments(NOTICES[id].text)].map((name) => [name, SAMPLES[name] ?? name]));
}
