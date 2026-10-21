/**
 * Unit test setup — runs before every unit test file.
 *
 * Each test starts with empty browser storage, so the demo backend seeds itself afresh and nothing
 * leaks between tests; rendered screens are unmounted after each test.
 */

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
