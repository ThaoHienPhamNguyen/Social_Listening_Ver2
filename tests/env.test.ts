import { describe, it, expect } from 'vitest';
import { getRequiredEnv } from '../src/lib/env';

describe('getRequiredEnv', () => {
  it('returns the value when the env var is set', () => {
    process.env.TEST_VAR = 'hello';
    expect(getRequiredEnv('TEST_VAR')).toBe('hello');
    delete process.env.TEST_VAR;
  });

  it('throws a clear error when the env var is missing', () => {
    delete process.env.MISSING_VAR;
    expect(() => getRequiredEnv('MISSING_VAR')).toThrow('Missing required environment variable: MISSING_VAR');
  });
});
