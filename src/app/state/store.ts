/**
 * A tiny external store with selector subscriptions. Components subscribe to
 * just the slice they render, so the year ticking at 60 Hz only re-renders the
 * few components that show the year.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: (s: T, prev: T) => void): () => void;
}

export function createStore<T extends object>(init: T): Store<T> {
  let state = init;
  const subs = new Set<(s: T, prev: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === "function" ? patch(state) : patch;
      let changed = false;
      for (const k in p) if (!Object.is((state as Record<string, unknown>)[k], (p as Record<string, unknown>)[k])) { changed = true; break; }
      if (!changed) return;
      const prev = state;
      state = { ...state, ...p };
      for (const fn of [...subs]) {
        try {
          fn(state, prev);
        } catch (e) {
          console.error("[store] subscriber failed", e);
        }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Subscribe a component to `select(state)`; re-renders only when the selection changes (Object.is or shallow array). */
export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  const [, force] = useState(0);
  const selRef = useRef(select);
  selRef.current = select;
  const valRef = useRef<S>(select(store.get()));
  valRef.current = select(store.get());
  useLayoutEffect(() => {
    return store.subscribe((s) => {
      const next = selRef.current(s);
      if (!same(next, valRef.current)) {
        valRef.current = next;
        force((x) => x + 1);
      }
    });
  }, [store]);
  return valRef.current;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  return false;
}

/** Run `fn` whenever the selection changes (outside render), e.g. to drive the globe imperatively. */
export function useStoreEffect<T extends object, S>(store: Store<T>, select: (s: T) => S, fn: (v: S, prev: S | undefined) => void, deps: unknown[] = []): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let prev: S | undefined = undefined;
    let first = true;
    const run = (s: T): void => {
      const v = select(s);
      if (!first && same(v, prev)) return;
      first = false;
      const p = prev;
      prev = v;
      fnRef.current(v, p);
    };
    run(store.get());
    return store.subscribe((s) => run(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);
}
