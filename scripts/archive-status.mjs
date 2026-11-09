#!/usr/bin/env node
// Keeps STATUS.md bounded by moving its oldest dated entries, unchanged, into
// docs/status/archive/YYYY-MM.md, and regenerates the index in docs/status/README.md.
//
//   node scripts/archive-status.mjs           move entries until STATUS.md <= 30,000 bytes
//   node scripts/archive-status.mjs --check   exit 1 when STATUS.md > 40,000 bytes
//   node scripts/archive-status.mjs --index   regenerate the index only
//
// The parsing and moving logic lives in exported pure functions; tests use
// in-memory strings (tests/archive-status.test.mjs).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STATUS_MAX_BYTES = 40_000;
export const STATUS_TARGET_BYTES = 30_000;
export const MIN_RECENT_ENTRIES = 3;
export const RECENT_ENTRIES_HEADING = "## Recent entries";
export const INDEX_BEGIN =
  "<!-- BEGIN GENERATED INDEX: run `npm run status:archive -- --index` to regenerate. Do not edit by hand. -->";
export const INDEX_END = "<!-- END GENERATED INDEX -->";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_DATE = new RegExp(
  `\\b(${MONTHS.join("|")}) (\\d{1,2})(?:[–-]\\d{1,2})?, (\\d{4})\\b`,
  "g",
);
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTHLY_FILE = /^(\d{4})-(\d{2})\.md$/;

export function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

/**
 * Returns the date in an entry heading as { year, month, day, iso } or null.
 * Uses the last "Month D, YYYY" match (a range such as "November 6–7, 2026"
 * counts as its first day), then falls back to the last ISO date.
 */
export function parseHeadingDate(heading) {
  const named = [...heading.matchAll(MONTH_DATE)];
  if (named.length > 0) {
    const [, monthName, day, year] = named[named.length - 1];
    const month = MONTHS.indexOf(monthName) + 1;
    return { year: Number(year), month, day: Number(day), iso: `${year}-${pad(month)}-${pad(day)}` };
  }
  const iso = [...heading.matchAll(ISO_DATE)];
  if (iso.length > 0) {
    const [, year, month, day] = iso[iso.length - 1];
    const monthNumber = Number(month);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return { year: Number(year), month: monthNumber, day: Number(day), iso: `${year}-${month}-${day}` };
    }
  }
  return null;
}

/** Archive file name for a parsed date, for example "2026-10.md". */
export function archiveFileName(date) {
  return `${date.year}-${pad(date.month)}.md`;
}

function trimTrailingBlank(lines) {
  const copy = [...lines];
  while (copy.length > 0 && copy[copy.length - 1].trim() === "") copy.pop();
  return copy;
}

/** Splits lines into a header and `## ` sections, ignoring headings inside fenced code. */
function splitSections(lines) {
  const header = [];
  const sections = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      sections.push([line]);
    } else if (sections.length === 0) {
      header.push(line);
    } else {
      sections[sections.length - 1].push(line);
    }
  }
  return { header, sections };
}

/**
 * Groups `## ` sections into entries. A dated heading starts an entry. A section
 * with no date in its heading belongs to the entry above it. Undated sections
 * before the first dated heading form an entry with date null.
 */
function groupEntries(sections) {
  const entries = [];
  for (const section of sections) {
    const heading = section[0];
    const date = parseHeadingDate(heading);
    if (date || entries.length === 0) {
      entries.push({ heading, date, lines: [...section] });
    } else {
      const last = entries[entries.length - 1];
      last.lines = [...trimTrailingBlank(last.lines), "", ...section];
    }
  }
  return entries.map((entry) => ({ ...entry, lines: trimTrailingBlank(entry.lines) }));
}

/**
 * Parses STATUS.md. Everything up to the "## Recent entries" heading (and any
 * text under it before the first entry) is the head; the rest are entries.
 */
export function parseStatus(text) {
  const lines = text.split("\n");
  const markerIndex = lines.findIndex((line) => line.trimEnd() === RECENT_ENTRIES_HEADING);
  if (markerIndex === -1) {
    throw new Error(`STATUS.md has no "${RECENT_ENTRIES_HEADING}" heading.`);
  }
  const { header: intro, sections } = splitSections(lines.slice(markerIndex + 1));
  const head = trimTrailingBlank([...lines.slice(0, markerIndex + 1), ...intro]);
  return { head, entries: groupEntries(sections) };
}

