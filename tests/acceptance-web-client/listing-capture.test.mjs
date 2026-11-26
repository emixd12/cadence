// Ticket 380: listing screenshots of the "Cadence day" view. Headless Chrome
// against a stub bench page and a stub chat page on loopback; no Next server,
// no AI client and no provider is contacted.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../../scripts/acceptance/consent-page.mjs';
import {
  BENCH_LABEL, CaptureStop, DEFAULT_OUT_DIR, HOST_LABEL, LISTING_SHOTS, MIN_WIDTH_PX, REPO_ROOT,
  assertOutDir, benchUrl, captureBench, captureHostView, gitIgnores, main, parseCli, pngSize, shotById,
} from '../../scripts/acceptance/listing-capture.mjs';

// The stub view has the selectors the real view uses (packages/mcp-views/src/DayView.tsx).
// Like the real view, it shows its heading only once its click handlers are attached.
const VIEW = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<main class="day">
<button data-action="completed" aria-label="Completed, Morning walk" aria-pressed="false">Completed</button>
<button data-action="note" aria-label="Note, Stretch">Note</button>
<button data-action="steps" aria-expanded="false">Skin routine</button>
<div id="more"></div></main>
<script>
document.querySelector('[data-action="completed"]').addEventListener('click', (e) => e.currentTarget.setAttribute('aria-pressed', 'true'));
document.querySelector('[data-action="note"]').addEventListener('click', () => { document.getElementById('more').innerHTML = '<div data-note-editor><textarea rows="3"></textarea></div>'; });
document.querySelector('[data-action="steps"]').addEventListener('click', () => { document.getElementById('more').innerHTML = '<ul class="steps"><li>Cleanser</li></ul>'; });
document.querySelector('main').insertAdjacentHTML('afterbegin', '<h1>Today</h1>');
</script></body></html>`;
const attr = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const benchPage = () => `<!doctype html><html><body style="margin:0;background:#f5f5f5">
<p>Bench chrome that must stay out of the image</p>
<img alt="" src="https://provider.invalid/pixel.png">
<section data-bench-card style="width:720px"><iframe title="Cadence day" sandbox="allow-scripts" srcdoc="${attr(VIEW)}" style="display:block;width:100%;height:300px;border:0"></iframe></section>
</body></html>`;
const chatPage = () => `<!doctype html><html><body style="margin:0;display:flex">
<nav style="width:300px">Private chat title</nav>
<main><p id="prompt">The prompt the person typed</p>
<iframe id="view" title="Cadence day" sandbox="allow-scripts" srcdoc="${attr(VIEW)}" style="display:block;width:600px;height:240px;border:0"></iframe></main>
</body></html>`;

let browser;
let server;
let base;
let root;
const requests = [];
const NOW = () => new Date('2026-11-26T12:00:00.000Z');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(`${url.pathname}${url.search}`);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(url.pathname === '/design-system' ? benchPage() : chatPage());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launchChrome({ headless: true });
  root = mkdtempSync(join(tmpdir(), 'listing-380-'));
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

const mode = (file) => statSync(file).mode & 0o777;

describe('the listing set', () => {
  it('has 3 to 5 shots with distinct IDs and prompts, as the Claude directory asks', () => {
    expect(LISTING_SHOTS.length).toBeGreaterThanOrEqual(3);
    expect(LISTING_SHOTS.length).toBeLessThanOrEqual(5);
    expect(new Set(LISTING_SHOTS.map((s) => s.id)).size).toBe(LISTING_SHOTS.length);
    expect(new Set(LISTING_SHOTS.map((s) => s.prompt)).size).toBe(LISTING_SHOTS.length);
    for (const s of LISTING_SHOTS) {
      expect(s.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(s.prompt).toMatch(/Cadence/);
      expect(s.prompt).not.toMatch(/\[Cadence QA\]|[\r\n]/);
      expect(shotById(s.id)).toBe(s);
    }
    expect(shotById('nope')).toBeNull();
  });

  it('matches the prompts in the unpublished submission draft, word for word', () => {
    const packet = readFileSync(new URL('../../docs/qa/mcp-directory-submission.md', import.meta.url), 'utf8');
    for (const s of LISTING_SHOTS) expect(packet, s.id).toContain(`| \`${s.id}\` | ${s.prompt} |`);
  });
});

