/** Search palette ("/", ⌘K): fuzzy search over every name, with type badges. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { app, openRef } from "../../state/app";
import { useStore } from "../../state/store";
import { buildIndex, search } from "../../engine/search";
import { pingRef } from "../stage/bus";
import { IconSearch } from "../icons";

export function SearchPalette() {
  const narrative = useStore(app, (s) => s.narrative);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const index = useMemo(() => (narrative ? buildIndex(narrative.searchIndex()) : []), [narrative]);
  const results = useMemo(() => search(index, q, 50), [index, q]);
  useEffect(() => {
    input.current?.focus();
    return () => pingRef(null);
  }, []);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const r = results[sel];
    pingRef(r ? r.e.ref : null);
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, results]);
  const close = (): void => app.set({ overlay: null });
  const choose = (i: number): void => {
    const r = results[i];
    if (!r) return;
    close();
    openRef(r.e.ref);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  return (
    <div class="scrim" onClick={close}>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <div class="palette-field">
          <IconSearch size={18} />
          <input
            ref={input}
            id="search-input"
            type="text"
            placeholder={narrative ? "Search realms, cities, people, gods, rivers…" : "History is still being written…"}
            value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKey}
            autoComplete="off"
            spellcheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={results[sel] ? `sr-${sel}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul class="palette-list" id="search-results" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <li
              key={`${r.e.ref.kind}${r.e.ref.id}`}
              id={`sr-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === sel}
              class={i === sel ? "is-sel" : ""}
              onMouseMove={() => setSel(i)}
              onClick={() => choose(i)}
            >
              <span class="pr-label">{r.e.label}</span>
              {r.via ? <span class="pr-via">{r.via}</span> : null}
              <span class={`badge badge-${r.e.ref.kind}`}>{r.e.type}</span>
            </li>
          ))}
          {narrative && !results.length ? <li class="palette-empty">Nothing by that name is remembered.</li> : null}
        </ul>
        <div class="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span class="num">{index.length.toLocaleString("en-GB")} names</span>
        </div>
      </div>
    </div>
  );
}
