import { createClient } from "@supabase/supabase-js";

// Server-only client. Uses the service_role / secret key. NEVER import this
// into a Client Component — the key bypasses all row security. Local-only for
// now (no auth yet); Phase 5 adds Supabase Auth + RLS before any public deploy.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
}

export function supabaseAdmin() {
  return createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
