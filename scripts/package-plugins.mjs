import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { checkPlugins, packageFiles, pluginNames, repositoryRoot } from "./check-plugins.mjs";

export function pluginArchive(plugin, root = repositoryRoot) {
  checkPlugins(root);
  const files = Object.fromEntries(packageFiles(plugin).map((file) => [
    file, fs.readFileSync(path.join(root, "integrations", plugin, file)),
  ]));
  // ZIP stores local wall time; a fixed local date produces identical bytes in every timezone.
  return zipSync(files, { level: 9, mtime: new Date(2000, 0, 1), os: 3, attrs: 0o100644 << 16 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = checkPlugins();
  const output = path.join(repositoryRoot, "integrations/.artifacts");
  fs.mkdirSync(output, { recursive: true });
  for (const plugin of pluginNames) {
    const bytes = pluginArchive(plugin);
    const file = path.join(output, `cadence-${plugin}-${version}.zip`);
    fs.writeFileSync(file, bytes);
    console.log(`${path.relative(repositoryRoot, file)} sha256=${createHash("sha256").update(bytes).digest("hex")}`);
  }
}
