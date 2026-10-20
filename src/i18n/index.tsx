import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Localized } from '../api/types';
import sr from './sr.json';
import en from './en.json';

// To add a language: create <code>.json with the same keys and register it here.
const DICTIONARIES: Record<string, unknown> = { sr, en };
export const LANGUAGES = Object.keys(DICTIONARIES);
const BASE = 'sr';
const STORAGE_KEY = 'stolic.lang';

type Vars = Record<string, string | number>;

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function pluralIndex(lang: string, n: number, forms: number): number {
  if (lang === 'sr' && forms >= 3) {
    const a = n % 10;
    const b = n % 100;
    if (a === 1 && b !== 11) return 0;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 1;
    return 2;
  }
  return n === 1 ? 0 : Math.min(1, forms - 1);
}

/** A string in a specific language, regardless of the visitor's choice (e.g. for printed QR cards). */
export function translateIn(lang: string, key: string, vars?: Vars): string {
  const v = lookup(DICTIONARIES[lang], key) ?? lookup(DICTIONARIES[BASE], key);
  return typeof v === 'string' ? interpolate(v, vars) : key;
}

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && DICTIONARIES[v] ? v : null;
  } catch {
    return null;
  }
}

export interface I18n {
  lang: string;
  languages: string[];
  setLang: (lang: string) => void;
  /** The language used until the visitor picks one (the café's default). */
  setFallbackLang: (lang: string) => void;
  t: (key: string, vars?: Vars) => string;
  /** Plural-aware: the key must hold an array of forms. `{n}` is filled in. */
  tp: (key: string, n: number, vars?: Vars) => string;
  /** Pick the visitor's language from localized content, falling back sensibly. */
  loc: (field: Localized | null | undefined) => string;
  money: (amount: number) => string;
  time: (ms: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<string | null>(readStored);
  const [fallback, setFallback] = useState(BASE);
  const lang = chosen ?? fallback;

  useEffect(() => {
    document.documentElement.lang = String(lookup(DICTIONARIES[lang], 'meta.htmlLang') ?? lang);
  }, [lang]);

  const setLang = useCallback((next: string) => {
    if (!DICTIONARIES[next]) return;
    setChosen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice still applies for this visit */
    }
  }, []);

  const setFallbackLang = useCallback((next: string) => {
    if (DICTIONARIES[next]) setFallback(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTIONARIES[lang];
    const base = DICTIONARIES[BASE];
    const locale = String(lookup(dict, 'meta.locale') ?? 'sr-Latn-RS');
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const resolve = (key: string) => lookup(dict, key) ?? lookup(base, key);
    return {
      lang,
      languages: LANGUAGES,
      setLang,
      setFallbackLang,
      t: (key, vars) => {
        const v = resolve(key);
        return typeof v === 'string' ? interpolate(v, vars) : key;
      },
      tp: (key, n, vars) => {
        const v = resolve(key);
        if (!Array.isArray(v) || !v.length) return key;
        return interpolate(String(v[pluralIndex(lang, n, v.length)]), { n, ...vars });
      },
      loc: (field) => {
        if (!field) return '';
        return field[lang] || field[fallback] || field[BASE] || Object.values(field)[0] || '';
      },
      // RSD in every language; only the digit grouping follows the language (1.040 / 1,040).
      money: (amount) => `${number.format(amount)} RSD`,
      time: (ms) => {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      },
    };
  }, [lang, fallback, setLang, setFallbackLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
