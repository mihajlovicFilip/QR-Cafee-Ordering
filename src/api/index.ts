/**
 * The backend the app talks to — chosen once, at start.
 *
 * With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set, the real database (supabase.ts);
 * without them, the in-browser demo (demo.ts). Both implement the same Backend contract
 * (types.ts), so no screen knows or cares which one it is using.
 */

import { createDemoBackend } from './demo';
import { createSupabaseBackend } from './supabase';
import type { Backend } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase when both env vars are set, otherwise the in-browser demo. */
export const backend: Backend = url && key ? createSupabaseBackend(url, key) : createDemoBackend();

export * from './types';
