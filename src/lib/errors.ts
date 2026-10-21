/** Errors as people read them. */

import { ApiError } from '../api/types';

/** A translated, human message for any thrown value. */
export function describeError(t: (key: string) => string, e: unknown): string {
  const key = e instanceof ApiError ? `errors.${e.code}` : e instanceof TypeError ? 'errors.network' : 'errors.generic';
  const text = t(key);
  return text === key ? t('errors.generic') : text;
}
