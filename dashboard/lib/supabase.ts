import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only: this must never be imported from a Client Component, and the
// key it reads (SUPABASE_SERVICE_ROLE_KEY) must never carry a NEXT_PUBLIC_
// prefix — that would bundle it into client-side JS. It bypasses RLS, which
// is required today because `articles` and `candidate_topics` both have RLS
// enabled with zero policies defined (see the root project's migrations
// 0001 and 0003) — the anon key cannot read either table right now.
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