export function renderStatus({ head, entries }) {
  const blocks = [head.join("\n"), ...entries.map((entry) => entry.lines.join("\n"))];
  return `${blocks.join("\n\n")}\n`;
}

/** Parses an archive file into its header lines and entries. */
export function parseArchive(text) {
  const { header, sections } = splitSections(text.split("\n"));
  return { header: trimTrailingBlank(header), entries: groupEntries(sections) };
}

export function renderArchive({ header, entries }) {
  const blocks = [header.join("\n"), ...entries.map((entry) => entry.lines.join("\n"))].filter(
    (block) => block.length > 0,
  );
  return `${blocks.join("\n\n")}\n`;
}

/** Header for a new monthly archive file. */
export function monthlyArchiveHeader(fileName) {
  const match = fileName.match(MONTHLY_FILE);
  const title = match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : fileName;
  return [
    `# Status archive — ${title}`,
    "",
    "Entries moved unchanged from `STATUS.md` by `npm run status:archive`, newest first.",
    "Index and layout: `docs/status/README.md`.",
  ];
}

/**
 * Moves the oldest entries (the bottom of "Recent entries") into monthly archive
 * files until STATUS.md is at most targetBytes, keeping at least minEntries.
 * Moved entries go to the top of their archive file, above older archived
 * entries, so the original relative order is kept.
 *
 * archives: object mapping archive file name to its current text (missing = new).
 * Returns { statusText, archives (changed files only), moved }.
 */
export function planArchive(
  statusText,
  archives = {},
  { targetBytes = STATUS_TARGET_BYTES, minEntries = MIN_RECENT_ENTRIES } = {},
) {
  const parsed = parseStatus(statusText);
  const kept = [...parsed.entries];
  const moved = [];
  while (kept.length > minEntries && byteLength(renderStatus({ head: parsed.head, entries: kept })) > targetBytes) {
    const entry = kept[kept.length - 1];
    if (!entry.date) {
      throw new Error(`Cannot archive an entry with no date in its heading: ${entry.heading}`);
    }
    moved.unshift(kept.pop());
  }

  const byFile = new Map();
  for (const entry of moved) {
    const name = archiveFileName(entry.date);
    if (!byFile.has(name)) byFile.set(name, []);
    byFile.get(name).push(entry);
  }

  const changed = {};
  for (const [name, entries] of byFile) {
    const existing = archives[name];
    const archive = existing === undefined ? { header: monthlyArchiveHeader(name), entries: [] } : parseArchive(existing);
    changed[name] = renderArchive({ header: archive.header, entries: [...entries, ...archive.entries] });
  }

  return {
    statusText: moved.length > 0 ? renderStatus({ head: parsed.head, entries: kept }) : statusText,
    archives: changed,
    moved: moved.map((entry) => ({ heading: entry.heading, file: archiveFileName(entry.date) })),
  };
}

/**
 * Ticket numbers named in a heading: "Ticket 285", "Tickets 178 and 181",
 * "Tickets 165, 212 and 216–219", "Tickets 063-066". Ranges wider than 60 are
 * not expanded.
 */
