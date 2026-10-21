import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// Every page is its own HTML file (main.js swaps sheets between them in
// place). Add new notes here so the build emits them.
export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        home: page("index.html"),
        "interfaces-are-cattle": page("notes/interfaces-are-cattle/index.html"),
      },
    },
  },
});
