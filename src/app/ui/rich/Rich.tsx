/**
 * Inline rich text (src/narrative/types.ts `Rich`): links that ping the globe
 * on hover and open articles on click, native names with a hover card (IPA,
 * gloss, etymology, native script), years that move the timeline.
 */
import type { JSX } from "preact";
import type { Inline, Ref, Rich } from "../../../narrative/types";
import type { WName } from "../../../history/types";
import { openRef, setYear } from "../../state/app";
import { interruptGenesis } from "../../state/playback";
import { pingRef } from "../stage/bus";
import { showNameCard, hideNameCard } from "./NameCard";

let pingT = 0;
export function hoverRef(ref: Ref | null): void {
  clearTimeout(pingT);
  if (ref) pingT = window.setTimeout(() => pingRef(ref), 70);
  else pingRef(null);
}

export function activate(e: KeyboardEvent, fn: () => void): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

export function EntityLink(props: { ref_: Ref; children: JSX.Element | string | (JSX.Element | string)[]; class?: string; title?: string }) {
  const r = props.ref_;
  const open = (): void => {
    hoverRef(null);
    openRef(r);
  };
  return (
    <a
      class={`lk lk-${r.kind} ${props.class ?? ""}`}
      role="link"
      tabIndex={0}
      title={props.title}
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
      onKeyDown={(e) => activate(e, open)}
      onMouseEnter={() => hoverRef(r)}
      onMouseLeave={() => hoverRef(null)}
      onFocus={() => hoverRef(r)}
      onBlur={() => hoverRef(null)}
    >
      {props.children}
    </a>
  );
}

export function NativeName(props: { name: WName; class?: string; plain?: boolean }) {
  const n = props.name;
  const show = (e: Event): void => showNameCard(n, (e.currentTarget as HTMLElement).getBoundingClientRect());
  return (
    <span
      class={`native ${props.plain ? "is-plain" : ""} ${props.class ?? ""}`}
      tabIndex={0}
      lang="x-native"
      aria-label={`${n.roman}${n.gloss ? `, “${n.gloss}”` : ""}`}
      onMouseEnter={show}
      onMouseLeave={hideNameCard}
      onFocus={show}
      onBlur={hideNameCard}
    >
      {n.roman}
    </span>
  );
}

export function YearLink(props: { year: number; text?: string }) {
  const go = (): void => {
    interruptGenesis();
    setYear(props.year);
  };
  return (
    <a class="yr" role="button" tabIndex={0} title={`Move the timeline to ${props.year}`} onClick={go} onKeyDown={(e) => activate(e, go)}>
      <span class="num">{props.text ?? String(props.year)}</span>
    </a>
  );
}

export function InlineNode({ node }: { node: Inline }): JSX.Element | null {
  if (typeof node === "string") return <>{node}</>;
  switch (node.t) {
    case "link":
      return <EntityLink ref_={node.ref}>{node.text}</EntityLink>;
    case "em":
      return <em>{node.text}</em>;
    case "strong":
      return <strong>{node.text}</strong>;
    case "native":
      return <NativeName name={node.name} />;
    case "year":
      return <YearLink year={node.year} text={node.text} />;
    default:
      return null;
  }
}

export function RichText({ content }: { content: Rich | undefined }) {
  if (!content) return null;
  return (
    <>
      {content.map((n, i) => (
        <InlineNode key={i} node={n} />
      ))}
    </>
  );
}

/** Plain-text rendering of rich content (aria labels, ticker). */
export function richPlain(r: Rich | undefined): string {
  if (!r) return "";
  return r.map((i) => (typeof i === "string" ? i : i.t === "native" ? i.name.roman : i.t === "year" ? (i.text ?? String(i.year)) : i.text)).join("");
}
