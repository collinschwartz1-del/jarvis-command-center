import { supabaseServer } from "./supabase-server";

// The allowlist — only these emails can reach the command center, even if
// someone else finds the URL and requests a magic link. Override via the
// ALLOWED_EMAILS env var (comma-separated).
export function allowedEmails(): string[] {
  return (
    process.env.ALLOWED_EMAILS ??
    "collinschwartz1@gmail.com,collin@leavenwealth.com"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email?: string | null): boolean {
  return !!email && allowedEmails().includes(email.toLowerCase());
}

// Returns the authed+allowlisted user, or null. Use to gate route handlers.
export async function requireUser() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user && isAllowed(user.email) ? user : null;
}
