// Ticket 380 (D36). Listing screenshots of the "Cadence day" MCP Apps view.
//
// Claude's directory asks an MCP App for 3 to 5 carousel screenshots: PNG, at
// least 1000 px wide, cropped to the app response, each with its prompt given
// separately (https://claude.com/docs/connectors/building/submission.md, read
// 2026-11-26). This script makes that set and publishes nothing. It talks to
// no provider: bench mode loads a loopback page only, and host mode reads a
// tab that an acceptance run already opened.
//
//   bench  Today's mode. Loads /design-system?preview=mcp-day-view from a local
//          `npm run dev` in headless Chrome and captures the view frame from
//          fixtures. These are BENCH captures: files are named `bench-*` and
//          every sidecar says `listing_candidate: false`. They show what the
//          set will look like. They are not listing screenshots.
//   host   For Ticket 378 runs. Attaches to the Cadence QA Chrome profile and
//          captures the view frame in an open Claude web or ChatGPT web tab. It
//          never navigates, types or clicks. Other hosts' harnesses call
//          captureHostView() with their own page.
//   list   Prints the shot IDs and prompts.
//
// Each capture writes `<source>-<id>.png` and `<source>-<id>.json` (the paired
// prompt and what was captured), mode 0600, into a directory git ignores
// (default .local/listing-captures/). The docs' copy of the prompts is
// docs/qa/mcp-directory-submission.md, "Unpublished MCP Apps listing drafts";
// a test keeps the two equal.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_OUT_DIR = join(REPO_ROOT, '.local', 'listing-captures');
export const MIN_WIDTH_PX = 1000;
export const BENCH_PREVIEW = 'mcp-day-view';
/** The bench frame that holds the shipped view bundle (app/design-system/McpDayViewBench.tsx). */
export const BENCH_FRAME = '[data-bench-card] iframe';
export const BENCH_LABEL = 'Bench capture from design-system fixtures. Not a listing screenshot: no AI client rendered it.';
export const HOST_LABEL = 'Host capture from an acceptance run on a test account. The owner reviews it before any listing use.';

export class CaptureStop extends Error {
  constructor(reason, detail = null) {
    super(detail ? `${reason} (${detail})` : reason);
    this.name = 'CaptureStop';
    this.reason = reason;
    this.detail = detail;
  }
}

const shot = (value) => Object.freeze({ ...value, bench: Object.freeze(value.bench), steps: Object.freeze((value.steps ?? []).map(Object.freeze)) });

/**
 * The listing set: 3 to 5 shots, each with the prompt a person would type.
 * `bench` picks the fixture state; `steps` run inside the view frame before
 * the capture (click, then wait for `until`; or fill a field). On a real host
 * the Ticket 378 run sends the prompt and performs the same clicks.
 */
export const LISTING_SHOTS = Object.freeze([
  shot({
    id: 'today',
    prompt: 'Show my Cadence day.',
    shows: 'Today with a day note, the Needs decision count line and rows with Completed, Not Completed and Note.',
    bench: { state: 'normal', theme: 'light' },
  }),
  shot({
    id: 'mark-completed',
    prompt: 'I just finished my morning walk. Open today in Cadence so I can mark it.',
    shows: 'The same day after the person clicked Completed on Morning walk.',
    bench: { state: 'normal', theme: 'light' },
    steps: [{ click: '[data-action="completed"][aria-label="Completed, Morning walk"]', until: '[data-action="completed"][aria-label="Completed, Morning walk"][aria-pressed="true"]' }],
  }),
  shot({
    id: 'routine-steps',
    prompt: 'Show today in Cadence. I want to see the steps of my skin routine.',
    shows: 'A routine opened to its steps, with the progress the server derived.',
    bench: { state: 'parent', theme: 'light' },
    steps: [{ click: '[data-action="steps"]', until: 'ul.steps' }],
  }),
  shot({
    id: 'note',
    prompt: 'Open my Cadence day. I want to add a note to Stretch.',
    shows: 'The note editor open on one row, before Save note.',
    bench: { state: 'normal', theme: 'light' },
    steps: [
      { click: '[data-action="note"][aria-label="Note, Stretch"]', until: '[data-note-editor] textarea' },
      { fill: '[data-note-editor] textarea', text: 'Moved it to the afternoon.' },
    ],
  }),
  shot({
    id: 'connected-service',
    prompt: 'Show today in Cadence, with anything a connected service marked.',
    shows: 'Dark theme. A row a connected service marked reads "Completed · From Hevy"; the person can still change it.',
    bench: { state: 'connector', theme: 'dark' },
  }),
]);

