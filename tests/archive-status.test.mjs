import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIndex,
  INDEX_BEGIN,
  INDEX_END,
  main,
  parseArchive,
  parseHeadingDate,
  parseStatus,
  planArchive,
  renderStatus,
  replaceGeneratedIndex,
  STATUS_MAX_BYTES,
  ticketsInHeading,
} from '../scripts/archive-status.mjs';

const filler = (label, lines) => Array.from({ length: lines }, (_, i) => `${label} line ${i + 1} ${'x'.repeat(60)}`).join('\n');
const entry = (title, date, lines = 3) => `## ${title} — ${date}\n\n${filler(title, lines)}`;
const status = (entries) =>
  ['# Implementation Status', '', '## Update rules', '', 'Rules text.', '', '## Recent entries', '', ...entries.flatMap((e) => [e, ''])].join('\n');

describe('parseHeadingDate', () => {
  it('reads named, ranged, suffixed and ISO dates', () => {
    expect(parseHeadingDate('## Ticket 285: run — November 6–7, 2026')?.iso).toBe('2026-11-06');
    expect(parseHeadingDate('## Candidate — October 20, 2026 (superseded by 0.1.3)')?.iso).toBe('2026-10-20');
    expect(parseHeadingDate('## Rename — completed October 9, 2026')?.iso).toBe('2026-10-09');
    expect(parseHeadingDate('## Desktop repair acceptance — 2026-09-09')?.iso).toBe('2026-09-09');
    expect(parseHeadingDate('## Function')).toBeNull();
  });
});

describe('ticketsInHeading', () => {
  it('expands lists and ranges', () => {
    expect(ticketsInHeading('## Ticket 285: installed Mac acceptance')).toEqual([285]);
    expect(ticketsInHeading('## Tickets 178 and 181: 0.1.2')).toEqual([178, 181]);
    expect(ticketsInHeading('## Tickets 165, 212 and 216–219 on Ticket 215')).toEqual([165, 212, 215, 216, 217, 218, 219]);
    expect(ticketsInHeading('## Roadmap (Tickets 063-066)')).toEqual([63, 64, 65, 66]);
    expect(ticketsInHeading('## Ticket 184 candidate 2 and Ticket 188')).toEqual([184, 188]);
    expect(ticketsInHeading('## PR #150 review follow-ups')).toEqual([]);
  });
});

describe('parseStatus and renderStatus', () => {
  it('keeps the head and groups undated sections with the entry above', () => {
    const text = status([entry('B', 'November 2, 2026'), entry('A', 'October 9, 2026'), '## Function\n\nUndated text.']);
    const parsed = parseStatus(text);
    expect(parsed.head[parsed.head.length - 1]).toBe('## Recent entries');
    expect(parsed.entries.map((e) => e.heading)).toEqual(['## B — November 2, 2026', '## A — October 9, 2026']);
    expect(parsed.entries[1].lines).toContain('## Function');
    expect(renderStatus(parseStatus(renderStatus(parsed)))).toBe(renderStatus(parsed));
  });

  it('ignores headings inside fenced code', () => {
    const text = status([`${entry('A', 'October 9, 2026')}\n\n\`\`\`md\n## Not a heading — October 1, 2026\n\`\`\``]);
    expect(parseStatus(text).entries).toHaveLength(1);
  });

  it('rejects a file without the Recent entries heading', () => {
    expect(() => parseStatus('# Implementation Status\n\n## Old entry — October 1, 2026\n')).toThrow(/Recent entries/);
  });
});

describe('planArchive', () => {
  const entries = [
    entry('E5', 'November 3, 2026', 40),
    entry('E4', 'November 1, 2026', 40),
    entry('E3', 'October 30, 2026', 40),
    entry('E2', 'October 20, 2026', 40),
    entry('E1', 'September 28, 2026', 40),
  ];

  it('moves the oldest entries to monthly files, newest first, until the target size', () => {
    const result = planArchive(status(entries), {}, { targetBytes: 4000, minEntries: 1 });
    expect(Buffer.byteLength(result.statusText)).toBeLessThanOrEqual(4000);
    expect(result.moved.map((m) => m.file)).toEqual(['2026-11.md', '2026-10.md', '2026-10.md', '2026-09.md']);
    expect(Object.keys(result.archives).sort()).toEqual(['2026-09.md', '2026-10.md', '2026-11.md']);
    const october = parseArchive(result.archives['2026-10.md']);
    expect(october.header[0]).toBe('# Status archive — October 2026');
    expect(october.entries.map((e) => e.heading)).toEqual(['## E3 — October 30, 2026', '## E2 — October 20, 2026']);
    expect(parseStatus(result.statusText).entries.map((e) => e.heading)).toEqual(['## E5 — November 3, 2026']);
  });

  it('keeps the minimum number of entries even above the target', () => {
    const result = planArchive(status(entries), {}, { targetBytes: 10, minEntries: 3 });
    expect(parseStatus(result.statusText).entries).toHaveLength(3);
    expect(result.moved).toHaveLength(2);
  });

  it('puts newly moved entries above older archived entries', () => {
    const existing = '# Status archive — October 2026\n\nIntro.\n\n## Old — October 2, 2026\n\nOld text.\n';
    const result = planArchive(status(entries.slice(0, 4)), { '2026-10.md': existing }, { targetBytes: 10, minEntries: 2 });
    const october = parseArchive(result.archives['2026-10.md']);
    expect(october.header).toEqual(['# Status archive — October 2026', '', 'Intro.']);
    expect(october.entries.map((e) => e.heading)).toEqual([
      '## E3 — October 30, 2026',
      '## E2 — October 20, 2026',
      '## Old — October 2, 2026',
    ]);
  });

  it('preserves every non-blank line', () => {
    const text = status(entries);
    const result = planArchive(text, {}, { targetBytes: 10, minEntries: 1 });
    const after = [result.statusText, ...Object.values(result.archives)].join('\n').split('\n');
    for (const line of text.split('\n').filter((l) => l.trim())) expect(after).toContain(line);
  });

  it('changes nothing on a second run', () => {
    const first = planArchive(status(entries), {}, { targetBytes: 4000, minEntries: 1 });
    const second = planArchive(first.statusText, first.archives, { targetBytes: 4000, minEntries: 1 });
    expect(second.statusText).toBe(first.statusText);
    expect(second.archives).toEqual({});
    expect(second.moved).toEqual([]);
  });

  it('refuses to archive an undated entry', () => {
    const text = status(['## Undated top\n\nText.', entry('A', 'October 9, 2026')]);
    expect(() => planArchive(text, {}, { targetBytes: 10, minEntries: 0 })).toThrow(/no date/);
  });
});

