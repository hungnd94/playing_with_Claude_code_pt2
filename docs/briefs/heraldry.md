# Brief: heraldry and emblems (src/heraldry/)

You own: `src/heraldry/**`, `tests/heraldry/**`, `tools/heraldry-*.ts`. Read
`src/world/concepts.ts` (draw every EMBLEM_CONCEPTS entry; use TINCTURES) and the `Emblem`
interface in `src/history/types.ts` — history stores your output as `{ kind, data, blazon }`;
provide `renderEmblemSVG(emblem, opts)` dispatching on kind ("arms" | "mon" | "seal" |
"banner"). The history engineer is using your API now: keep signatures stable.

Purpose. Every realm, dynasty, city and religious order bears arms or an emblem, shown large
with blazon in the encyclopedia and small on maps/lists. Cadet branches get differenced arms,
unions get marshalled arms, a house named "Wolf-spear" gets canting arms. Non-European
traditions too.

Design (document in `src/heraldry/README.md`): `Arms` plain JSON (fields, furs, divisions with
lines of partition, ordinaries, charges with counts/arrangements, cadency, marshalling);
charges = all EMBLEM_CONCEPTS + classic geometric ones, drawn as bold readable heraldic
silhouettes with internal detail (beasts in proper attitudes) — displayed large, so iterate
until each reads at a glance; `generateArms(rng, opts)` (cultural styles, rule of tincture,
real complexity distribution), `differenceArms`, `marshalArms`, `cantingCharge(glossWords)`;
`blazon(arms)` in correct English blazon; `renderArmsSVG(arms, { shape, size, idPrefix })` with
several shield shapes and a tasteful finish, unique ids; `renderBannerSVG`, `generateFlag` +
`renderFlagSVG`, `generateMon` + render (radial monochrome emblems), seals/medallions with an
inscription ring; handsome historical palettes.

Visual verification: `tools/heraldry-demo.ts` → out/heraldry/demo.html; screenshot (≤1600 wide,
`--full=1`, crops with `--dpr=2 --selector=...`), READ, iterate.
Tests: determinism, rule of tincture, blazon sanity (no undefined/NaN), valid SVG, unique ids.
