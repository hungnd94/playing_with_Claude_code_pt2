/**
 * Scripted screenshots of the built app (dist/index.html) in ONE headless
 * Chromium session: generation runs once, then each view is set up through
 * `window.__app` and captured.
 *
 *   npx tsx tools/app-shots.ts [--seed=velmarra] [--size=1440x900] [--theme=dark|light]
 *       [--only=world,polity,...] [--prefix=d] [--genesis] [--query=history=sim]
 *
 * Output: out/app/<prefix>-<view>.png. Console errors are printed.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const flags = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  }),
);
const seed = flags.seed ?? "velmarra";
const [W, H] = (flags.size ?? "1440x900").split("x").map(Number);
const theme = (flags.theme ?? "dark") as "dark" | "light";
const prefix = flags.prefix ?? `${theme[0]}${W}`;
const only = flags.only ? new Set(flags.only.split(",")) : null;
const query = flags.query ? `?${flags.query}` : "";
mkdirSync("out/app", { recursive: true });

interface View {
  name: string;
  /** JS run in the page (has `A` = window.__app). */
  js: string;
  wait?: number;
  /** Optional element to screenshot instead of the page. */
  selector?: string;
}

const V = (name: string, js: string, wait = 900, selector?: string): View => ({ name, js, wait, selector });

const views: View[] = [
  V("world", `A.skip(); A.navigate({tab:"world"});`, 1500),
  V("realms-early", `A.set({layer:"realms"}); A.setYear(Math.round(A.get().history.endYear*0.3));`, 1200),
  V("peoples", `A.set({layer:"peoples"}); A.setYear(A.get().history.endYear);`, 1200),
  V("tongues", `A.set({layer:"tongues"});`, 1200),
  V("faiths", `A.set({layer:"faiths"});`, 1200),
  V("population", `A.set({layer:"population"});`, 1200),
  V("polity", `A.set({layer:"realms"}); const h=A.get().history; const p=[...h.polities].sort((a,b)=>b.peak.areaKm2-a.peak.areaKm2)[0]; A.setYear(p.peak.year); A.open({kind:"polity",id:p.id});`, 2600),
  V("polity-scroll", `document.querySelector('.pane-body').scrollTop=900;`, 1200),
  V("settlement", `const h=A.get().history; const s=[...h.settlements].sort((a,b)=>Math.max(...b.pop)-Math.max(...a.pop))[0]; A.open({kind:"settlement",id:s.id});`, 2600),
  V("person", `const h=A.get().history; const p=h.persons.find(p=>p.roles.some(r=>r.kind==="ruler")&&p.children.length>1)||h.persons.find(p=>p.roles.some(r=>r.kind==="ruler"))||h.persons[0]; A.open({kind:"person",id:p.id});`, 2200),
  V("language", `const h=A.get().history; const l=h.languages.find(l=>l.ended<0&&l.parent>=0)||h.languages[0]; A.open({kind:"language",id:l.id});`, 2000),
  V("language-scroll", `document.querySelector('.pane-body').scrollTop=1100;`, 1000),
  V("war", `const h=A.get().history; const w=[...h.wars].sort((a,b)=>b.battles.length-a.battles.length)[0]; A.setYear(w.start); A.open({kind:"war",id:w.id});`, 2400),
  V("religion", `const h=A.get().history; const r=h.religions.find(r=>r.kind!=="folk")||h.religions[0]; A.open({kind:"religion",id:r.id});`, 2200),
  V("chronicle", `A.setYear(1200); A.navigate({tab:"chronicle"});`, 1500),
  V("index", `A.navigate({tab:"article"});`, 1200),
  V("place", `const h=A.get().history; const s=[...h.settlements].sort((a,b)=>Math.max(...b.pop)-Math.max(...a.pop))[2]; A.navigate({tab:"article", sub:s.cell}); A.set({pickedCell:s.cell});`, 1800),
  V("atlas", `A.navigate({tab:"atlas"});`, 6000),
  V("tongues-pane", `A.navigate({tab:"tongues"});`, 2000),
  V("scripts-pane", `A.navigate({tab:"scripts"});`, 2000),
  V("faiths-pane", `A.navigate({tab:"faiths"});`, 2000),
  V("heraldry-pane", `A.navigate({tab:"heraldry"});`, 2500),
  V("search", `A.navigate({tab:"world"}); A.set({overlay:"search"}); setTimeout(()=>{const i=document.getElementById('search-input'); i.value='ka'; i.dispatchEvent(new Event('input',{bubbles:true}));},50);`, 1000),
  V("seed", `A.set({overlay:"seed"});`, 700),
  V("collapsed", `A.set({overlay:null, pane:"collapsed", layer:"realms"});`, 1500),
  V("expanded", `A.set({pane:"expanded"}); const h=A.get().history; const p=[...h.polities].sort((a,b)=>b.peak.areaKm2-a.peak.areaKm2)[1]; A.open({kind:"polity",id:p.id});`, 2500),
];

const url = "file://" + resolve("dist/index.html") + query + `#seed-${seed}`;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(flags.dpr ?? 1), colorScheme: theme, reducedMotion: flags.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  // Google Fonts are unreachable from the sandbox (and stall screenshots waiting for fonts):
  // abort them so the locally installed copies of the faces are used.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      const t = m.text();
      if (!/fonts\.(googleapis|gstatic)|ERR_CERT/.test(t)) console.log(`[console.${m.type()}]`, t.slice(0, 400));
    }
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  if (flags.genesis) {
    for (const [name, ms] of [["genesis-1", 1800], ["genesis-2", 6000], ["genesis-3", 13000]] as const) {
      await page.waitForTimeout(ms - (Date.now() - t0) > 0 ? ms - (Date.now() - t0) : 0);
      if (!only || only.has(name)) await page.screenshot({ path: `out/app/${prefix}-${name}.png` });
    }
  }
  await page.waitForFunction("window.__app && window.__app.ready()", null, { timeout: 240000, polling: 250 });
  if (flags.genesis && (!only || only.has("genesis-replay"))) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `out/app/${prefix}-genesis-replay.png` });
  }
  console.log(`ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`, await page.evaluate("JSON.stringify(window.__app.get().timings)"));
  await page.evaluate("window.__app.skip()");
  await page.waitForTimeout(600);
  for (const v of views) {
    if (only && !only.has(v.name)) continue;
    try {
      await page.evaluate(`(()=>{const A=window.__app; ${v.js}})()`);
    } catch (e) {
      console.log(`[view ${v.name}] setup failed:`, (e as Error).message.split("\n")[0]);
      continue;
    }
    await page.waitForTimeout(v.wait ?? 900);
    const path = `out/app/${prefix}-${v.name}.png`;
    if (v.selector) await page.locator(v.selector).screenshot({ path });
    else await page.screenshot({ path });
    console.log("wrote", path, flags.probe ? await page.evaluate(`JSON.stringify({ov: window.__app.get().overlay, scrim: !!document.querySelector('.scrim'), pane: window.__app.get().pane, shell: document.querySelector('.shell')?.className, loc: window.__app.loc()})`) : "");
  }
} finally {
  await browser.close();
}
