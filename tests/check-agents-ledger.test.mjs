import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  TRACKED_IGNORED_ALLOWLIST,
  duplicateTicketHeadings,
  trackedIgnoredFiles,
} from "../scripts/check-agents.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories = [];

// Every git call runs in a temporary repository with no global or system
// config, so the result does not depend on this checkout's .git (the Dagger
// `test` check mounts another commit's) or on the owner's settings.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function gitOk(cwd, ...args) {
  const result = git(cwd, ...args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.output}`);
  return result.output;
}

function temporaryRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-ledger-"));
  temporaryDirectories.push(directory);
  gitOk(directory, "init", "-q", "-b", "main");
  return directory;
}

function write(directory, relativePath, content) {
  const target = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("duplicateTicketHeadings", () => {
  it("passes on the current docs/TICKETS.md", () => {
    const tickets = fs.readFileSync(path.join(repoRoot, "docs/TICKETS.md"), "utf8");
    expect(duplicateTicketHeadings(tickets)).toEqual([]);
  });

  it("reports a repeated ID with both line numbers, normalising leading zeros", () => {
    const fixture = fs.readFileSync(
      path.join(repoRoot, "tests/fixtures/governance/tickets-duplicate-heading.md"),
      "utf8",
    );
    expect(duplicateTicketHeadings(fixture)).toEqual([
      { id: "25", firstLine: 3, duplicateLine: 19 },
    ]);
  });

  it("treats 025 and 025A as different tickets", () => {
    const content = "## Ticket 025: A\n\n## Ticket 025A: B\n\n## Ticket 025B: C\n";
    expect(duplicateTicketHeadings(content)).toEqual([]);
  });

  it("reports a repeated suffixed ID", () => {
    const content = "## Ticket 025A: A\n\n## Ticket 25A: B\n";
    expect(duplicateTicketHeadings(content)).toEqual([
      { id: "25A", firstLine: 1, duplicateLine: 3 },
    ]);
  });
});

describe("trackedIgnoredFiles", () => {
  it("lists a tracked file that .gitignore matches", () => {
    const repository = temporaryRepository();
    write(repository, ".gitignore", "generated.json\n");
    write(repository, "generated.json", "{}\n");
    write(repository, "kept.txt", "kept\n");
    gitOk(repository, "add", ".gitignore", "kept.txt");
    gitOk(repository, "add", "-f", "generated.json");
    gitOk(repository, "commit", "-q", "-m", "base");

    expect(trackedIgnoredFiles(repository)).toEqual(["generated.json"]);
  });

  it("passes once the file is untracked", () => {
    const repository = temporaryRepository();
    write(repository, ".gitignore", "generated.json\n");
    write(repository, "generated.json", "{}\n");
    gitOk(repository, "add", ".gitignore");
    gitOk(repository, "add", "-f", "generated.json");
    gitOk(repository, "commit", "-q", "-m", "base");
    gitOk(repository, "rm", "-q", "--cached", "generated.json");

    expect(trackedIgnoredFiles(repository)).toEqual([]);
  });

  it("skips allowlisted paths", () => {
    const repository = temporaryRepository();
    const allowed = [...TRACKED_IGNORED_ALLOWLIST][0];
    write(repository, ".gitignore", ".intent/\n");
    write(repository, allowed, "{}\n");
    gitOk(repository, "add", ".gitignore");
    gitOk(repository, "add", "-f", allowed);

    expect(trackedIgnoredFiles(repository)).toEqual([]);
  });

  it("ignores index entries missing from the working tree, as under Dagger's mounted .git", () => {
    const repository = temporaryRepository();
    write(repository, ".gitignore", "generated.json\n");
    write(repository, "generated.json", "{}\n");
    gitOk(repository, "add", ".gitignore");
    gitOk(repository, "add", "-f", "generated.json");
    fs.rmSync(path.join(repository, "generated.json"));

    expect(trackedIgnoredFiles(repository)).toEqual([]);
  });

  it("skips outside a Git work tree and below its top level", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-ledger-plain-"));
    temporaryDirectories.push(plain);
    expect(trackedIgnoredFiles(plain)).toBeNull();

    const repository = temporaryRepository();
    fs.mkdirSync(path.join(repository, "sub"));
    expect(trackedIgnoredFiles(path.join(repository, "sub"))).toBeNull();
  });
});

describe(".gitattributes union merge for docs/TICKETS.md", () => {
  function ledgerRepository({ withAttributes = true } = {}) {
    const repository = temporaryRepository();
    if (withAttributes) fs.copyFileSync(path.join(repoRoot, ".gitattributes"), path.join(repository, ".gitattributes"));
    write(repository, "docs/TICKETS.md", fs.readFileSync(path.join(repoRoot, "docs/TICKETS.md"), "utf8"));
    gitOk(repository, "add", ".");
    gitOk(repository, "commit", "-q", "-m", "base");

    const appendTicket = (branch, heading) => {
      gitOk(repository, "switch", "-q", "-c", branch, "main");
      fs.appendFileSync(path.join(repository, "docs/TICKETS.md"), `\n${heading}\n\nBody for ${branch}.\n`);
      gitOk(repository, "commit", "-q", "-am", heading);
    };
    appendTicket("first", "## Ticket 9001: First branch entry");
    appendTicket("second", "## Ticket 9002: Second branch entry");
    return repository;
  }

  function expectBothEntries(repository) {
    const merged = fs.readFileSync(path.join(repository, "docs/TICKETS.md"), "utf8");
    expect(merged).toContain("## Ticket 9001: First branch entry");
    expect(merged).toContain("## Ticket 9002: Second branch entry");
    expect(merged).not.toMatch(/^(<{7}|={7}|>{7})/m);
    expect(duplicateTicketHeadings(merged)).toEqual([]);
  }

  it("keeps both appended entries under git merge", () => {
    const repository = ledgerRepository();
    gitOk(repository, "switch", "-q", "first");
    const result = git(repository, "merge", "--no-edit", "second");
    expect(result.status, result.output).toBe(0);
    expectBothEntries(repository);
  });

  it("keeps both appended entries under git rebase", () => {
    const repository = ledgerRepository();
    gitOk(repository, "switch", "-q", "second");
    const result = git(repository, "rebase", "first");
    expect(result.status, result.output).toBe(0);
    expectBothEntries(repository);
  });

  it("conflicts without the attribute, so the attribute does the work", () => {
    const repository = ledgerRepository({ withAttributes: false });
    gitOk(repository, "switch", "-q", "first");
    expect(git(repository, "merge", "--no-edit", "second").status).not.toBe(0);
  });
});
