# Engineer briefs

Each subsystem of Palimpsest is built by an engineer (an AI agent) working from one of these
briefs. The container this project is developed in restarts from time to time; whoever picks
up a module reads its brief, then `src/<module>/PROGRESS.md`, then continues.

## Rules for every engineer (shared checkout)

- Read `DESIGN.md` first: vision, architecture, conventions (determinism via `Rng` forks,
  typed arrays, DOM-free generation code, strict TS, tests in `tests/<module>/`, debug output
  in `out/<module>/`).
- Other engineers work in parallel in the same working tree. Only create/modify files in the
  directories your brief says you own. Do not edit `package.json`, `tsconfig.json`,
  `DESIGN.md`, `src/core/*`, `src/world/*` or other modules (unless your brief grants it). If
  another module lacks something you need, adapt inside your own directory and describe the
  desired change in your final report.
- Do NOT run git commands that change state (commit, add, stash, checkout, reset, rebase,
  clean). The lead commits.
- `npx tsc -p .` checks the whole project; errors in other directories may be someone else's
  work in progress — ignore those, but your own files must be error-free. Run only your own
  tests: `npx vitest run tests/<module>`.
- Keep `src/<module>/PROGRESS.md` (done / in progress / todo / decisions) current — update it
  after every major step. The container can restart at any moment; your successor resumes
  from your files and that note.
- **Resource hygiene** (4 CPUs / 15 GB shared by several engineers; the container has been
  restarting, possibly from memory pressure): never run more than one headless Chromium at a
  time and always let it close (`tools/shot.mjs` does); keep screenshots ≤ 1600×1200 unless
  you really need more; run heavy node scripts with `NODE_OPTIONS=--max-old-space-size=3072`;
  never leave dev servers, watchers or background processes running; don't run the whole
  repo's test suite.
- Look at what you make. PNGs can be viewed with the Read tool; `tools/shot.mjs` screenshots an
  HTML file with headless Chromium (WebGL via SwiftShader). Quality — visual and textual — is
  the point of this project: iterate on what you see/read, not just on passing tests.
- Work autonomously to completion; nobody will answer questions. Decide sensibly; document.
- Quality bar: this project is meant to be "mind-blowing" — the depth and polish of a
  passionate expert's labour of love, not a minimal implementation.
- When finished, reply with a concise report (≤ 500 words): what you built, public API, how to
  run your tools, performance, known limitations, requests for other modules.
