/**
 * Builds the standalone globe dev harness: out/globe/globe-dev.html
 *
 *   npx tsx tools/globe-dev.ts
 *   node tools/shot.mjs out/globe/globe-dev.html out/globe/shot.png 1280 800 --waitfor="window.__globe?.ready" --wait=1500
 *
 * Page URL params: ?seed=…&cells=40000&w=4096&real=1&layer=terrain|political&mode=flat&lat=&lon=&zoom=&rotate=1
 * (the screenshot tool accepts file paths with a query string).
 */
import * as esbuild from "esbuild";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const geoEntry = join(root, "src/geo/index.ts");

const geoPlugin: esbuild.Plugin = {
  name: "virtual-geo",
  setup(build) {
    build.onResolve({ filter: /^virtual:geo$/ }, () =>
      existsSync(geoEntry) ? { path: geoEntry } : { path: "virtual:geo", namespace: "virtual" },
    );
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export const generatePhysical = undefined;", loader: "js" }));
  },
};

const common: esbuild.BuildOptions = {
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: false,
  write: false,
  logLevel: "warning",
  plugins: [geoPlugin],
};

const t0 = Date.now();
const worker = await esbuild.build({ ...common, entryPoints: [join(root, "tools/globe-dev-worker.ts")] });
const page = await esbuild.build({
  ...common,
  entryPoints: [join(root, "tools/globe-dev-page.ts")],
  define: { __GLOBE_WORKER__: JSON.stringify(worker.outputFiles![0].text) },
});
const js = page.outputFiles![0].text.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Palimpsest — globe dev</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; background: #03050a; color: #e8dfcc; font-family: "EB Garamond", Georgia, serif; overflow: hidden; }
  #wrap { position: fixed; inset: 0; }
  #globe { width: 100%; height: 100%; display: block; cursor: grab; }
  #globe:active { cursor: grabbing; }
  #ui { position: fixed; left: 16px; top: 14px; display: flex; gap: 6px; flex-wrap: wrap; z-index: 2; }
  #ui button { font: inherit; font-size: 14px; letter-spacing: 0.08em; color: #e8dfcc; background: rgba(20,18,16,0.55);
    border: 1px solid rgba(232,223,204,0.25); border-radius: 3px; padding: 4px 10px; cursor: pointer; backdrop-filter: blur(4px); }
  #ui button.on { background: rgba(232,223,204,0.18); border-color: rgba(232,223,204,0.6); }
  #status { position: fixed; left: 16px; bottom: 12px; font-size: 13px; opacity: 0.7; z-index: 2; letter-spacing: 0.04em; }
  #info { position: fixed; right: 16px; bottom: 12px; font-size: 13px; opacity: 0.8; z-index: 2; }
</style>
</head>
<body>
<div id="wrap"><canvas id="globe"></canvas></div>
<div id="ui">
  <button data-layer="terrain">Terrain</button><button data-layer="political">Political</button>
  <span style="width:10px"></span>
  <button data-mode="globe">Globe</button><button data-mode="flat">Map</button>
  <span style="width:10px"></span>
  <button id="spin">Rotate</button>
</div>
<div id="status"></div>
<div id="info"></div>
<script>${js}</script>
</body>
</html>
`;
const out = join(root, "out/globe/globe-dev.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} kB, geo: ${existsSync(geoEntry) ? "available" : "stub"}) in ${Date.now() - t0} ms`);