export const shotById = (id) => LISTING_SHOTS.find((s) => s.id === id) ?? null;

// ---- Checks -------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Width and height from a PNG's IHDR chunk. Throws `not-png` for anything else. */
export function pngSize(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') throw new CaptureStop('not-png');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const inside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** True when git ignores a file in `dir`. A failure to ask counts as "not ignored". */
export function gitIgnores(dir, repoRoot = REPO_ROOT) {
  try {
    execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', join(dir, 'capture.png')], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch { return false; }
}

/**
 * The output directory, resolved. A directory inside the repository must be
 * one git ignores, so a capture can never be committed by accident.
 */
export function assertOutDir(dir, { repoRoot = REPO_ROOT, isIgnored = gitIgnores } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new CaptureStop('out-dir-invalid');
  const full = resolve(dir);
  if (inside(full, resolve(repoRoot)) && !isIgnored(full, repoRoot)) throw new CaptureStop('out-dir-not-ignored');
  return full;
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const isLoopback = (url) => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) && LOOPBACK_HOSTS.includes(parsed.hostname);
  } catch { return false; }
};

/** The bench exists only in development (it is a 404 in production), so its URL must be loopback. */
export function benchUrl(baseUrl, bench) {
  if (!isLoopback(baseUrl) || !/^https?:/.test(baseUrl)) throw new CaptureStop('bench-url-not-local');
  const url = new URL('/design-system', baseUrl);
  // Claude's published style variables and the 720px frame, the widest the bench offers.
  url.search = new URLSearchParams({ preview: BENCH_PREVIEW, state: bench.state, theme: bench.theme, host: 'claude', layout: 'desktop' }).toString();
  return url.href;
}

// ---- Capture --------------------------------------------------------------------

/**
 * Screenshot `target` (a Playwright locator) and write the PNG and its sidecar.
 * `zoom` multiplies the page's own pixel density for this one image; it is
 * taken through DevTools with a scaled clip, so the page itself is not changed.
 * Nothing is written when the image is narrower than the listing minimum.
 */
