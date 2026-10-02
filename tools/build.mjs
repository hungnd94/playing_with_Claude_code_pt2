// Bundles the app into a single self-contained HTML file.
//
//   node tools/build.mjs            → dist/index.html (full document) + dist/artifact.html (body-only, for claude.ai)
//   node tools/build.mjs --serve    → dev server on :8000 with rebuild on change
//
// The generation worker is bundled separately and inlined into the main bundle
// as a string (`__WORKER_SOURCE__`), then started from a Blob URL, so the whole
// app ships as one file with no external requests besides Google Fonts.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serve = process.argv.includes("--serve");
const dev = serve || process.argv.includes("--dev");

const common = {
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: !dev,
  sourcemap: false,
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  logLevel: "warning",
};

async function buildOnce() {
  const t0 = Date.now();
  const workerEntry = join(root, "src/app/worker.ts");
  let workerCode = "";
  if (existsSync(workerEntry)) {
    const w = await esbuild.build({ ...common, entryPoints: [workerEntry], write: false });
    workerCode = w.outputFiles[0].text;
  }
  const main = await esbuild.build({
    ...common,
    entryPoints: [join(root, "src/app/main.tsx")],
    write: false,
    outdir: join(root, "dist"),
    define: { __WORKER_SOURCE__: JSON.stringify(workerCode), __DEV__: String(dev) },
    loader: { ".css": "css", ".woff2": "dataurl", ".png": "dataurl", ".svg": "text" },
  });
  let js = "";
  let css = "";
  for (const f of main.outputFiles) {
    if (f.path.endsWith(".js")) js = f.text;
    else if (f.path.endsWith(".css")) css = f.text;
  }
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  const template = readFileSync(join(root, "src/app/index.html"), "utf8");
  const body = template
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => safeJs);
  mkdirSync(join(root, "dist"), { recursive: true });
  // artifact.html: content only (claude.ai wraps it in its own document skeleton).
  writeFileSync(join(root, "dist/artifact.html"), body);
  // index.html: a complete standalone document.
  const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  writeFileSync(join(root, "dist/index.html"), full);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0);
  console.log(`built in ${Date.now() - t0}ms — main ${kb(js)}kB, worker ${kb(workerCode)}kB, css ${kb(css)}kB, html ${kb(full)}kB`);
}

await buildOnce();

if (serve) {
  const { watch } = await import("node:fs");
  let pending = null;
  watch(join(root, "src"), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 120);
  });
  const port = Number(process.env.PORT || 8000);
  createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const file = url === "/" ? "dist/index.html" : url.slice(1);
    const p = join(root, file);
    if (!p.startsWith(root) || !existsSync(p)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const type = p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "text/javascript" : p.endsWith(".png") ? "image/png" : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(readFileSync(p));
  }).listen(port, () => console.log(`serving http://localhost:${port}`));
}
