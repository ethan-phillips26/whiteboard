import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import JSZip from "jszip";

const EXTENSION = fileURLToPath(new URL("../../../extension", import.meta.url));

// The install screen links to this: the extension as one zip, built from the same
// commit as the page so the two can't drift apart. Files sit at the zip's root,
// which is what lets Firefox load the zip as it is.
function extensionZip() {
  return {
    name: "extension-zip",
    async generateBundle() {
      const zip = new JSZip();
      const add = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) add(full, `${prefix}${entry.name}/`);
          else zip.file(`${prefix}${entry.name}`, fs.readFileSync(full));
        }
      };
      add(EXTENSION, "");
      this.emitFile({
        type: "asset",
        fileName: "whiteboard-connector.zip",
        source: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
      });
    },
  };
}

// Two builds of one app. The default talks to FastAPI. `--mode browser` is the
// static build for GitHub Pages: the one module that talks to a server is
// swapped for one that does the server's work in the page, through the
// Whiteboard Connector extension. Every screen imports "api.js" and gets
// whichever this build is.
export default defineConfig(({ mode }) => {
  const browser = mode === "browser";
  return {
    plugins: browser ? [react(), extensionZip()] : [react()],
    resolve: browser
      ? {
          alias: [{
            find: /^\.{1,2}\/api\.js$/,
            replacement: fileURLToPath(new URL("./src/browser/api.js", import.meta.url)),
          }],
        }
      : {},
    // Relative, so the same files work under a Pages project path or anywhere.
    base: browser ? "./" : "/",
    // `npm run dev` serves the UI while FastAPI keeps serving the data.
    server: browser ? {} : { proxy: { "/api": "http://127.0.0.1:8765" } },
    build: { outDir: browser ? "dist-browser" : "dist", emptyOutDir: true },
  };
});