export async function saveCapture({ target, shot: wanted, outDir, source, host = null, bench = null, zoom = null, minWidth = MIN_WIDTH_PX, now = () => new Date() }) {
  if (source !== 'bench' && source !== 'host') throw new CaptureStop('source-invalid');
  let bytes;
  try {
    bytes = zoom === null ? await target.screenshot({ type: 'png', scale: 'device', animations: 'disabled', timeout: 15_000 }) : await zoomedShot(target, zoom);
  } catch { throw new CaptureStop('screenshot-failed', wanted.id); }
  const { width, height } = pngSize(bytes);
  if (width < minWidth) throw new CaptureStop('too-narrow', `${wanted.id}: ${width}px`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const name = `${source}-${wanted.id}`;
  const record = {
    id: wanted.id,
    file: `${name}.png`,
    prompt: wanted.prompt,
    source,
    // Only a capture from a real AI client can go on a listing, and only after the owner looks at it.
    listing_candidate: source === 'host',
    label: source === 'bench' ? BENCH_LABEL : HOST_LABEL,
    host,
    bench,
    format: 'png',
    width,
    height,
    captured_at: now().toISOString(),
  };
  for (const [file, data] of [[`${name}.png`, bytes], [`${name}.json`, `${JSON.stringify(record, null, 2)}\n`]]) {
    const path = join(outDir, file);
    writeFileSync(path, data, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return record;
}

/** The element's box as a PNG at `zoom` times the page's pixel density. */
async function zoomedShot(target, zoom) {
  const page = target.page();
  await target.scrollIntoViewIfNeeded({ timeout: 15_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error('no box');
  const session = await page.context().newCDPSession(page);
  try {
    const { visualViewport } = await session.send('Page.getLayoutMetrics');
    const clip = { x: visualViewport.pageX + box.x, y: visualViewport.pageY + box.y, width: box.width, height: box.height, scale: zoom };
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  } finally {
    await session.detach().catch(() => {});
  }
}

/** Waits until the element's box stops changing: the view resizes its frame after each render. */
async function settle(locator, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const box = await locator.boundingBox().catch(() => null);
    const key = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null;
    if (key && key === last) return;
    last = key;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new CaptureStop('view-not-ready', 'frame size kept changing');
}

async function runSteps(frame, steps, timeoutMs) {
  for (const step of steps) {
    if (step.click) {
      // A DOM click, not a pointer click at coordinates: the frame can still move
      // while the page around it settles, and a pointer click would then miss.
      const control = frame.locator(step.click).first();
      await control.waitFor({ state: 'visible', timeout: timeoutMs });
      await control.evaluate((element) => element.click());
      if (step.until) await frame.locator(step.until).first().waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (step.fill) {
      await frame.locator(step.fill).first().fill(step.text, { timeout: timeoutMs });
    }
  }
}

/**
 * Bench mode. Captures every shot from the design-system bench at `baseUrl`.
 * The browser context refuses every request that is not loopback, so a bench
 * capture can reach no provider. Returns the sidecar records and how many
 * requests were refused.
 */
export async function captureBench({ browser, baseUrl, outDir, shots = LISTING_SHOTS, scale = 2, timeoutMs = 30_000, repoRoot = REPO_ROOT, isIgnored = gitIgnores, now }) {
  const dir = assertOutDir(outDir, { repoRoot, isIgnored });
  const urls = shots.map((s) => benchUrl(baseUrl, s.bench));
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: scale });
  let blockedRequests = 0;
  await context.route('**/*', (route) => {
    if (isLoopback(route.request().url())) return route.continue();
    blockedRequests += 1;
    return route.abort();
  });
  const captures = [];
  try {
    for (const [index, wanted] of shots.entries()) {
      const page = await context.newPage();
      try {
        try {
          await page.goto(urls[index], { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          const frame = page.frameLocator(BENCH_FRAME);
          // The view's heading appears once the mock host has sent the day.
          await frame.locator('main.day h1').first().waitFor({ state: 'visible', timeout: timeoutMs });
          await runSteps(frame, wanted.steps, timeoutMs);
        } catch (error) {
          if (error instanceof CaptureStop) throw error;
          throw new CaptureStop('view-not-ready', `${wanted.id}: ${String(error?.message ?? error).split('\n')[0].slice(0, 200)}`);
        }
        const target = page.locator(BENCH_FRAME).first();
        await settle(target, { timeoutMs });
        captures.push(await saveCapture({ target, shot: wanted, outDir: dir, source: 'bench', bench: { ...wanted.bench, host: 'claude', layout: 'desktop' }, now }));
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { outDir: dir, captures, blockedRequests };
}

/**
 * Host mode, and the hook for Ticket 378's harnesses. `page` shows a
 * conversation in which the host has rendered the view; `selector` names the
 * view's frame. The capture is that frame alone, so no prompt, sidebar or chat
 * title is in the image. The page is not navigated, typed into or clicked.
 * `scale` multiplies the page's own pixel density for the image, for a frame
 * that is narrower than the listing minimum otherwise.
 */
export async function captureHostView({ page, shot: wanted, selector, outDir, host, scale = null, repoRoot = REPO_ROOT, isIgnored = gitIgnores, now }) {
  const dir = assertOutDir(outDir, { repoRoot, isIgnored });
  if (typeof host !== 'string' || !/^[a-z0-9-]{1,40}$/.test(host)) throw new CaptureStop('host-invalid');
  const target = page.locator(selector).last();
  if (!(await target.isVisible().catch(() => false))) throw new CaptureStop('view-not-found', wanted.id);
  // A host runs the view in an iframe. Anything else could be the conversation itself.
  if ((await target.evaluate((el) => el.tagName).catch(() => null)) !== 'IFRAME') throw new CaptureStop('view-not-a-frame', wanted.id);
  return saveCapture({ target, shot: wanted, outDir: dir, source: 'host', host, zoom: scale, now });
}

// ---- CLI ------------------------------------------------------------------------

const HOST_CLIENTS = Object.freeze(['claude-web', 'chatgpt']);

export function parseCli(argv) {
  const command = ['bench', 'host', 'list'].includes(argv[0]) ? argv[0] : null;
  if (!command) throw new CaptureStop('command-invalid');
  const { values } = parseArgs({ args: argv.slice(1), strict: true, allowPositionals: false, options: {
    'base-url': { type: 'string' }, out: { type: 'string' }, shot: { type: 'string' }, scale: { type: 'string' },
    client: { type: 'string' }, selector: { type: 'string' }, profile: { type: 'string' }, port: { type: 'string' },
  } });
  if (command === 'list') return { command };
  if (values.shot !== undefined && !shotById(values.shot)) throw new CaptureStop('shot-unknown');
  const scale = values.scale === undefined ? null : Number(values.scale);
  if (scale !== null && !(Number.isFinite(scale) && scale >= 1 && scale <= 4)) throw new CaptureStop('scale-invalid');
  if (command === 'bench') {
    const baseUrl = values['base-url'] ?? 'http://127.0.0.1:3000';
    benchUrl(baseUrl, LISTING_SHOTS[0].bench);
    return { command, baseUrl, outDir: values.out ?? join(DEFAULT_OUT_DIR, 'bench'), shots: values.shot ? [shotById(values.shot)] : [...LISTING_SHOTS], scale: scale ?? 2 };
  }
  if (!HOST_CLIENTS.includes(values.client)) throw new CaptureStop('client-invalid');
  if (!values.shot) throw new CaptureStop('shot-required');
  if (!values.selector) throw new CaptureStop('selector-required');
  const port = values.port === undefined ? null : Number(values.port);
  if (port !== null && !Number.isInteger(port)) throw new CaptureStop('port-invalid');
  return { command, client: values.client, shot: shotById(values.shot), selector: values.selector, profile: values.profile ?? null, port, outDir: values.out ?? join(DEFAULT_OUT_DIR, 'host', values.client), scale };
}

/** Host mode from the command line: the open Cadence QA Chrome profile, Claude web or ChatGPT web. */
async function runHost(opts) {
  const web = await import('./web-client.mjs');
  const site = web.SITES[opts.client];
  const { context, detach } = await web.attachProfile({ profileDir: opts.profile ?? web.DEFAULT_PROFILE_DIR, port: opts.port ?? web.DEFAULT_DEBUG_PORT });
  try {
    const pages = context.pages().filter((p) => { try { return new URL(p.url()).origin === site.origin; } catch { return false; } });
    for (const page of pages) {
      if (await page.locator(opts.selector).last().isVisible().catch(() => false)) {
        return await captureHostView({ page, shot: opts.shot, selector: opts.selector, outDir: opts.outDir, host: opts.client, scale: opts.scale });
      }
    }
    throw new CaptureStop('view-not-found', opts.shot.id);
  } finally {
    await detach();
  }
}

export async function main(argv = process.argv.slice(2), out = (line) => process.stdout.write(`${line}\n`)) {
  let opts;
  try { opts = parseCli(argv); } catch (error) {
    out(JSON.stringify({ step: 'usage', ok: false, reason: error instanceof CaptureStop ? error.reason : 'usage-invalid' }));
    return 2;
  }
  if (opts.command === 'list') {
    for (const s of LISTING_SHOTS) out(JSON.stringify({ id: s.id, prompt: s.prompt, shows: s.shows }));
    return 0;
  }
  const line = (record) => JSON.stringify({ step: 'capture', ok: true, id: record.id, file: record.file, source: record.source, listing_candidate: record.listing_candidate, width: record.width, height: record.height });
  try {
    if (opts.command === 'bench') {
      const { launchChrome } = await import('./consent-page.mjs');
      const browser = await launchChrome({ headless: true });
      try {
        const result = await captureBench({ browser, baseUrl: opts.baseUrl, outDir: opts.outDir, shots: opts.shots, scale: opts.scale });
        for (const record of result.captures) out(line(record));
        out(JSON.stringify({ step: 'done', ok: true, source: 'bench', count: result.captures.length, blockedRequests: result.blockedRequests, note: BENCH_LABEL }));
      } finally {
        await browser.close().catch(() => {});
      }
      return 0;
    }
    out(line(await runHost(opts)));
    return 0;
  } catch (error) {
    // WebStop (profile and port checks) and AcceptanceError carry a fixed reason or code too.
    const reason = error?.reason ?? error?.code ?? 'capture-failed';
    out(JSON.stringify({ step: 'capture', ok: false, reason: typeof reason === 'string' ? reason : 'capture-failed', detail: error instanceof CaptureStop ? error.detail : null }));
    return 1;
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
