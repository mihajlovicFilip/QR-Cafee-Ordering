// Runs before every unit test file: each test starts with empty browser storage, so the demo
// backend re-seeds itself and nothing leaks between tests, and rendered screens are unmounted.
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
