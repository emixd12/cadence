// Makes the advisor avatar's shipped files from the vector master (Ticket 343).
// Run: npm run avatar:build. The outputs are committed; `--check` fails when they are stale.
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

/** The master has three tone layers; each rendition sets how strong each one is (its line weight). */
function withTones(svg, tones) {
  return tones.reduce((text, opacity, index) => {
    const pattern = new RegExp(`(<g id="tone-${index + 1}"[^>]*fill-opacity=")[0-9.]+(")`);
    if (!pattern.test(text)) throw new Error(`master.svg has no tone-${index + 1} layer`);
    return text.replace(pattern, `$1${opacity}$2`);
  }, svg);
}

const stale = [];
for (const rendition of art.renditions) {
  const svg = withTones(master, rendition.tones).replace(/width="\d+" height="\d+"/, `width="${rendition.pixels}" height="${rendition.pixels}"`);
  const output = await sharp(Buffer.from(svg), { unlimited: true })
    .resize(rendition.pixels, rendition.pixels)
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toBuffer();
  const path = join(root, rendition.file);
  const same = existsSync(path) && createHash("sha256").update(readFileSync(path)).digest("hex") === createHash("sha256").update(output).digest("hex");
  if (check) {
    if (!same) stale.push(rendition.file);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
  console.log(`${rendition.file}  ${rendition.pixels}px  ${output.length} bytes`);
}
if (stale.length) {
  console.error(`avatar:build is stale for: ${stale.join(", ")}. Run npm run avatar:build.`);
  process.exit(1);
}