describe('checks', () => {
  it('reads a PNG size and refuses anything that is not a PNG', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(1440, 16);
    png.writeUInt32BE(900, 20);
    expect(pngSize(png)).toEqual({ width: 1440, height: 900 });
    for (const bad of [Buffer.from('GIF89a'), Buffer.alloc(24), null]) expect(() => pngSize(bad)).toThrow('not-png');
  });

  it('accepts only a loopback bench URL and builds the bench query', () => {
    expect(benchUrl('http://127.0.0.1:3000', { state: 'parent', theme: 'dark' }))
      .toBe('http://127.0.0.1:3000/design-system?preview=mcp-day-view&state=parent&theme=dark&host=claude&layout=desktop');
    expect(benchUrl('http://localhost:3000/', { state: 'normal', theme: 'light' })).toContain('http://localhost:3000/design-system?');
    for (const bad of ['https://app.cadence-me.com', 'https://claude.ai', 'file:///tmp/x', 'not a url']) {
      expect(() => benchUrl(bad, { state: 'normal', theme: 'light' })).toThrow('bench-url-not-local');
    }
  });

  it('refuses an output directory inside the repository that git does not ignore', () => {
    expect(() => assertOutDir(join(REPO_ROOT, 'docs', 'qa'))).toThrow('out-dir-not-ignored');
    expect(() => assertOutDir(join(REPO_ROOT, 'x'), { isIgnored: () => false })).toThrow('out-dir-not-ignored');
    expect(() => assertOutDir('')).toThrow('out-dir-invalid');
    // The default really is ignored by the repository's own .gitignore.
    expect(gitIgnores(join(DEFAULT_OUT_DIR, 'bench'))).toBe(true);
    expect(assertOutDir(join(DEFAULT_OUT_DIR, 'bench'))).toBe(join(DEFAULT_OUT_DIR, 'bench'));
    // Outside the repository nothing can be committed, so no ignore rule is needed.
    expect(assertOutDir(root, { isIgnored: () => false })).toBe(root);
  });

  it('parses the three commands and refuses anything else', () => {
    expect(parseCli(['list'])).toEqual({ command: 'list' });
    const bench = parseCli(['bench']);
    expect(bench).toMatchObject({ command: 'bench', baseUrl: 'http://127.0.0.1:3000', outDir: join(DEFAULT_OUT_DIR, 'bench'), scale: 2 });
    expect(bench.shots.map((s) => s.id)).toEqual(LISTING_SHOTS.map((s) => s.id));
    expect(parseCli(['bench', '--shot', 'note', '--scale', '3']).shots.map((s) => s.id)).toEqual(['note']);
    expect(parseCli(['host', '--client', 'claude-web', '--shot', 'today', '--selector', 'iframe']))
      .toMatchObject({ command: 'host', client: 'claude-web', selector: 'iframe', scale: null, outDir: join(DEFAULT_OUT_DIR, 'host', 'claude-web') });
    const reason = (argv) => { try { parseCli(argv); return null; } catch (error) { return error instanceof CaptureStop ? error.reason : String(error); } };
    expect(reason([])).toBe('command-invalid');
    expect(reason(['submit'])).toBe('command-invalid');
    expect(reason(['bench', '--base-url', 'https://app.cadence-me.com'])).toBe('bench-url-not-local');
    expect(reason(['bench', '--shot', 'nope'])).toBe('shot-unknown');
    expect(reason(['bench', '--scale', '9'])).toBe('scale-invalid');
    expect(reason(['host', '--client', 'gemini', '--shot', 'today', '--selector', 'iframe'])).toBe('client-invalid');
    expect(reason(['host', '--client', 'chatgpt', '--selector', 'iframe'])).toBe('shot-required');
    expect(reason(['host', '--client', 'chatgpt', '--shot', 'today'])).toBe('selector-required');
  });

  it('prints the prompts with `list` and exits 2 on a bad command', async () => {
    const lines = [];
    expect(await main(['list'], (line) => lines.push(JSON.parse(line)))).toBe(0);
    expect(lines.map((l) => [l.id, l.prompt])).toEqual(LISTING_SHOTS.map((s) => [s.id, s.prompt]));
    const usage = [];
    expect(await main(['publish'], (line) => usage.push(JSON.parse(line)))).toBe(2);
    expect(usage).toEqual([{ step: 'usage', ok: false, reason: 'command-invalid' }]);
  });
});

