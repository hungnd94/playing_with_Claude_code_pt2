/**
 * Comparative word list: concepts × languages, romanised forms with IPA on
 * hover; cognate sets marked by a superscript letter and a faint shared tint.
 */
import type { History, Id } from "../../../../history/types";
import type { Language as LLanguage } from "../../../../lang/types";
import { romanizeWord, ipaWord } from "../../../../lang/orthography";
import { CONCEPT_BY_ID } from "../../../../lang/concepts";
import { EntityLink } from "../Rich";

const LETTERS = "ABCDEFGHJK";

export function langData(h: History, id: Id): LLanguage | null {
  const d = h.languages[id]?.data as LLanguage | undefined;
  return d && d.lexicon ? d : null;
}

export function CognateTable({ h, languages, concepts }: { h: History; languages: Id[]; concepts: string[] }) {
  const langs = languages.map((id) => ({ id, d: langData(h, id) })).filter((x): x is { id: Id; d: LLanguage } => !!x.d);
  if (langs.length < 2) return null;
  const rows = concepts
    .map((c) => {
      const cells = langs.map(({ d }) => {
        const lx = d.lexicon[c];
        if (!lx) return null;
        let roman = "", ipa = "";
        try {
          roman = romanizeWord(d.orthography, lx.form);
          ipa = ipaWord(lx.form, d.phonology.stress, d.phonology);
        } catch {
          roman = lx.form.join("");
        }
        return { roman, ipa, set: lx.since ?? d.id };
      });
      const sets: string[] = [];
      for (const x of cells) if (x && !sets.includes(x.set)) sets.push(x.set);
      return { c, cells, sets };
    })
    .filter((r) => r.cells.some((x) => x));
  return (
    <div class="table-wrap">
      <table class="cognates">
        <thead>
          <tr>
            <th scope="col">Meaning</th>
            {langs.map(({ id }) => (
              <th key={id} scope="col">
                <EntityLink ref_={{ kind: "language", id }}>{h.languages[id].name}</EntityLink>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.c}>
              <th scope="row">‘{CONCEPT_BY_ID[r.c]?.en ?? r.c}’</th>
              {r.cells.map((x, i) =>
                x ? (
                  <td key={i} class={`cog-set cog-${r.sets.indexOf(x.set) % 6}`} title={x.ipa ? `/${x.ipa}/` : undefined}>
                    <em>{x.roman}</em>
                    {r.sets.length > 1 ? <sup class="cog-letter">{LETTERS[r.sets.indexOf(x.set)] ?? "?"}</sup> : null}
                  </td>
                ) : (
                  <td key={i} class="is-empty">—</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="table-note">Words sharing a letter descend from one ancestral word; a different letter marks a replacement or loan.</p>
    </div>
  );
}
