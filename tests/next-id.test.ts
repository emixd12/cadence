import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Found = { ref: string; value: number };
type Result = { sequence: { label: string }; found: Found[] };
type NextIdModule = {
  parseTicketNumbers: (text: string) => number | null;
  parseDecisionIds: (text: string) => number | null;
  parseMessagingIds: (text: string) => number | null;
  parseLegalIds: (text: string) => number | null;
  parseDesktopMigrationNumbers: (names: string[]) => number | null;
  listRemoteRefs: (root: string) => string[];
  collectIds: (root: string, refs?: string[]) => Result[];
  formatLine: (result: Result) => string;
};

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

let ids: NextIdModule;
let tmp: string;

beforeAll(async () => {
  // @ts-expect-error The command is a plain Node ESM script.
  ids = await import("../scripts/next-id.mjs");
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-next-id-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(root: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

function commitAs(root: string, ref: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", ref);
  git(root, "update-ref", `refs/remotes/${ref}`, "HEAD");
}

describe("id parsers", () => {
  it("reads ticket headings, letter suffixes and ranges", () => {
    expect(ids.parseTicketNumbers("## Ticket 025A: x\n## Ticket 351: y\n## Tickets 343–348: avatar\n### Ticket 157 follow-up: z")).toBe(351);
    expect(ids.parseTicketNumbers("## Tickets 310–360: range end wins\n## Ticket 355: y")).toBe(360);
    expect(ids.parseTicketNumbers("Ticket 999 in prose only")).toBeNull();
  });

  it("reads decision IDs without matching D-numbers or longer words", () => {
    expect(ids.parseDecisionIds("## 2026-11-16: Advisor plan (D32)\n1. **D30.1: positioning.** see D31")).toBe(32);
    expect(ids.parseDecisionIds("D-99 and AD40 and D41x are not decisions; D7 is")).toBe(7);
  });

  it("reads P- and L- entries, including both ends of a range", () => {
    expect(ids.parseMessagingIds("## P-087: a\nrenumbered to P-082–P-091\nCOP-500")).toBe(91);
    expect(ids.parseLegalIds("## L-024: a\n## L-026: b\nP-900")).toBe(26);
    expect(ids.parseLegalIds("nothing")).toBeNull();
  });

  it("reads desktop migration numbers from file names", () => {
    expect(ids.parseDesktopMigrationNumbers(["0001_a.sql", "0028_sub_behaviors.sql", "README.md"])).toBe(28);
  });
});

describe("ids:next across refs", () => {
  it("reports the highest value per sequence and the branches ahead of main", () => {
    const root = path.join(tmp, "repo");
    fs.mkdirSync(root);
    git(root, "init", "--quiet", "-b", "main");
    commitAs(root, "origin/main", {
      "docs/TICKETS.md": "## Ticket 355: main\n",
      "docs/DECISIONS.md": "## x (D32)\n",
      "packages/core/src/resolvers/account-sync.resolver.ts": "export const ACCOUNT_SYNC_CONTRACT = 9;\n",
      "apps/desktop/src-tauri/migrations/0028_sub_behaviors.sql": "",
    });
    commitAs(root, "origin/feature-a", { "docs/TICKETS.md": "## Ticket 355: main\n## Ticket 356: a\n" });
    git(root, "checkout", "--quiet", "-b", "b", "refs/remotes/origin/main");
    commitAs(root, "origin/feature-b", {
      "docs/TICKETS.md": "## Ticket 355: main\n## Ticket 356: b\n",
      "apps/desktop/src-tauri/migrations/0029_other.sql": "",
    });
    git(root, "checkout", "--quiet", "--detach", "refs/remotes/origin/main");
    write(root, "docs/LEGAL.md", "## L-030: only in the working tree\n");

    expect(ids.listRemoteRefs(root)).toEqual(["origin/main", "origin/feature-a", "origin/feature-b"]);
    const results = ids.collectIds(root);
    const line = (label: string) => ids.formatLine(results.find((result) => result.sequence.label === label)!);

    expect(line("ticket")).toBe("ticket: next Ticket 357 (origin/main Ticket 355; ahead of main: Ticket 356 on origin/feature-a, origin/feature-b [2 branches: check for a collision])");
    expect(line("decision")).toBe("decision: next D33 (origin/main D32)");
    expect(line("legal entry")).toBe("legal entry: next L-031 (origin/main has none; ahead of main: L-030 on working tree)");
    expect(line("messaging entry")).toBe("messaging entry: not found in any ref");
    expect(line("account sync contract")).toBe("account sync contract: next contract 10 (origin/main contract 9)");
    expect(line("desktop SQLite migration")).toBe("desktop SQLite migration: next 0030 (origin/main 0028; ahead of main: 0029 on origin/feature-b)");
  });
});
