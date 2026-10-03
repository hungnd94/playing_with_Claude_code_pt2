/**
 * Tree diagrams (left → right dendrogram with ink elbows): language, script,
 * religion and culture families, dynasties and family trees. Labels are links.
 */
import type { Figure, Ref } from "../../../../narrative/types";
import type { History, Id } from "../../../../history/types";
import { app } from "../../../state/app";
import { useStore } from "../../../state/store";
import { EntityLink } from "../Rich";
import { personName } from "../../../engine/query";
import { currentLoc } from "../../../state/app";

export interface TNode {
  ref: Ref;
  label: string;
  sub?: string;
  dead?: boolean;
  children: TNode[];
}

const MAX_NODES = 140;

function build(h: History, root: Ref, rel: Extract<Figure, { kind: "tree" }>["relation"]): TNode | null {
  let count = 0;
  const span = (a: number, b: number): string => `${a}–${b >= 0 ? b : ""}`;
  const walk = (id: Id, depth: number, get: (id: Id) => { label: string; sub?: string; dead?: boolean; children: Id[]; kind: Ref["kind"] } | null): TNode | null => {
    const x = get(id);
    if (!x || count >= MAX_NODES) return null;
    count++;
    const kids = depth < 12 ? x.children.map((c) => walk(c, depth + 1, get)).filter((n): n is TNode => !!n) : [];
    return { ref: { kind: x.kind, id }, label: x.label, sub: x.sub, dead: x.dead, children: kids };
  };
  switch (rel) {
    case "language":
      return walk(root.id, 0, (id) => {
        const L = h.languages[id];
        return L ? { kind: "language", label: L.name, sub: span(L.born, L.ended), dead: L.ended >= 0 && L.children.length === 0, children: L.children } : null;
      });
    case "script":
      return walk(root.id, 0, (id) => {
        const S = h.scripts[id];
        return S ? { kind: "script", label: S.name, sub: `${S.kind}, ${S.born}`, children: S.children } : null;
      });
    case "religion":
      return walk(root.id, 0, (id) => {
        const R = h.religions[id];
        return R ? { kind: "religion", label: cap(R.english.replace(/^the /, "")), sub: span(R.founded, R.ended), dead: R.ended >= 0, children: R.children } : null;
      });
    case "culture":
      return walk(root.id, 0, (id) => {
        const C = h.cultures[id];
        return C ? { kind: "culture", label: C.adjective, sub: span(C.born, C.ended), dead: C.ended >= 0, children: C.children } : null;
      });
    case "dynasty": {
      const D = h.dynasties[root.id];
      if (!D || D.founder < 0) return null;
      return walk(D.founder, 0, (id) => {
        const P = h.persons[id];
        if (!P) return null;
        const kids = P.children.filter((c) => h.persons[c]?.dynasty === root.id || h.persons[c]?.roles.some((r) => r.kind === "ruler"));
        return { kind: "person", label: personName(h, id), sub: span(P.born, P.died), children: kids.filter((c) => h.persons[c]?.dynasty === root.id) };
      });
    }
    case "family": {
      const P = h.persons[root.id];
      if (!P) return null;
      // From the grandfather (if known) down three generations.
      let top = P.id;
      for (let i = 0; i < 2; i++) {
        const f = h.persons[top]?.father ?? -1;
        if (f >= 0) top = f;
      }
      const startDepth = new Map<Id, number>();
      return walk(top, 0, (id) => {
        const Q = h.persons[id];
        if (!Q) return null;
        const d = startDepth.get(id) ?? 0;
        for (const c of Q.children) startDepth.set(c, d + 1);
        return { kind: "person", label: personName(h, id), sub: span(Q.born, Q.died), children: d < 4 ? Q.children : [] };
      });
    }
  }
  return null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Placed {
  n: TNode;
  x: number;
  y: number;
}

const COL = 168, ROW = 34, PADX = 8, PADY = 10;

export function layoutTree(root: TNode): { placed: Placed[]; edges: [Placed, Placed][]; w: number; h: number } {
  const placed: Placed[] = [];
  const edges: [Placed, Placed][] = [];
  let leaf = 0;
  let maxD = 0;
  const rec = (n: TNode, d: number): Placed => {
    maxD = Math.max(maxD, d);
    if (!n.children.length) {
      const p = { n, x: d, y: leaf++ };
      placed.push(p);
      return p;
    }
    const kids = n.children.map((c) => rec(c, d + 1));
    const p = { n, x: d, y: (kids[0].y + kids[kids.length - 1].y) / 2 };
    placed.push(p);
    for (const k of kids) edges.push([p, k]);
    return p;
  };
  rec(root, 0);
  return { placed, edges, w: (maxD + 1) * COL + PADX * 2, h: Math.max(1, leaf) * ROW + PADY * 2 };
}

export function TreeView({ root, highlight }: { root: TNode; highlight?: Ref }) {
  const { placed, edges, w, h } = layoutTree(root);
  const X = (p: Placed): number => PADX + p.x * COL;
  const Y = (p: Placed): number => PADY + p.y * ROW + ROW / 2;
  return (
    <div class="tree-scroll">
      <div class="tree" style={{ width: `${w}px`, height: `${h}px` }}>
        <svg width={w} height={h} class="tree-lines" aria-hidden="true">
          {edges.map(([a, b], i) => {
            const x0 = X(a) + 6, y0 = Y(a), x1 = X(b) - 4, y1 = Y(b);
            const xm = x0 + 18;
            return <path key={i} d={`M${x0} ${y0}H${xm}V${y1}H${x1}`} class={b.n.dead ? "is-dead" : ""} />;
          })}
          {placed.map((p, i) => (
            <circle key={i} cx={X(p)} cy={Y(p)} r={p.n.children.length ? 3 : 2.4} class={p.n.dead ? "is-dead" : ""} />
          ))}
        </svg>
        {placed.map((p, i) => {
          const hl = highlight && highlight.kind === p.n.ref.kind && highlight.id === p.n.ref.id;
          return (
            <div key={i} class={`tree-node ${hl ? "is-here" : ""} ${p.n.dead ? "is-dead" : ""}`} style={{ left: `${X(p) + (p.n.children.length ? -2 : 8)}px`, top: `${Y(p)}px`, transform: p.n.children.length ? "translate(0, calc(-100% - 3px))" : "translate(0, -50%)" }}>
              <EntityLink ref_={p.n.ref}>{p.n.label}</EntityLink>
              {p.n.sub ? <span class="tree-sub num">{p.n.sub}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TreeFigure({ fig }: { fig: Extract<Figure, { kind: "tree" }> }) {
  const history = useStore(app, (s) => s.history);
  const here = useStore(app, (s) => currentLoc(s).ref);
  if (!history) return null;
  const root = build(history, fig.root, fig.relation);
  if (!root) return null;
  if (!root.children.length && fig.relation !== "family") return null;
  return <TreeView root={root} highlight={here} />;
}
