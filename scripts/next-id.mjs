#!/usr/bin/env node
// Prints the next free number for each hand-allocated sequence. Parallel branches each
// read "the highest number" from their own checkout and collide; this reads the working
// tree, origin/main and every other origin/* branch, and names the refs that hold the
// highest value so a collision is visible before it lands.
// Usage: npm run ids:next [-- --fetch]   (--fetch runs `git fetch origin --prune` first)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAccountSyncContract } from "./check-contract-numbers.mjs";

export const WORKING_TREE = "working tree";

function highest(values) {
  const numbers = values.filter((value) => Number.isInteger(value));
  return numbers.length ? Math.max(...numbers) : null;
}

/** `## Ticket 355: …`, `## Ticket 025A: …` and range headings like `## Tickets 310–324: …`. */
export function parseTicketNumbers(text) {
  const values = [];
  for (const match of text.matchAll(/^#{2,4} Tickets? (\d+)[A-Z]?(?:\s*[–-]\s*(\d+))?/gm)) {
    values.push(Number(match[1]));
    if (match[2]) values.push(Number(match[2]));
  }
  return highest(values);
}

/** Decision IDs are written `D32` or `(D32)`, with sub-items like `D30.1`; never `D-32`. */
export function parseDecisionIds(text) {
  return highest([...text.matchAll(/(?<![\w-])D(\d{1,3})(?![\w-])/g)].map((match) => Number(match[1])));
}

function prefixedIds(prefix) {
  const pattern = new RegExp(String.raw`(?<![\w-])${prefix}-(\d{3,})(?!\d)`, "g");
  return (text) => highest([...text.matchAll(pattern)].map((match) => Number(match[1])));
}

/** Messaging entries are `P-089`; ranges are written `P-082–P-084`, so each end matches. */
export const parseMessagingIds = prefixedIds("P");
/** Legal entries are `L-026`. */
export const parseLegalIds = prefixedIds("L");

export function parseDesktopMigrationNumbers(names) {
  return highest(names.map((name) => /^(\d{4})_.+\.sql$/.exec(path.posix.basename(name))?.[1]).filter(Boolean).map(Number));
}

const contractOrNull = (text) => {
  try {
    return parseAccountSyncContract(text);
  } catch {
    return null;
  }
};

export const SEQUENCES = [
  { label: "ticket", file: "docs/TICKETS.md", parse: parseTicketNumbers, format: (n) => `Ticket ${n}` },
  { label: "decision", file: "docs/DECISIONS.md", parse: parseDecisionIds, format: (n) => `D${n}` },
  { label: "messaging entry", file: "docs/MESSAGING_CHANGES.md", parse: parseMessagingIds, format: (n) => `P-${String(n).padStart(3, "0")}` },
  { label: "legal entry", file: "docs/LEGAL.md", parse: parseLegalIds, format: (n) => `L-${String(n).padStart(3, "0")}` },
  { label: "account sync contract", file: "packages/core/src/resolvers/account-sync.resolver.ts", parse: contractOrNull, format: (n) => `contract ${n}` },
  { label: "desktop SQLite migration", dir: "apps/desktop/src-tauri/migrations", parse: parseDesktopMigrationNumbers, format: (n) => String(n).padStart(4, "0") },
];

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

export function listRemoteRefs(root) {
  const output = git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/"]) ?? "";
  const refs = output.split("\n").filter((ref) => ref && ref !== "refs/remotes/origin/HEAD")
    .map((ref) => ref.replace(/^refs\/remotes\//, ""));
  return refs.sort((a, b) => (a === "origin/main" ? -1 : b === "origin/main" ? 1 : a.localeCompare(b)));
}

function readSource(root, ref, sequence) {
  if (ref === WORKING_TREE) {
    const target = path.join(root, sequence.file ?? sequence.dir);
    if (!fs.existsSync(target)) return null;
    return sequence.dir ? fs.readdirSync(target) : fs.readFileSync(target, "utf8");
  }
  if (sequence.dir) {
    const output = git(root, ["ls-tree", "--name-only", `${ref}:${sequence.dir}`]);
    return output === null ? null : output.split("\n").filter(Boolean);
  }
  return git(root, ["show", `${ref}:${sequence.file}`]);
}

/** Returns, per sequence, the value each ref holds (refs without the file are skipped). */
export function collectIds(root, refs = listRemoteRefs(root)) {
  return SEQUENCES.map((sequence) => ({
    sequence,
    found: [WORKING_TREE, ...refs].flatMap((ref) => {
      const source = readSource(root, ref, sequence);
      const value = source === null ? null : sequence.parse(source);
      return value === null ? [] : [{ ref, value }];
    }),
  }));
}

/**
 * One line per sequence: the next free number, the value on origin/main, and every ref
 * that holds a higher value (numbers claimed but not merged). A value held by two or more
 * origin branches is marked, because two branches may have picked the same number.
 */
export function formatLine({ sequence, found }) {
  const top = highest(found.map((entry) => entry.value));
  if (top === null) return `${sequence.label}: not found in any ref`;
  const main = found.find((entry) => entry.ref === "origin/main")?.value ?? null;
  const ahead = new Map();
  for (const entry of found) {
    if (entry.ref === "origin/main" || (main !== null && entry.value <= main)) continue;
    ahead.set(entry.value, [...(ahead.get(entry.value) ?? []), entry.ref]);
  }
  const claims = [...ahead.entries()].sort(([a], [b]) => b - a).map(([value, refs]) => {
    const branches = refs.filter((ref) => ref !== WORKING_TREE).length;
    return `${sequence.format(value)} on ${refs.join(", ")}${branches > 1 ? ` [${branches} branches: check for a collision]` : ""}`;
  });
  const base = main === null ? "origin/main has none" : `origin/main ${sequence.format(main)}`;
  return `${sequence.label}: next ${sequence.format(top + 1)} (${base}${claims.length ? `; ahead of main: ${claims.join("; ")}` : ""})`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])?.trim();
  if (!root) {
    console.error("ids:next must run inside the Cadence git checkout.");
    process.exit(1);
  }
  if (process.argv.includes("--fetch")) {
    const fetched = spawnSync("git", ["fetch", "origin", "--prune"], { cwd: root, stdio: "inherit" });
    if (fetched.status !== 0) console.error("git fetch origin --prune failed; using the refs already present.");
  }
  const refs = listRemoteRefs(root);
  for (const result of collectIds(root, refs)) console.log(formatLine(result));
  console.log(`(read the working tree and ${refs.length} origin/* ref(s); pass --fetch to refresh them)`);
}
