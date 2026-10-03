/** New world: seed entry, random seed, curated seeds. */
import { useEffect, useRef, useState } from "preact/hooks";
import { app } from "../../state/app";
import { useStore } from "../../state/store";
import { CURATED_SEEDS, normalizeSeed, randomSeed, seedTitle, writeSeedHash } from "../../state/seed";
import { generate } from "../../state/generation";
import { IconDice, IconClose } from "../icons";

export function startWorld(seed: string): void {
  const s = normalizeSeed(seed);
  if (!s) return;
  app.set({ overlay: null });
  writeSeedHash(s);
  generate(s);
}

export function SeedDialog() {
  const cur = useStore(app, (s) => s.seed);
  const [v, setV] = useState(cur);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const close = (): void => app.set({ overlay: null });
  const norm = normalizeSeed(v);
  return (
    <div class="scrim" onClick={close}>
      <div class="seed-dialog" role="dialog" aria-modal="true" aria-labelledby="seed-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <button class="dlg-close" onClick={close} aria-label="Close">
          <IconClose />
        </button>
        <h2 id="seed-title">A new world</h2>
        <p class="dlg-sub">Every world is grown from a single word. The same word always grows the same world, so a seed can be shared.</p>
        <form
          class="seed-form"
          onSubmit={(e) => {
            e.preventDefault();
            startWorld(v);
          }}
        >
          <label for="seed-input" class="sr-only">
            Seed
          </label>
          <input ref={input} id="seed-input" value={v} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} autoComplete="off" spellcheck={false} maxLength={40} placeholder="a word" />
          <button type="button" class="btn" onClick={() => setV(randomSeed())} title="A random word">
            <IconDice /> Random
          </button>
          <button type="submit" class="btn btn-primary" disabled={!norm}>
            Grow {norm ? <em>{seedTitle(norm)}</em> : "it"}
          </button>
        </form>
        <h3 class="dlg-h">Worlds to visit</h3>
        <ul class="curated">
          {CURATED_SEEDS.map((c) => (
            <li key={c.seed}>
              <button class={`curated-btn ${c.seed === cur ? "is-cur" : ""}`} onClick={() => startWorld(c.seed)}>
                <span class="curated-name">{seedTitle(c.seed)}</span>
                <span class="curated-note">{c.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
