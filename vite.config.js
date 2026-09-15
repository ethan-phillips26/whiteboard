import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import JSZip from "jszip";

const EXTENSION = fileURLToPath(new URL("./extension", import.meta.url));

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

export default defineConfig({
  plugins: [react(), extensionZip()],
  // Relative, so the same files work at /whiteboard/ on Pages or anywhere else.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
