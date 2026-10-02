/**
 * Builds the standalone atlas dev harness: out/atlas/atlas-dev.html
 *
 *   npx tsx tools/atlas-dev.ts
 *   npx tsx tools/atlas-shots.ts                       # all plates → out/atlas/plate-*.png
 *   node tools/shot.mjs out/atlas/atlas-dev.html out/atlas/plate.png 1600 1100 --waitfor="window.__atlas?.done" --wait=500
 *
 * Page params (query or hash): seed=…&cells=40000&plates=0,1,2&style=antique|political|relief
 *   &view=lat,lon,radiusKm (adds a custom plate) &year=…&w=1600&h=1100&mock=1 (mock world)
 *
 * Fonts: the page links Google Fonts (IM Fell English / SC). Headless Chromium
 * here cannot verify the proxy's TLS certificate, so the woff2 files are also
 * fetched once with curl into out/atlas/fonts/ and inlined as data URLs.
 */
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out/atlas");
const fontDir = join(outDir, "fonts");
mkdirSync(fontDir, { recursive: true });

const FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=block";

function inlineFonts(): string {
  try {
    const cssPath = join(fontDir, "fonts.css");
    if (!existsSync(cssPath)) {
      const css = execFileSync("curl", ["-sS", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", FONT_CSS_URL], { encoding: "utf8" });
      writeFileSync(cssPath, css);
    }
    let css = readFileSync(cssPath, "utf8");
    const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]);
    for (const u of urls) {
      const file = join(fontDir, u.split("/").pop()!);
      if (!existsSync(file)) execFileSync("curl", ["-sS", "-o", file, u]);
      const b64 = readFileSync(file).toString("base64");
      css = css.replace(u, `data:font/woff2;base64,${b64}`);
    }
    return css;
  } catch (e) {
    console.warn("could not inline fonts:", (e as Error).message);
    return "";
  }
}

const historyEntry = join(root, "src/history/index.ts");
const virtualPlugin: esbuild.Plugin = {
  name: "virtual-history",
  setup(build) {
    build.onResolve({ filter: /^virtual:history$/ }, () =>
      existsSync(historyEntry) ? { path: historyEntry } : { path: "virtual:history", namespace: "virtual" },
    );
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export const simulateHistory = undefined;", loader: "js" }));
  },
};

const t0 = Date.now();
let js: string;
try {
  const page = await esbuild.build({
    entryPoints: [join(root, "tools/atlas-dev-page.ts")],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: false,
    write: false,
    logLevel: "warning",
    plugins: [virtualPlugin],
  });
  js = page.outputFiles![0].text.replace(/<\/script/gi, "<\\/script");
} catch (e) {
  // History module may be mid-edit by another engineer: retry with the stub.
  console.warn("bundle with src/history failed, retrying with a stub:", (e as Error).message.split("\n")[0]);
  const stub: esbuild.Plugin = {
    name: "stub-history",
    setup(build) {
      build.onResolve({ filter: /^virtual:history$/ }, () => ({ path: "virtual:history", namespace: "virtual" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export const simulateHistory = undefined;", loader: "js" }));
    },
  };
  const page = await esbuild.build({
    entryPoints: [join(root, "tools/atlas-dev-page.ts")],
    bundle: true, format: "iife", target: "es2022", minify: false, write: false, logLevel: "warning", plugins: [stub],
  });
  js = page.outputFiles![0].text.replace(/<\/script/gi, "<\\/script");
}

const fontCss = inlineFonts();
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Palimpsest — atlas dev</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS_URL}" rel="stylesheet">
<style>
${fontCss}
html, body { margin: 0; background: #0b0f1a; color: #e8dfcc; font: 14px Georgia, serif; }
#status { padding: 6px 10px; font-size: 12px; color: #c9a45c; }
.plate { display: block; margin: 0 0 24px 0; }
.cap { padding: 2px 10px 8px; font-size: 12px; color: #a99; }
</style>
</head>
<body>
<div id="status">loading…</div>
<div id="plates"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(join(outDir, "atlas-dev.html"), html);
console.log(`wrote out/atlas/atlas-dev.html (${(html.length / 1024).toFixed(0)} kB) in ${Date.now() - t0} ms`);
