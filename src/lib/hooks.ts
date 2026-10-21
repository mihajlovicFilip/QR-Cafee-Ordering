/** Shared hooks — live data, a ticking clock, and state that survives a reload. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from '../api';

/** Server-corrected clock that ticks every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + backend.serverOffset());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + backend.serverOffset()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Data that stays fresh on its own: fetched on mount, on every realtime change,
 * when the tab becomes visible again and, as a safety net, every `pollMs`.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  subscribe: (onChange: () => void) => () => void,
  deps: unknown[],
  pollMs = 20_000,
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    try {
      const next = await fetchRef.current();
      if (id === seq.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e);
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    void refresh();
    const unsubscribe = subscribe(() => void refresh());
    const poll = setInterval(() => void refresh(), pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      unsubscribe();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}

/** useState that survives reloads (per key). */
export function useStoredState<T>(key: string, initial: T, storage: 'local' | 'session' = 'local') {
  const store = () => (storage === 'local' ? window.localStorage : window.sessionStorage);
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = store().getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      store().setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked — keep the in-memory value */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);
  return [value, setValue] as const;
}
