// Astro in server mode: pages and API routes render on request. On Netlify the adapter turns the routes into Netlify Functions;
// locally `pnpm dev` runs them in Node (where the local git store works).
import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";

export default defineConfig({
  output: "server",
  adapter: netlify(),
  server: { port: 4321, host: "127.0.0.1" },
});
