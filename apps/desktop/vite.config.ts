import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import { defineConfig, type Plugin } from "vite";

// Keep private desktop builds offline without duplicating tracked binaries.
// Redistribution rights remain a public-release gate in docs/DESKTOP_BUILD.md.
const productAssets = [
  "brand/cadence-logo.png",
  "brand/google-calendar.svg",
  // Ticket 302: the Settings source rows show each provider's own mark (public/brand/connector-icons-source.md).
  "brand/outlook-calendar.svg",
  "brand/icloud-calendar.png",
  "brand/hevy.png",
  "brand/cadence-page-banner-lines-dots.png",
  "brand/cadence-timeline-horse-lines-dots-clear-background.png",
  "brand/cadence-timeline-horse-lines-dots-mobile-right-18.png",
  "sounds/completion-chime.mp3",
];
const publicRoot = new URL("../../public/", import.meta.url);

function localProductAssets(): Plugin {
  return {
    name: "cadence-local-product-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split("?")[0]?.slice(1);
        if (!path || !productAssets.includes(path)) return next();
        try {
          const bytes = await readFile(new URL(path, publicRoot));
          response.setHeader(
            "Content-Type",
            path.endsWith(".mp3") ? "audio/mpeg" : path.endsWith(".svg") ? "image/svg+xml" : "image/png",
          );
          response.end(bytes);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const fileName of productAssets) {
        this.emitFile({
          type: "asset",
          fileName,
          source: await readFile(new URL(fileName, publicRoot)),
        });
      }
      this.emitFile({
        type: "asset",
        fileName: "licenses/IBM-Plex-Sans-OFL.txt",
        source: await readFile(
          new URL("../../packages/ui/LICENSE.fonts.txt", import.meta.url),
        ),
      });
      this.emitFile({
        type: "asset",
        fileName: "licenses/lucide.txt",
        source: await readFile(
          new URL("../../node_modules/lucide-react/LICENSE", import.meta.url),
        ),
      });
    },
  };
}

export default defineConfig({
  plugins: [localProductAssets()],
  resolve: { alias: { "@": fileURLToPath(new URL("../..", import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
});
