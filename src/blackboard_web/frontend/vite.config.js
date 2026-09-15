import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two builds of one app. The default talks to FastAPI. `--mode browser` is the
// static build for GitHub Pages: the one module that talks to a server is
// swapped for one that does the server's work in the page, through the
// Whiteboard Connector extension. Every screen imports "api.js" and gets
// whichever this build is.
export default defineConfig(({ mode }) => {
  const browser = mode === "browser";
  return {
    plugins: [react()],
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
