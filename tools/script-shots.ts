// Screenshot several sections of a script page in ONE headless Chromium session
// (resource hygiene: one browser, always closed).
//   npx tsx tools/script-shots.ts out/script/demo.html out/script/shot "#S1,#S2,#tree" [width=1400] [--dpr=1]
// writes out/script/shot-S1.png, out/script/shot-S2.png, … (selectors: "#id" or any CSS; name from the id).
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=") || "1"];
    }),
);
const [target, prefix = "out/script/shot", sels = "body", w = "1400"] = args;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
try {
  const page = await browser.newPage({ viewport: { width: +w, height: 1000 }, deviceScaleFactor: +(flags.dpr || 1) });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("file://" + resolve(target), { waitUntil: "load" });
  await page.waitForTimeout(+(flags.wait || 400));
  for (const sel of sels.split(",")) {
    const name = sel.replace(/^[#.]/, "").replace(/[^\w-]+/g, "_");
    const out = `${prefix}-${name}.png`;
    const loc = page.locator(sel).first();
    if (!(await loc.count())) {
      console.log("missing", sel);
      continue;
    }
    await loc.screenshot({ path: out });
    console.log("wrote", out);
  }
} finally {
  await browser.close();
}
