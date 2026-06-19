import { createClient } from "@supabase/supabase-js";

// Server-only client. Uses the service_role / secret key. NEVER import this
// into a Client Component — the key bypasses all row security. Local-only for
// now (no auth yet); Phase 5 adds Supabase Auth + RLS before any public deploy.
//
// The env check is deferred to call time (not module load) on purpose: Next's
// "Collecting page data" build step imports every route module, so a top-level
// throw here crashes the whole Vercel build before env vars are even read at
// runtime. Failing inside the function lets the build complete and surfaces a
// clear runtime error instead.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set them in .env.local locally, or in the Vercel project's Environment Variables for deploys)."
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
