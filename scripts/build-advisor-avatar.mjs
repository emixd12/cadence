// Makes the advisor avatar's shipped files from the vector master (Ticket 343).
// Run: npm run avatar:build. The outputs are committed; `--check` fails when they are stale.
//
// One file per product size and screen density (round 5): each covers its `area` of the
// drawing at exactly its `pixels`, so the browser draws the avatar without scaling it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "packages/core/src/advisor-avatar/catalog.json"), "utf8"));
const art = catalog.art;
const master = readFileSync(join(root, art.master), "utf8");
const check = process.argv.includes("--check");

/** The anchors and each rendition's `area` are in these units; the master's viewBox is larger. */
const ART_UNITS = 1024;
const viewBox = master.match(/viewBox="0 0 (\d+) (\d+)"/);
if (!viewBox || viewBox[1] !== viewBox[2]) throw new Error("master.svg needs a square viewBox that starts at 0 0");
const unit = Number(viewBox[1]) / ART_UNITS;
/** The drawing is rasterised larger than the file and reduced, which keeps thin lines even. */
const OVERSAMPLE_TARGET = 4096;

/** The master has three tone layers; each rendition sets how strong each one is (its line weight). */
function withTones(svg, tones) {
  return tones.reduce((text, opacity, index) => {
    const pattern = new RegExp(`(<g id="tone-${index + 1}"[^>]*fill-opacity=")[0-9.]+(")`);
    if (!pattern.test(text)) throw new Error(`master.svg has no tone-${index + 1} layer`);
    return text.replace(pattern, `$1${opacity}$2`);
  }, svg);
}

/** The master cropped to one area of the drawing, at a whole multiple of the file's pixels. */
function areaSvg(rendition, factor) {
  const { area, pixels } = rendition;
  return withTones(master, rendition.tones)
    .replace(/viewBox="[^"]+"/, `viewBox="${area.x * unit} ${area.y * unit} ${area.width * unit} ${area.height * unit}"`)
    .replace(/width="\d+" height="\d+"/, `width="${pixels.width * factor}" height="${pixels.height * factor}"`);
}

const stale = [];
for (const rendition of art.renditions) {
  const { pixels } = rendition;
  const factor = Math.max(1, Math.min(16, Math.floor(OVERSAMPLE_TARGET / Math.max(pixels.width, pixels.height))));
  const output = await sharp(Buffer.from(areaSvg(rendition, factor)), { unlimited: true })
    .resize(pixels.width, pixels.height, { kernel: "lanczos3", fit: "fill" })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  const path = join(root, rendition.file);
  const same = existsSync(path) && createHash("sha256").update(readFileSync(path)).digest("hex") === createHash("sha256").update(output).digest("hex");
  if (check) {
    if (!same) stale.push(rendition.file);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
  console.log(`${rendition.file}  ${pixels.width}x${pixels.height}  ${output.length} bytes`);
}
if (stale.length) {
  console.error(`avatar:build is stale for: ${stale.join(", ")}. Run npm run avatar:build.`);
  process.exit(1);
}
