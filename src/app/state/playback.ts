/**
 * Timeline playback (requestAnimationFrame loop) and the genesis replay.
 */
import { app, setYear } from "./app";
import { pushTicker } from "./generation";
import type { Rich } from "../../narrative/types";

let raf = 0;
let last = 0;
let acc = 0;
let tickerFrom = 0;
let lastTickerYear = -1e9;
const REPLAY_SPEED = 160; // years per second during genesis
const DEFAULT_SPEED = 50;

export function richText(r: Rich): string {
  return r.map((i) => (typeof i === "string" ? i : i.t === "native" ? i.name.roman : i.t === "year" ? (i.text ?? String(i.year)) : i.text)).join("");
}

function frame(t: number): void {
  raf = 0;
  const s = app.get();
  if (!s.playing || !s.history) return;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  acc += dt * s.speed;
  if (acc >= 1) {
    const step = Math.floor(acc);
    acc -= step;
    const end = s.history.endYear;
    const y = Math.min(end, s.year + step);
    app.set({ year: y });
    if (s.replay) feedTicker(y);
    if (y >= end) {
      if (s.replay) finishGenesis();
      else app.set({ playing: false });
      return;
    }
  }
  raf = requestAnimationFrame(frame);
}

function feedTicker(year: number): void {
  const s = app.get();
  const h = s.history, nar = s.narrative;
  if (!h) return;
  const items: { year: number; text: string }[] = [];
  // Events are sorted by year; walk forward from where we left off.
  const ev = h.events;
  let i = tickerFrom;
  let best: (typeof ev)[number] | null = null;
  while (i < ev.length && ev[i].year <= year) {
    const e = ev[i];
    if (e.importance >= 4 && (!best || e.importance > best.importance)) best = e;
    i++;
  }
  tickerFrom = i;
  // At most one line per ~40 simulated years, so each can be read.
  if (best && best.year - lastTickerYear >= 40) {
    lastTickerYear = best.year;
    let text = "";
    try {
      text = nar ? richText(nar.headline(best.id)) : "";
    } catch {
      text = "";
    }
    if (text) items.push({ year: best.year, text });
  }
  pushTicker(items);
}

function start(): void {
  if (raf) return;
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

export function initPlayback(): void {
  app.subscribe((s, prev) => {
    if (s.playing !== prev.playing || s.history !== prev.history) {
      if (s.playing && s.history) start();
      else stop();
    }
  });
}

const reducedMotion = (): boolean => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** After a non-live engine finishes: replay the history on the timeline with a ticker. */
export function startReplay(): void {
  const s = app.get();
  if (!s.history) return;
  if (reducedMotion()) {
    finishGenesis();
    return;
  }
  tickerFrom = 0;
  lastTickerYear = -1e9;
  app.set({ replay: true, genesis: true, year: 0, speed: REPLAY_SPEED, playing: true, ticker: [] });
}

/** End the genesis experience: timeline at the final year, World article. */
export function finishGenesis(): void {
  const s = app.get();
  const end = s.history?.endYear ?? s.year;
  app.set({ genesis: false, replay: false, playing: false, speed: DEFAULT_SPEED, year: end, live: null });
}

/** Called on any user interaction with the timeline during genesis. */
export function interruptGenesis(): void {
  const s = app.get();
  if (!s.genesis || !s.history) return;
  app.set({ genesis: false, replay: false, playing: false, speed: DEFAULT_SPEED });
}

export function step(years: number): void {
  const s = app.get();
  interruptGenesis();
  app.set({ playing: false });
  setYear(s.year + years);
}