export function ticketsInHeading(heading) {
  const numbers = new Set();
  const list = /\bTickets?\s+(\d{1,3}(?:\s*[–-]\s*\d{1,3})?(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)\d{1,3}(?:\s*[–-]\s*\d{1,3})?)*)/g;
  for (const match of heading.matchAll(list)) {
    for (const part of match[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) {
      const range = part.match(/^(\d{1,3})\s*[–-]\s*(\d{1,3})$/);
      if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        if (high >= low && high - low <= 60) {
          for (let n = low; n <= high; n += 1) numbers.add(n);
        } else {
          numbers.add(low);
          numbers.add(high);
        }
      } else if (/^\d{1,3}$/.test(part)) {
        numbers.add(Number(part));
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

function escapeCell(text) {
  return text.replace(/\|/g, "\\|");
}

function headingText(line) {
  return line.replace(/^#+\s+/, "");
}

/**
 * Builds the generated index markdown from archive files.
 * files: array of { name, text }. Monthly files (YYYY-MM.md) come first, newest
 * first; other files follow by name.
 */
export function buildIndex(files) {
  const monthly = files.filter((file) => MONTHLY_FILE.test(file.name)).sort((a, b) => b.name.localeCompare(a.name));
  const other = files.filter((file) => !MONTHLY_FILE.test(file.name)).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...monthly, ...other];

  const lines = ["### Archive files", "", "| File | Date range | Entries |", "| --- | --- | --- |"];
  const ticketRows = [];

  for (const file of ordered) {
    const { entries } = parseArchive(file.text);
    if (MONTHLY_FILE.test(file.name)) {
      const dates = entries.map((entry) => entry.date?.iso).filter(Boolean).sort();
      const range = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "none";
      lines.push(`| [${file.name}](archive/${file.name}) | ${range} | ${entries.length} |`);
    } else {
      const sections = splitSections(file.text.split("\n")).sections.length;
      lines.push(`| [${file.name}](archive/${file.name}) | legacy, mostly undated | ${sections} sections |`);
    }

    let inFence = false;
    for (const line of file.text.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence || !/^#{2,3} /.test(line)) continue;
      for (const ticket of ticketsInHeading(line)) {
        ticketRows.push({ ticket, file: file.name, heading: headingText(line) });
      }
    }
  }

  const fileOrder = new Map(ordered.map((file, index) => [file.name, index]));
  const sortedRows = ticketRows
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => a.ticket - b.ticket || fileOrder.get(a.file) - fileOrder.get(b.file) || a.index - b.index);

  lines.push(
    "",
    "### Ticket index",
    "",
    "Ticket numbers named in `##` and `###` headings of the archive files. Entries still in",
    "`STATUS.md` are not listed; search `STATUS.md` first.",
    "",
    "| Ticket | File | Heading |",
    "| --- | --- | --- |",
  );
  for (const row of sortedRows) {
    lines.push(`| ${pad(row.ticket, 3)} | ${row.file} | ${escapeCell(row.heading)} |`);
  }
  return lines.join("\n");
}

/** Replaces the generated block in README text, appending it when the markers are missing. */
export function replaceGeneratedIndex(readmeText, indexText) {
  const block = `${INDEX_BEGIN}\n\n${indexText}\n\n${INDEX_END}`;
  const begin = readmeText.indexOf(INDEX_BEGIN);
  const end = readmeText.indexOf(INDEX_END);
  if (begin === -1 || end === -1 || end < begin) {
    return `${readmeText.trimEnd()}\n\n${block}\n`;
  }
  return `${readmeText.slice(0, begin)}${block}${readmeText.slice(end + INDEX_END.length)}`;
}

function readArchiveFiles(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs
    .readdirSync(archiveDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(archiveDir, name), "utf8") }));
}

function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

function regenerateIndex(root) {
  const archiveDir = path.join(root, "docs/status/archive");
  const readmePath = path.join(root, "docs/status/README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "# Status archive\n";
  const next = replaceGeneratedIndex(readme, buildIndex(readArchiveFiles(archiveDir)));
  return writeIfChanged(readmePath, next);
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const statusPath = path.join(root, "STATUS.md");
  const statusText = fs.readFileSync(statusPath, "utf8");

  if (argv.includes("--check")) {
    const size = byteLength(statusText);
    if (size > STATUS_MAX_BYTES) {
      console.error(
        `STATUS.md is ${size} bytes; the limit is ${STATUS_MAX_BYTES}. Run \`npm run status:archive\` to move older entries into docs/status/archive/.`,
      );
      return 1;
    }
    console.log(`STATUS.md is ${size} bytes (limit ${STATUS_MAX_BYTES}).`);
    return 0;
  }

  if (!argv.includes("--index")) {
    const archiveDir = path.join(root, "docs/status/archive");
    const current = Object.fromEntries(readArchiveFiles(archiveDir).map((file) => [file.name, file.text]));
    const result = planArchive(statusText, current);
    for (const [name, text] of Object.entries(result.archives)) {
      writeIfChanged(path.join(archiveDir, name), text);
    }
    writeIfChanged(statusPath, result.statusText);
    console.log(
      `Moved ${result.moved.length} entr${result.moved.length === 1 ? "y" : "ies"}; STATUS.md is ${byteLength(result.statusText)} bytes.`,
    );
  }

  const indexChanged = regenerateIndex(root);
  console.log(indexChanged ? "Regenerated docs/status/README.md index." : "Index unchanged.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
