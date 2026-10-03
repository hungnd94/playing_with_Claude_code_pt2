/**
 * Screenshots every plate of the atlas dev harness in one browser session.
 *
 *   npx tsx tools/atlas-shots.ts [query] [--dpr=1] [--crop=n:x,y,w,h]...
 *     e.g. npx tsx tools/atlas-shots.ts "seed=velmarra&plates=0,1"
 *
 * Writes out/atlas/plate-<n>.png (and out/atlas/crop-<n>-<k>.png for crops),
 * and prints the timings reported by the page.
 */
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--")) ?? "";
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.slice(2).split("=");
  return [k, v.join("=") || "1"];
}));
const crops = args.filter((a) => a.startsWith("--crop=")).map((a) => a.slice(7));
const dpr = +(flags.dpr || 1);
const W = +(new URLSearchParams(query).get("w") ?? 1600);
const H = +(new URLSearchParams(query).get("h") ?? 1100);

const url = "file://" + resolve("out/atlas/atlas-dev.html") + (query ? "?" + query : "");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: W + 40, height: H + 80 }, deviceScaleFactor: dpr });
page.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction("window.__atlas && window.__atlas.done", null, { timeout: 240000, polling: 250 });
const n = await page.evaluate("window.__atlas.specs.length") as number;
for (let i = 0; i < n; i++) {
  const el = page.locator(`#plate${i}`);
  await el.screenshot({ path: `out/atlas/plate-${i}.png` });
  console.log("wrote", `out/atlas/plate-${i}.png`);
}
for (const c of crops) {
  const [idx, rect] = c.split(":");
  const [x, y, w, h] = rect.split(",").map(Number);
  // Page coordinates of the canvas (independent of scrolling).
  const box = (await page.evaluate(`(() => { const r = document.getElementById("plate${idx}")?.getBoundingClientRect(); return r ? { x: r.x + scrollX, y: r.y + scrollY } : null; })()`)) as { x: number; y: number } | null;
  if (!box) continue;
  const path = `out/atlas/crop-${idx}-${x}-${y}.png`;
  await page.screenshot({ path, fullPage: true, clip: { x: box.x + x, y: box.y + y, width: w, height: h } });
  console.log("wrote", path);
}
await browser.close();
