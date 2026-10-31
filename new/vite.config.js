import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const page = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// Every page is its own HTML file (main.js swaps sheets between them in
// place). Add new notes here so the build emits them, and chain them with
// <link rel="prev"/"next"> so the sheets can be turned between.
export default defineConfig({
  // Unknown paths get 404.html in dev too, as the Worker does in production,
  // rather than Vite's default of falling back to the home page.
  appType: "mpa",
  plugins: [{
    name: "not-found-page",
    configureServer(server) {
      // Runs ahead of Vite's own HTML handling, so it steps aside for any
      // path that is a real page or file.
      return () => server.middlewares.use(async (req, res, next) => {
        const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (existsSync(page(`.${path}`)) && !path.endsWith("/") || existsSync(page(`.${path}index.html`))) return next();
        const html = await readFile(page("404.html"), "utf8");
        res.statusCode = 404;
        res.setHeader("content-type", "text/html");
        res.end(await server.transformIndexHtml(req.url, html));
      });
    },
  }],
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
        "404": page("404.html"),
      },
    },
  },
});
