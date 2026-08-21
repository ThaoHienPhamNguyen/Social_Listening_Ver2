import { describe, it, expect, afterEach } from 'vitest';
import { createServerSupabaseClient } from '../lib/supabase';

describe('createServerSupabaseClient', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('throws when SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    expect(() => createServerSupabaseClient()).toThrow(/SUPABASE_URL/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createServerSupabaseClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns a Supabase client when both env vars are present', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const client = createServerSupabaseClient();
    expect(client.from).toBeTypeOf('function');
  });
});
