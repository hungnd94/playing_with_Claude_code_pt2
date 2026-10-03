/**
 * IPA charts of a language: the pulmonic consonant table (places × manners,
 * voiceless left / voiced right) and the vowel trapezoid.
 */
import type { Language as LLanguage } from "../../../../lang/types";
import { features, vowelQuality, PLACES, MANNERS, type ConsonantFeatures, type VowelFeatures } from "../../../../lang/phoneme";

const PLACE_LABEL: Record<string, string> = {
  bilabial: "Bilabial",
  labiodental: "Labio­dental",
  dental: "Dental",
  alveolar: "Alveolar",
  postalveolar: "Post­alveolar",
  retroflex: "Retroflex",
  alveolopalatal: "Palatal",
  palatal: "Palatal",
  velar: "Velar",
  labiovelar: "Labio­velar",
  uvular: "Uvular",
  pharyngeal: "Pharyn­geal",
  glottal: "Glottal",
};
const MANNER_LABEL: Record<string, string> = {
  stop: "Plosive",
  affricate: "Affricate",
  fricative: "Fricative",
  nasal: "Nasal",
  trill: "Trill",
  tap: "Tap or flap",
  lateral: "Lateral approximant",
  latfricative: "Lateral fricative",
  lataffricate: "Lateral affricate",
  approximant: "Approximant",
};

/** Merge alveolopalatal into the palatal column (as the IPA chart does for display). */
const col = (p: string): string => (p === "alveolopalatal" ? "palatal" : p);

export function ConsonantTable({ consonants }: { consonants: string[] }) {
  const cells = new Map<string, { vl: string[]; vd: string[] }>();
  const placesUsed = new Set<string>();
  const mannersUsed = new Set<string>();
  const odd: string[] = [];
  for (const p of consonants) {
    const f = features(p);
    if (!f || f.kind !== "C") {
      odd.push(p);
      continue;
    }
    const c = f as ConsonantFeatures;
    const pl = col(c.place);
    placesUsed.add(pl);
    mannersUsed.add(c.manner);
    const k = `${c.manner}|${pl}`;
    let e = cells.get(k);
    if (!e) cells.set(k, (e = { vl: [], vd: [] }));
    (c.voice ? e.vd : e.vl).push(p);
  }
  const places = PLACES.map(col).filter((p, i, a) => a.indexOf(p) === i && placesUsed.has(p));
  const manners = MANNERS.filter((m) => mannersUsed.has(m));
  return (
    <div class="table-wrap">
      <table class="ipa-table">
        <caption>Consonants</caption>
        <thead>
          <tr>
            <th />
            {places.map((p) => (
              <th key={p} scope="col">
                {PLACE_LABEL[p] ?? p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {manners.map((m) => (
            <tr key={m}>
              <th scope="row">{MANNER_LABEL[m] ?? m}</th>
              {places.map((p) => {
                const e = cells.get(`${m}|${p}`);
                return (
                  <td key={p} class={e ? "" : "is-empty"}>
                    {e ? (
                      <span class="ipa-pair">
                        <span class="ipa-vl">{e.vl.join(" ")}</span>
                        <span class="ipa-vd">{e.vd.join(" ")}</span>
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {odd.length ? <p class="ipa-note">Also: {odd.join(" ")}</p> : null}
    </div>
  );
}

export function VowelChart({ vowels }: { vowels: string[] }) {
  const W = 340, H = 230, L = 64, T = 30, R = 34, B = 22;
  // IPA trapezoid: top edge full width; front edge slants in to half width at the bottom.
  const xy = (height: number, back: number): [number, number] => {
    const y = T + (height / 6) * (H - T - B);
    const xf = L + ((height / 6) * (W - L - R)) / 2;
    const xb = W - R;
    return [xf + (back / 2) * (xb - xf), y];
  };
  const qual = new Map<string, { f: VowelFeatures; long: boolean; nasal: boolean }>();
  for (const v of vowels) {
    const f = features(v);
    if (!f || f.kind !== "V") continue;
    const q = vowelQuality(v);
    const e = qual.get(q);
    const vf = f as VowelFeatures;
    if (!e) qual.set(q, { f: vf, long: vf.long, nasal: vf.nasal });
    else {
      e.long ||= vf.long;
      e.nasal ||= vf.nasal;
    }
  }
  const longs = vowels.filter((v) => (features(v) as VowelFeatures | undefined)?.long);
  const nasals = vowels.filter((v) => (features(v) as VowelFeatures | undefined)?.nasal);
  const [a, b] = [xy(0, 0), xy(0, 2)];
  const [c, d] = [xy(6, 2), xy(6, 0)];
  return (
    <figure class="vowel-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Vowels: ${[...qual.keys()].join(", ")}`}>
        <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}L${c[0]} ${c[1]}L${d[0]} ${d[1]}Z`} class="vc-frame" />
        {[2, 4].map((hh) => {
          const p = xy(hh, 0), q = xy(hh, 2);
          return <line key={hh} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} class="vc-grid" />;
        })}
        {(() => {
          const p = xy(0, 1), q = xy(6, 1);
          return <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} class="vc-grid" />;
        })()}
        <text x={L - 22} y={T + 4} class="vc-axis" text-anchor="end">close</text>
        <text x={L - 22} y={xy(2, 0)[1] + 4} class="vc-axis" text-anchor="end">close-mid</text>
        <text x={L - 22} y={xy(4, 0)[1] + 4} class="vc-axis" text-anchor="end">open-mid</text>
        <text x={xy(6, 0)[0] - 22} y={H - B + 4} class="vc-axis" text-anchor="end">open</text>
        <text x={a[0]} y={T - 14} class="vc-axis">front</text>
        <text x={(a[0] + b[0]) / 2} y={T - 14} class="vc-axis" text-anchor="middle">central</text>
        <text x={b[0]} y={T - 14} class="vc-axis" text-anchor="end">back</text>
        {[...qual.entries()].map(([q, e]) => {
          const [x, y] = xy(e.f.height, e.f.back);
          const dx = e.f.round ? 9 : -9;
          return (
            <g key={q}>
              <circle cx={x} cy={y} r="2.6" class="vc-dot" />
              <text x={x + dx} y={y + 5} class="vc-sym" text-anchor={e.f.round ? "start" : "end"}>
                {q}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Vowels{longs.length ? <> · length is distinctive (<span class="ipa">{longs.slice(0, 5).join(" ")}</span>)</> : null}
        {nasals.length ? <> · nasal vowels (<span class="ipa">{nasals.slice(0, 5).join(" ")}</span>)</> : null}
      </figcaption>
    </figure>
  );
}

export function PhonemeFigure({ lang }: { lang: LLanguage | null }) {
  if (!lang?.phonology) return null;
  return (
    <div class="phonemes">
      <ConsonantTable consonants={lang.phonology.consonants} />
      <VowelChart vowels={lang.phonology.vowels} />
    </div>
  );
}
