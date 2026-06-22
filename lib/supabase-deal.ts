import { createClient } from "@supabase/supabase-js";

// Read-only client for the Omaha Deal Engine SPINE — a SEPARATE Supabase
// project (deal-command-center / nhsmylrypwmhhjfbddox) from the Jarvis command
// center DB. The cockpit (/sourcing) reads the spine's v_daily_brief and
// v_call_queue cross-project. Server-only; never import into a Client Component.
//
// Set DCC_SUPABASE_URL + DCC_SUPABASE_KEY in .env.local (and Vercel env for
// deploys). Env is checked at call time, not module load, so the build doesn't
// crash when the vars are absent (mirrors supabase.ts).

export function dealConfigured(): boolean {
  return !!(process.env.DCC_SUPABASE_URL && process.env.DCC_SUPABASE_KEY);
}

export function supabaseDeal() {
  const url = process.env.DCC_SUPABASE_URL;
  const key = process.env.DCC_SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing DCC_SUPABASE_URL or DCC_SUPABASE_KEY (deal-engine spine creds). Set them in .env.local locally or in Vercel env for deploys."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