describe('bench captures', () => {
  it('writes one labelled PNG of the view frame, 1000 px or wider, and its prompt sidecar for every shot', async () => {
    const out = join(root, 'bench');
    requests.length = 0;
    const result = await captureBench({ browser, baseUrl: base, outDir: out, now: NOW });
    expect(result.captures.map((c) => c.id)).toEqual(LISTING_SHOTS.map((s) => s.id));
    expect(readdirSync(out).sort()).toEqual(LISTING_SHOTS.flatMap((s) => [`bench-${s.id}.json`, `bench-${s.id}.png`]).sort());
    for (const s of LISTING_SHOTS) {
      const size = pngSize(readFileSync(join(out, `bench-${s.id}.png`)));
      // The 720px frame at twice the pixel density: the frame alone, not the 1280px page.
      expect(size.width).toBe(1440);
      expect(size.width).toBeGreaterThanOrEqual(MIN_WIDTH_PX);
      expect(JSON.parse(readFileSync(join(out, `bench-${s.id}.json`), 'utf8'))).toEqual({
        id: s.id, file: `bench-${s.id}.png`, prompt: s.prompt, source: 'bench', listing_candidate: false, label: BENCH_LABEL, host: null,
        bench: { state: s.bench.state, theme: s.bench.theme, host: 'claude', layout: 'desktop' },
        format: 'png', width: size.width, height: size.height, captured_at: '2026-11-26T12:00:00.000Z',
      });
      for (const ext of ['png', 'json']) expect(mode(join(out, `bench-${s.id}.${ext}`))).toBe(0o600);
    }
    expect(BENCH_LABEL).toMatch(/Not a listing screenshot/);
    // Each shot asked the bench for its own fixture state and theme.
    expect(requests.filter((r) => r.startsWith('/design-system'))).toEqual(LISTING_SHOTS.map((s) => `/design-system?preview=mcp-day-view&state=${s.bench.state}&theme=${s.bench.theme}&host=claude&layout=desktop`));
    // The stub page asks for an image on another host; the capture context refuses it.
    expect(result.blockedRequests).toBe(LISTING_SHOTS.length);
  }, 120_000);

  it('runs the steps inside the view before the capture', async () => {
    const out = join(root, 'steps');
    const plain = await captureBench({ browser, baseUrl: base, outDir: out, shots: [shotById('today')], now: NOW });
    const noted = await captureBench({ browser, baseUrl: base, outDir: out, shots: [shotById('note')], now: NOW });
    // The clicked view differs from the untouched one: the note editor is on screen.
    expect(readFileSync(join(out, 'bench-note.png')).equals(readFileSync(join(out, 'bench-today.png')))).toBe(false);
    expect([plain.captures.length, noted.captures.length]).toEqual([1, 1]);
  }, 120_000);

  it('writes nothing when the image would be narrower than 1000 px', async () => {
    const out = join(root, 'narrow');
    await expect(captureBench({ browser, baseUrl: base, outDir: out, shots: [shotById('today')], scale: 1 })).rejects.toMatchObject({ reason: 'too-narrow' });
    expect(() => readdirSync(out)).toThrow();
  }, 60_000);

  it('stops with a named reason when the view never appears, and before any page when the directory is unsafe', async () => {
    const missing = { ...shotById('today'), id: 'missing', steps: [{ click: '[data-action="absent"]' }] };
    await expect(captureBench({ browser, baseUrl: base, outDir: join(root, 'missing'), shots: [missing], timeoutMs: 1_500 })).rejects.toMatchObject({ reason: 'view-not-ready' });
    requests.length = 0;
    await expect(captureBench({ browser, baseUrl: base, outDir: join(REPO_ROOT, 'docs'), shots: [shotById('today')] })).rejects.toMatchObject({ reason: 'out-dir-not-ignored' });
    await expect(captureBench({ browser, baseUrl: 'https://claude.ai', outDir: root, shots: [shotById('today')] })).rejects.toMatchObject({ reason: 'bench-url-not-local' });
    expect(requests).toEqual([]);
  }, 60_000);
});

describe('host captures (the hook for Ticket 378 runs)', () => {
  it('captures only the view frame of an open page, and can raise the pixel density to reach 1000 px', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.goto(`${base}/chat`);
      const url = page.url();
      const out = join(root, 'host');
      // 600 CSS px at the page's own density is too narrow for a listing.
      await expect(captureHostView({ page, shot: shotById('today'), selector: '#view', outDir: out, host: 'claude-web' })).rejects.toMatchObject({ reason: 'too-narrow' });
      const record = await captureHostView({ page, shot: shotById('today'), selector: '#view', outDir: out, host: 'claude-web', scale: 2, now: NOW });
      expect(record).toEqual({
        id: 'today', file: 'host-today.png', prompt: 'Show my Cadence day.', source: 'host', listing_candidate: true, label: HOST_LABEL, host: 'claude-web', bench: null,
        format: 'png', width: 1200, height: 480, captured_at: '2026-11-26T12:00:00.000Z',
      });
      expect(pngSize(readFileSync(join(out, 'host-today.png')))).toEqual({ width: 1200, height: 480 });
      expect(readdirSync(out).sort()).toEqual(['host-today.json', 'host-today.png']);
      // The page was not navigated, and the density override is gone afterwards.
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
      // The conversation, the sidebar and anything that is not a frame are refused.
      for (const selector of ['main', 'nav', '#prompt']) {
        await expect(captureHostView({ page, shot: shotById('today'), selector, outDir: out, host: 'claude-web', scale: 2 })).rejects.toMatchObject({ reason: 'view-not-a-frame' });
      }
      await expect(captureHostView({ page, shot: shotById('today'), selector: '#absent', outDir: out, host: 'claude-web' })).rejects.toMatchObject({ reason: 'view-not-found' });
      await expect(captureHostView({ page, shot: shotById('today'), selector: '#view', outDir: out, host: 'Claude Web!' })).rejects.toMatchObject({ reason: 'host-invalid' });
      expect(readdirSync(out).sort()).toEqual(['host-today.json', 'host-today.png']);
    } finally { await context.close(); }
  }, 60_000);
});
