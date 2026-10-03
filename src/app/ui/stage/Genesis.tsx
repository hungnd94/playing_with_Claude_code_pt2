/**
 * The genesis experience over the globe: stage captions while the planet is
 * made, then the year counter racing and a ticker of great events while
 * history unfolds (live from the simulation, or replayed), with a skip.
 */
import { app } from "../../state/app";
import { useStore } from "../../state/store";
import { STAGE_CAPTIONS } from "../../protocol";
import { finishGenesis } from "../../state/playback";
import { seedTitle } from "../../state/seed";

function ageAt(ages: { name: string; start: number; end: number }[] | undefined, y: number): string {
  if (!ages) return "";
  const a = ages.find((a) => a.start <= y && y <= a.end);
  return a ? a.name.replace(/^the /, "The ") : "";
}

export function Genesis() {
  const genesis = useStore(app, (s) => s.genesis);
  const phase = useStore(app, (s) => s.phase);
  const stage = useStore(app, (s) => s.stage);
  const frac = useStore(app, (s) => s.stageFraction);
  const seed = useStore(app, (s) => s.seed);
  const err = useStore(app, (s) => s.error);
  const replay = useStore(app, (s) => s.replay);
  const liveSeen = useStore(app, (s) => s.liveSeen);
  const year = useStore(app, (s) => (s.replay || s.liveSeen ? s.year : -1));
  const end = useStore(app, (s) => s.history?.endYear ?? s.live?.endYear ?? 3000);
  const ages = useStore(app, (s) => s.history?.ages);
  const ticker = useStore(app, (s) => s.ticker);

  if (phase === "error") {
    return (
      <div class="genesis is-error" role="alert">
        <div class="genesis-world">{seedTitle(seed)}</div>
        <div class="genesis-rule" aria-hidden="true" />
        <p class="genesis-caption">The world could not be made</p>
        <p class="genesis-error">{err}</p>
      </div>
    );
  }
  if (!genesis) return null;
  const counting = replay || (liveSeen && phase !== "ready");
  const caption = STAGE_CAPTIONS[stage] ?? (phase === "history" ? "History begins" : "The world is made");
  const overall = phase === "physical" ? frac * 0.5 : phase === "history" ? 0.5 + frac * 0.5 : 1;
  return (
    <div class={`genesis ${counting ? "is-counting" : ""}`} aria-live="polite">
      <div class="genesis-world">{seedTitle(seed)}</div>
      <div class="genesis-rule" aria-hidden="true">
        <span style={{ transform: `scaleX(${counting ? year / Math.max(1, end) : overall})` }} />
      </div>
      {counting ? (
        <>
          <div class="genesis-year" aria-label={`Year ${year}`}>
            <span class="genesis-year-label">Year</span> <span class="num">{year}</span>
          </div>
          <div class="genesis-age">{ageAt(ages, year)}</div>
          <ol class="genesis-ticker" aria-label="Events">
            {ticker.slice(-3).map((t, i, arr) => (
              <li key={t.key} class={i === arr.length - 1 ? "is-new" : ""}>
                <span class="num">{t.year}</span> {t.text}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p class="genesis-caption" key={caption}>
          {caption}…
        </p>
      )}
      {counting || phase === "ready" ? (
        <button class="genesis-skip" onClick={() => finishGenesis()} disabled={phase !== "ready"}>
          Skip to the present <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </div>
  );
}
