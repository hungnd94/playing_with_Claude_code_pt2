// Screenshot a local HTML file or URL with headless Chromium (WebGL via SwiftShader).
//
//   node tools/shot.mjs <file.html|http://...> <out.png> [width=1280] [height=800] [--wait=ms] [--eval="js"]
//
// Prints console messages and page errors so rendering bugs are visible.
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.join("=") || "1"];
  }),
);
const [target, out = "out/shot.png", w = "1280", h = "800"] = args;
if (!target) {
  console.error("usage: node tools/shot.mjs <file|url> <out.png> [w] [h] [--wait=ms] [--eval=js] [--selector=css]");
  process.exit(1);
}
const url = /^https?:/.test(target) ? target : "file://" + resolve(target);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(flags.dpr || 1) });
page.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "load" });
if (flags.waitfor) {
  await page.waitForFunction(flags.waitfor, null, { timeout: +(flags.timeout || 120000), polling: 250 });
}
await page.waitForTimeout(+(flags.wait || 500));
if (flags.eval) {
  const r = await page.evaluate(flags.eval);
  if (r !== undefined) console.log("[eval]", typeof r === "string" ? r : JSON.stringify(r));
  await page.waitForTimeout(+(flags.after || 300));
}
mkdirSync(dirname(resolve(out)), { recursive: true });
if (flags.selector) await page.locator(flags.selector).screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: !!flags.full });
await browser.close();
console.log("wrote", out);