describe('index', () => {
  const files = [
    { name: '2026-10.md', text: '# Status archive — October 2026\n\n## Ticket 186: rename — completed October 9, 2026\n\nText.\n\n## Function\n\nText.\n\n## Tickets 233–235 connectors — October 18, 2026\n\n### Ticket 240 | iCloud\n' },
    { name: 'legacy-current-repository-state.md', text: '# Legacy\n\n## Current repository state\n\n## Export prompt library (Ticket 061)\n' },
    { name: '2026-11.md', text: '# Status archive — November 2026\n\n## Ticket 285: run — November 6–7, 2026\n' },
  ];

  it('lists files with date ranges and counts, and indexes tickets in order', () => {
    const index = buildIndex(files);
    expect(index).toContain('| [2026-10.md](archive/2026-10.md) | 2026-10-09 to 2026-10-18 | 2 |');
    expect(index.indexOf('2026-11.md')).toBeLessThan(index.indexOf('2026-10.md'));
    expect(index).toContain('| [legacy-current-repository-state.md](archive/legacy-current-repository-state.md) | legacy, mostly undated | 2 sections |');
    expect(index).toContain('| 061 | legacy-current-repository-state.md | Export prompt library (Ticket 061) |');
    expect(index).toContain('| 234 | 2026-10.md | Tickets 233–235 connectors — October 18, 2026 |');
    expect(index).toContain('| 240 | 2026-10.md | Ticket 240 \\| iCloud |');
    const rows = index.split('\n').filter((l) => /^\| \d{3} \|/.test(l)).map((l) => Number(l.slice(2, 5)));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('replaces only the generated block and is stable', () => {
    const readme = `# Status archive\n\nIntro.\n\n${INDEX_BEGIN}\nold\n${INDEX_END}\n\nAfter.\n`;
    const once = replaceGeneratedIndex(readme, 'NEW');
    expect(once).toContain(`${INDEX_BEGIN}\n\nNEW\n\n${INDEX_END}`);
    expect(once.startsWith('# Status archive\n\nIntro.\n\n')).toBe(true);
    expect(once.endsWith('\n\nAfter.\n')).toBe(true);
    expect(replaceGeneratedIndex(once, 'NEW')).toBe(once);
    expect(replaceGeneratedIndex('# Readme\n', 'NEW')).toContain(INDEX_END);
  });
});

describe('main', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
  });

  it('--check fails only above the limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'cadence-status-'));
    roots.push(root);
    writeFileSync(join(root, 'STATUS.md'), status([entry('A', 'October 9, 2026')]));
    expect(main(['--check'], root)).toBe(0);
    writeFileSync(join(root, 'STATUS.md'), `${status([entry('A', 'October 9, 2026')])}${'y'.repeat(STATUS_MAX_BYTES)}`);
    expect(main(['--check'], root)).toBe(1);
  });

  it('archives, writes the index, and is a no-op the second time', () => {
    const root = mkdtempSync(join(tmpdir(), 'cadence-status-'));
    roots.push(root);
    const many = Array.from({ length: 12 }, (_, i) => entry(`Ticket ${300 - i}`, `October ${28 - i}, 2026`, 60));
    writeFileSync(join(root, 'STATUS.md'), status(many));
    expect(main([], root)).toBe(0);
    const statusAfter = readFileSync(join(root, 'STATUS.md'), 'utf8');
    const archive = readFileSync(join(root, 'docs/status/archive/2026-10.md'), 'utf8');
    const readme = readFileSync(join(root, 'docs/status/README.md'), 'utf8');
    expect(Buffer.byteLength(statusAfter)).toBeLessThanOrEqual(30_000);
    expect(readme).toContain('| 289 | 2026-10.md | Ticket 289 — October 17, 2026 |');
    expect(readme).not.toContain('| 300 |');
    expect(main([], root)).toBe(0);
    expect(readFileSync(join(root, 'STATUS.md'), 'utf8')).toBe(statusAfter);
    expect(readFileSync(join(root, 'docs/status/archive/2026-10.md'), 'utf8')).toBe(archive);
    expect(readFileSync(join(root, 'docs/status/README.md'), 'utf8')).toBe(readme);
  });
});
