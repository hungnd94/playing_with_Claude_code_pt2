/**
 * Take several screenshots of the globe dev harness in one browser session.
 *
 *   npx tsx tools/globe-dev.ts
 *   npx tsx tools/globe-shots.ts [--q="real=1&seed=palimpsest&w=2048"] [--only=name,name] [--size=1280x800] [--prefix=v]
 *
 * Views are defined below (name → setup script evaluated in the page). Writes
 * out/globe/<prefix>-<name>.png and prints page timings / errors.
 */
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.join("=") || "1"];
  }),
);
const q = flags.q ?? "real=1&seed=palimpsest&w=2048";
const [vw, vh] = (flags.size ?? "1280x800").split("x").map(Number);
const prefix = flags.prefix ?? "v";
const only = flags.only ? new Set(flags.only.split(",")) : null;

/** Each view: JS run in the page (has `g` = window.__globe, `v` = g.view). Return a promise to wait for. */
const VIEWS: Record<string, string> = {
  globe: `g.setLayer("terrain"); v.setMode("globe"); v.setView({lat: 22, lon: 10, zoom: 1});`,
  political: `g.setLayer("political"); v.setMode("globe"); v.setView({lat: 22, lon: 10, zoom: 1});`,
  night: `g.setLayer("terrain"); v.setMode("globe"); v.setView({lat: 10, lon: 150, zoom: 1});`,
  pole: `g.setLayer("terrain"); v.setMode("globe"); v.setView({lat: 70, lon: -60, zoom: 1.2});`,
  coast: `g.setLayer("terrain"); v.setMode("globe"); const c = g.spot("coast"); v.setView({lat: c[0], lon: c[1], zoom: 5});`,
  close: `g.setLayer("terrain"); v.setMode("globe"); const c = g.spot("river"); v.setView({lat: c[0], lon: c[1], zoom: 12});`,
  mountains: `g.setLayer("terrain"); v.setMode("globe"); const c = g.spot("mountain"); v.setView({lat: c[0], lon: c[1], zoom: 6});`,
  polclose: `g.setLayer("political"); v.setMode("globe"); const c = g.spot("border"); v.setView({lat: c[0], lon: c[1], zoom: 4});`,
  highlight: `g.setLayer("political"); v.setMode("globe"); const c = g.spot("border"); v.setView({lat: c[0], lon: c[1], zoom: 2.2}); g.highlightAt(c);`,
  lines: `g.setLayer("political"); g.showLines(true); v.setMode("globe"); const c = g.spot("border"); v.setView({lat: c[0], lon: c[1], zoom: 2});`,
  flat: `g.setLayer("political"); v.setMode("flat"); v.setView({lat: 0, lon: 0, zoom: 1});`,
  flatterrain: `g.setLayer("terrain"); v.setMode("flat"); v.setView({lat: 0, lon: 0, zoom: 1});`,
};

const url = "file://" + resolve("out/globe/globe-dev.html") + "?" + q;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: +(flags.dpr || 1) });
page.on("console", (m) => { if (m.type() !== "log" || /timings|error|warn/i.test(m.text())) console.log(`[console.${m.type()}]`, m.text().slice(0, 400)); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction("window.__globe?.ready", null, { timeout: 180000, polling: 250 });
console.log(`ready in ${Date.now() - t0} ms`);
for (const [name, js] of Object.entries(VIEWS)) {
  if (only && !only.has(name)) continue;
  const t = Date.now();
  await page.evaluate(`(async () => { const g = window.__globe, v = g.view; g.reset?.(); ${js}; v.render(); })()`);
  await page.waitForTimeout(+(flags.wait || 400));
  const out = `out/globe/${prefix}-${name}.png`;
  await page.screenshot({ path: out });
  console.log(`wrote ${out} (${Date.now() - t} ms)`);
}
if (flags.eval) console.log("[eval]", await page.evaluate(flags.eval));
await browser.close();
