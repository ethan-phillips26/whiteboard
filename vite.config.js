import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import JSZip from "jszip";

const EXTENSION = fileURLToPath(new URL("./extension", import.meta.url));
const CLAUDE_HOST = fileURLToPath(new URL("./claude-bridge", import.meta.url));

// One folder as one zip, files at its root. The install screen links to these,
// built from the same commit as the page so they can't drift apart.
//
// The extension's sit at the zip's root, which is what lets Firefox load it as is.
// The Claude host speaks the page's protocol, so it ships from the same build.
function folderZip(name, dir, fileName) {
  const build = async () => {
    const zip = new JSZip();
    const add = (from, prefix) => {
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const full = path.join(from, entry.name);
        if (entry.isDirectory()) add(full, `${prefix}${entry.name}/`);
        // Executable bits survive a zip only when set, and install.mjs is run.
        else zip.file(`${prefix}${entry.name}`, fs.readFileSync(full), { unixPermissions: /\.mjs$/.test(entry.name) ? 0o755 : 0o644 });
      }
    };
    add(dir, "");
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "UNIX" });
  };
  return {
    name,
    // The dev server answers an unknown path with the app's own index.html, which
    // a browser saves as a "zip" nobody can open. Serve the real one.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== `/${fileName}`) return next();
        res.setHeader("content-type", "application/zip");
        res.end(Buffer.from(await build()));
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName, source: await build() });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    folderZip("extension-zip", EXTENSION, "whiteboard-connector.zip"),
    folderZip("claude-host-zip", CLAUDE_HOST, "whiteboard-claude-host.zip"),
  ],
  // Relative, so the same files work at /whiteboard/ on Pages or anywhere else.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
