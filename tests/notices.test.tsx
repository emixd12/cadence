import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NOTICES,
  formatNoticeTemplate,
  noticeTemplateArguments,
  noticeText,
  type NoticeId,
} from "@cadence/core/notices";
import { MOVE_REFUSAL_MESSAGES, MOVE_REFUSAL_REASONS } from "@cadence/core/resolvers/move.resolver";
import { Notice } from "@/components/feedback/Notice";
import allowlist from "./fixtures/notice-role-allowlist.json";

const root = join(__dirname, "..");
const ids = Object.keys(NOTICES) as NoticeId[];

/** Values that reach every branch's arguments: "yes" picks a select's own branch. */
function sampleParams(template: string): Record<string, string | number> {
  return Object.fromEntries([...noticeTemplateArguments(template)].map((name) => [name, name === "count" || name === "minutes" ? 2 : "yes"]));
}

describe("notices catalog", () => {
  it("holds one entry per id with a meaning, a style and a template that formats", () => {
    expect(ids.length).toBeGreaterThan(90);
    for (const id of ids) {
      const entry = NOTICES[id];
      expect(entry.meaning.trim(), id).not.toBe("");
      expect(["outcome", "error", "note", "question"], id).toContain(entry.style);
      expect(() => formatNoticeTemplate(entry.text, sampleParams(entry.text)), id).not.toThrow();
    }
  });

  it("fills values, select and plural", () => {
    expect(noticeText("move.moved", { title: "Run", time: "9:30 AM" })).toBe("Run moved to 9:30 AM for today.");
    expect(noticeText("brief-moves.batch-refused", { count: 1 })).toBe("One item could not be moved; see its line.");
    expect(noticeText("brief-moves.batch-refused", { count: 3 })).toBe("3 items could not be moved; see their lines.");
    expect(noticeText("timeline.left-to-decide", { count: 0 })).toBe("None left to decide");
    expect(noticeText("timeline.left-to-decide", { count: 1 })).toBe("1 left to decide");
    expect(noticeText("move.conflict", { title: "Run", time: "9:00 AM", hasOther: "no", other: "", otherTime: "" }))
      .toBe("Your schedule changed, and Run at 9:00 AM today now overlaps another item. Keep Run at 9:00 AM?");
    expect(noticeText("brief.still-preparing", { wait: "none" })).toBe("Daily Brief is still being prepared. Try again shortly.");
    expect(noticeText("brief.still-preparing", { wait: "2 minutes" })).toBe("Daily Brief is still being prepared. Try again in about 2 minutes.");
  });

  it("throws on a missing value instead of showing a placeholder", () => {
    expect(() => noticeText("move.moved", { title: "Run" })).toThrow(/needs "time"/);
  });

  it("keeps the server's move refusal sentences in the catalog", () => {
    for (const reason of MOVE_REFUSAL_REASONS) {
      expect(MOVE_REFUSAL_MESSAGES[reason]).toBe(noticeText(`move.refused.${reason.replaceAll("_", "-")}` as NoticeId));
    }
  });
});

describe("Notice", () => {
  it("draws an outcome in italic Ink with its action upright", () => {
    const html = renderToStaticMarkup(<Notice id="move.moved" params={{ title: "Run", time: "9:30 AM" }} action={<button type="button">Undo</button>} />);
    expect(html).toContain('data-notice="move.moved"');
    expect(html).toContain("italic text-foreground");
    expect(html).toContain('role="status"');
    expect(html).toContain('<span class="not-italic"><button type="button">Undo</button></span>');
  });

  it("draws an error as one Rust Signal line with its label", () => {
    const html = renderToStaticMarkup(<Notice id="move.refused.slot-taken" />);
    expect(html).toContain('data-notice="move.refused.slot-taken"');
    expect(html).toContain('<p class="text-alert-signal">Not changed. Something else is already at that time.</p>');
    expect(html).toContain('role="alert"');
  });

  it("draws an error without a label as the sentence alone", () => {
    const html = renderToStaticMarkup(<Notice id="move.conflict-not-saved" />);
    expect(html).toContain('<p class="text-alert-signal">That answer was not saved. Try again.</p>');
  });

  it("draws a note in Readable Ash and does not announce it", () => {
    const html = renderToStaticMarkup(<Notice id="move.first-move" className="text-xs" />);
    expect(html).toBe('<p data-notice="move.first-move" class="text-muted-readable text-xs">This changes today only. Your schedule stays.</p>');
  });
});

/** Raw role="status" / role="alert" outside components/feedback: counts may only go down. */
describe("notices by construction", () => {
  const roots = ["app", "components", "apps/desktop/src"];
  const pattern = /role="(status|alert)"|role=\{/g;
  const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "node_modules" || name === "src-tauri") return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
  const counts = new Map<string, number>();
  for (const directory of roots) {
    for (const path of walk(join(root, directory))) {
      const file = relative(root, path).replaceAll("\\", "/");
      if (file.startsWith("components/feedback/") || file.startsWith("app/design-system/")) continue;
      const count = readFileSync(path, "utf8").match(pattern)?.length ?? 0;
      if (count) counts.set(file, count);
    }
  }
  const allowed: Readonly<Record<string, number>> = allowlist.files;

  it("adds no new raw status or alert roles", () => {
    const over = [...counts].filter(([file, count]) => count > (allowed[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} (allowed ${allowed[file] ?? 0}). Show it with <Notice> from components/feedback/Notice.tsx.`);
    expect(over).toEqual([]);
  });

  it("lowers the allowance when a file needs fewer", () => {
    const under = Object.entries(allowed).filter(([file, count]) => (counts.get(file) ?? 0) < count)
      .map(([file, count]) => `${file}: allowed ${count}, uses ${counts.get(file) ?? 0}. Lower it in tests/fixtures/notice-role-allowlist.json.`);
    expect(under).toEqual([]);
  });
});
