// Screenshot several elements of one HTML page with a single headless Chromium (resource-friendly).
//
//   npx tsx tools/heraldry-shots.ts <page.html> <outDir> <selector>[=name] ... [--width=1400] [--dpr=1]
//
// e.g. npx tsx tools/heraldry-shots.ts out/heraldry/demo.html out/heraldry/shots "#roll-anglo" "#charges=charges"
// Each selector is written to <outDir>/<name>.png (name defaults to the selector's letters).
// Elements taller than --maxh (default 1200 css px) are clipped to their top part.
import { chromium } from "playwright-core";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=") || "1"]; }));
const [page0, outDir, ...sels] = argv.filter((a) => !a.startsWith("--"));
if (!page0 || !outDir || !sels.length) {
  console.error("usage: npx tsx tools/heraldry-shots.ts <page.html> <outDir> <selector>[=name] ... [--width=1400] [--dpr=1] [--maxh=1200]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const width = +(flags.width ?? 1400), dpr = +(flags.dpr ?? 1), maxh = +(flags.maxh ?? 1200);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
try {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("file://" + resolve(page0), { waitUntil: "load" });
  await page.waitForTimeout(300);
  for (const spec of sels) {
    const eq = spec.lastIndexOf("=");
    const sel = eq > 0 && !spec.includes("[") ? spec.slice(0, eq) : spec;
    const name = eq > 0 && !spec.includes("[") ? spec.slice(eq + 1) : sel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const el = page.locator(sel).first();
    if (!(await el.count())) { console.log("missing", sel); continue; }
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) { console.log("invisible", sel); continue; }
    const out = join(outDir, name + ".png");
    if (box.height > maxh) {
      await page.screenshot({ path: out, fullPage: true, clip: { x: box.x, y: box.y + (await page.evaluate(() => window.scrollY)), width: box.width, height: maxh } });
    } else await el.screenshot({ path: out });
    console.log("wrote", out, `${Math.round(box.width)}x${Math.round(Math.min(maxh, box.height))}`);
  }
} finally {
  await browser.close();
}
