"use client";

import { useRef, useState } from "react";

/** One page loaded after the first: its rows, what rode along with it, and the cursor chain around it. */
type LoadedPage<T, X> = { items: readonly T[]; extra: X; from: string; next: string | null };

export type CursorPageResult<T, X> =
  | { ok: true; items: readonly T[]; next: string | null; total: number | null; extra: X }
  | { ok: false };

/**
 * THE APPEND-BY-CURSOR STATE of a board ("Show more" / "Show less").
 *
 * The server renders the FIRST page (`first`) and the cursor of the one after it (`firstNext`). Every
 * later page is fetched with the cursor the previous page returned and appended here. The chain is
 * explicit — each loaded page remembers the cursor it was fetched FROM and the cursor it returned — so:
 *
 *   - "Show more" always asks for exactly the page after the last one shown;
 *   - "Show less" drops the last appended page, which makes the previous page's `next` the cursor again,
 *     so a later "Show more" fetches that same page afresh and the chain can never skew;
 *   - the first page is never dropped, and nothing is cached past what is on screen;
 *   - a new question (`resetKey` changes — a new filter, sort, or a new first page) discards every
 *     appended page and the whole chain, and a response that arrives after that is ignored;
 *   - a failed load keeps everything shown and can be retried;
 *   - a row the database already returned on an earlier page is never added twice.
 *
 * There is no ceiling and no row count anywhere: the board has more exactly while the last page shown
 * returned a cursor.
 */
export function useCursorPages<T extends { id: string }, X = undefined>({
  resetKey,
  first,
  firstNext,
  firstTotal,
  fetchPage,
}: {
  /** Identifies the question AND its first page; appended pages belong to exactly one. */
  resetKey: string;
  first: readonly T[];
  firstNext: string | null;
  firstTotal: number;
  fetchPage: (cursor: string) => Promise<CursorPageResult<T, X>>;
}) {
  type State = { key: string; pages: LoadedPage<T, X>[]; total: number | null };
  const [state, setState] = useState<State>({ key: resetKey, pages: [], total: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const latestKey = useRef(resetKey);
  latestKey.current = resetKey;

  const current: State = state.key === resetKey ? state : { key: resetKey, pages: [], total: null };
  const last = current.pages[current.pages.length - 1];
  const next = last ? last.next : firstNext;

  const showMore = async () => {
    const from = next;
    if (from === null || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    const startedFor = resetKey;
    let result: CursorPageResult<T, X>;
    try {
      result = await fetchPage(from);
    } catch {
      result = { ok: false };
    }
    busy.current = false;
    setLoading(false);
    // The question changed while this was in flight: the page belongs to a list that is gone.
    if (latestKey.current !== startedFor) return;
    if (!result.ok) {
      setError(true);
      return;
    }
    setState((existing) => {
      const base: State = existing.key === startedFor ? existing : { key: startedFor, pages: [], total: null };
      const tip = base.pages[base.pages.length - 1];
      // The chain moved (a "Show less" landed first): this page no longer follows what is shown.
      if ((tip ? tip.next : firstNext) !== from) return base;
      const have = new Set([...first, ...base.pages.flatMap((page) => page.items)].map((item) => item.id));
      return {
        key: startedFor,
        total: result.total ?? base.total,
        pages: [...base.pages, { items: result.items.filter((item) => !have.has(item.id)), extra: result.extra, from, next: result.next }],
      };
    });
  };

  const showFewer = () => {
    setError(false);
    setState((existing) => (existing.key === resetKey ? { ...existing, pages: existing.pages.slice(0, -1) } : existing));
  };

  return {
    items: current.pages.length ? [...first, ...current.pages.flatMap((page) => page.items)] : first,
    /** What rode along with each appended page (in order), e.g. which of its rows the caller has saved. */
    extras: current.pages.map((page) => page.extra),
    total: current.total ?? firstTotal,
    hasMore: next !== null,
    canShowFewer: current.pages.length > 0,
    loading,
    error,
    showMore,
    showFewer,
  };
}
