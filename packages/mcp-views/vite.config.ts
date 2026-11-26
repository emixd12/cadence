import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

// One HTML file with its script and styles inline: an MCP Apps host serves it from a
// `ui://` resource and blocks every network request, so nothing may load separately.
export default defineConfig({
  root,
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    minify: true,
    cssMinify: true,
    sourcemap: false,
    // Vite's module-preload polyfill calls fetch(). The view has nothing to preload.
    modulePreload: false,
    rolldownOptions: { input: `${root}day.html` },
  },
});
