/**
 * The World page: while generating, the genesis log; then "this age" at the
 * timeline's year and the overview article.
 */
import { useMemo } from "preact/hooks";
import { app } from "../../state/app";
import { useStore } from "../../state/store";
import { ArticleView } from "./ArticleView";
import { Blocks } from "../rich/Blocks";
import { STAGE_CAPTIONS } from "../../protocol";
import { seedTitle } from "../../state/seed";

function GenesisLog() {
  const stages = useStore(app, (s) => s.stages);
  const phase = useStore(app, (s) => s.phase);
  const seed = useStore(app, (s) => s.seed);
  const timings = useStore(app, (s) => s.timings);
  const err = useStore(app, (s) => s.error);
  return (
    <article class="article genesis-log">
      <header class="art-head">
        <div class="art-kicker">Genesis</div>
        <h1 class="art-title">{seedTitle(seed)}</h1>
        <p class="art-sub">
          A world grown from the seed <q>{seed}</q>: its land and seas first, then its peoples, their tongues and three thousand years of their history.
        </p>
      </header>
      <ol class="glog">
        {stages.map((st, i) => {
          const done = i < stages.length - 1 || phase === "ready";
          return (
            <li key={`${st.phase}${st.stage}`} class={done ? "is-done" : "is-now"}>
              <span class="glog-mark" aria-hidden="true">{done ? "✓" : "·"}</span>
              <span class="glog-cap">{STAGE_CAPTIONS[st.stage] ?? st.stage}</span>
              <span class="glog-t num">{(st.t / 1000).toFixed(1)} s</span>
            </li>
          );
        })}
      </ol>
      {err ? <p class="glog-error">{err}</p> : null}
      {timings.physical ? (
        <p class="glog-note">
          Land and climate in <span class="num">{(timings.physical / 1000).toFixed(1)}</span> s
          {timings.bake2048 ? (
            <>
              ; globe painted in <span class="num">{(timings.bake2048 / 1000).toFixed(1)}</span> s
            </>
          ) : null}
          {timings.history ? (
            <>
              ; history in <span class="num">{(timings.history / 1000).toFixed(1)}</span> s
            </>
          ) : null}
          .
        </p>
      ) : null}
    </article>
  );
}

function ThisAge() {
  const narrative = useStore(app, (s) => s.narrative);
  const bucket = useStore(app, (s) => (s.playing ? Math.floor(s.year / 50) * 50 : Math.floor(s.year / 5) * 5));
  const end = useStore(app, (s) => s.history?.endYear ?? 0);
  const blocks = useMemo(() => {
    if (!narrative) return [];
    try {
      return narrative.atYear(Math.min(end, bucket));
    } catch (e) {
      console.warn(e);
      return [];
    }
  }, [narrative, bucket, end]);
  if (!blocks.length) return null;
  return (
    <section class="this-age" aria-label="This age">
      <div class="this-age-kicker">
        The world in <span class="num">{Math.min(end, bucket)}</span>
      </div>
      <Blocks blocks={blocks} />
    </section>
  );
}

export function WorldPane() {
  const narrative = useStore(app, (s) => s.narrative);
  const genesis = useStore(app, (s) => s.genesis);
  const article = useMemo(() => {
    if (!narrative) return null;
    try {
      return narrative.overview();
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [narrative]);
  if (!narrative || !article) return <GenesisLog />;
  return (
    <div class="world-pane">
      {!genesis ? <ThisAge /> : null}
      <ArticleView a={article} />
    </div>
  );
}
