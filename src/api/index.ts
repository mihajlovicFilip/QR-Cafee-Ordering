import { createDemoBackend } from './demo';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase when both env vars are set, otherwise the in-browser demo. */
export const backend: Backend = url && key ? createSupabaseBackend(url, key) : createDemoBackend();

export * from './types';
