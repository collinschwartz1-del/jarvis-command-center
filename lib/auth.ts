import { supabaseServer } from "./supabase-server";
import { isAllowed, isOwner, roleOf, type Role } from "./roles";

// Re-export the pure role helpers so existing imports of "@/lib/auth" keep
// working. The email/role source of truth lives in ./roles (edge-safe).
export { allowedEmails, isAllowed, isOwner, roleOf } from "./roles";
export type { Role } from "./roles";

// Returns the authed+allowlisted user, or null. Use to gate route handlers.
export async function requireUser() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user && isAllowed(user.email) ? user : null;
}

// The current session's role (owner | viewer | null). Read this in server
// components to decide whether to render write controls.
export async function currentRole(): Promise<Role | null> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return roleOf(user?.email);
}

// Throws for anyone who is not an owner. Drop at the top of every mutating
// server action / write route — this is the real read-only enforcement;
// hiding UI buttons is only cosmetic.
export async function requireOwner() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!isOwner(user?.email)) {
    throw new Error("Forbidden: this account has read-only access.");
  }
  return user!;
}
