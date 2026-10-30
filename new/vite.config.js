import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// Every page is its own HTML file (main.js swaps sheets between them in
// place). Add new notes here so the build emits them, and chain them with
// <link rel="prev"/"next"> so the sheets can be turned between.
export default defineConfig({
  server: {
    proxy: {
      // The drafts API (and its live socket) is the burcs-dev Worker; run
      // `npx wrangler dev` in the repo root alongside this.
      "/api": { target: "http://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        home: page("index.html"),
        projects: page("projects/index.html"),
        wall: page("wall/index.html"),
        "interfaces-are-cattle": page("notes/interfaces-are-cattle/index.html"),
        "how-the-web-works": page("notes/how-the-web-works/index.html"),
      },
    },
  },
});
