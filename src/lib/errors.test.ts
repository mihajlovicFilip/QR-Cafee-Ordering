import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/types';
import { toApiError } from '../api/supabase';
import { describeError } from './errors';

const t = (key: string) => ({ 'errors.too_fast': 'Sačekajte', 'errors.network': 'Nema veze', 'errors.generic': 'Greška' } as Record<string, string>)[key] ?? key;

describe('what the user is told when something fails', () => {
  it('translates known codes, falls back to a generic message for unknown ones', () => {
    expect(describeError(t, new ApiError('too_fast'))).toBe('Sačekajte');
    expect(describeError(t, new ApiError('something_new'))).toBe('Greška');
    expect(describeError(t, new Error('boom'))).toBe('Greška');
  });

  it('treats a failed fetch as a network problem', () => {
    expect(describeError(t, new TypeError('Failed to fetch'))).toBe('Nema veze');
  });
});

describe('Supabase errors → app error codes', () => {
  it.each([
    ['too_fast', 'too_fast'],
    ['invalid_floor', 'invalid_floor'],
    ['permission denied for function accept_order', 'not_authenticated'],
    ['JWT expired', 'not_authenticated'],
    ['Invalid login credentials', 'invalid_login'],
    ['Anonymous sign-ins are disabled', 'anonymous_disabled'],
    ['TypeError: Failed to fetch', 'network'],
    ['duplicate key value violates unique constraint', 'generic'],
  ])('%s → %s', (message, code) => {
    expect(toApiError({ message }).code).toBe(code);
  });

  it('copes with no error object at all', () => {
    expect(toApiError(null).code).toBe('generic');
  });
});
