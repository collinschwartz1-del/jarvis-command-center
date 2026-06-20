// Pure role logic — no Supabase, no next/headers imports, so this is safe to
// import from edge middleware as well as server components/routes.
//
// Two roles:
//   owner  — full read/write (Collin). Can approve cards, route deals, etc.
//   viewer — read-only (Karen, EA). Sees everything, can mutate nothing.
//
// Env (comma-separated emails):
//   OWNER_EMAILS   — defaults to Collin's two addresses. Falls back to the
//                    legacy ALLOWED_EMAILS so existing deploys keep working
//                    (everyone previously allowed stays an owner).
//   VIEWER_EMAILS  — defaults to Karen.

export type Role = "owner" | "viewer";

function parse(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function ownerEmails(): string[] {
  return parse(
    process.env.OWNER_EMAILS ??
      process.env.ALLOWED_EMAILS ??
      "collinschwartz1@gmail.com,collin@leavenwealth.com"
  );
}

export function viewerEmails(): string[] {
  return parse(process.env.VIEWER_EMAILS ?? "karen@leavenwealth.com");
}

// Anyone who can reach the command center at all (owners ∪ viewers).
export function allowedEmails(): string[] {
  return [...ownerEmails(), ...viewerEmails()];
}

export function roleOf(email?: string | null): Role | null {
  if (!email) return null;
  const e = email.toLowerCase();
  if (ownerEmails().includes(e)) return "owner";
  if (viewerEmails().includes(e)) return "viewer";
  return null;
}

export function isAllowed(email?: string | null): boolean {
  return roleOf(email) !== null;
}

export function isOwner(email?: string | null): boolean {
  return roleOf(email) === "owner";
}

// Local-dev bypass. When Jarvis runs via `npm run dev` on Collin's own Mac, skip
// the Supabase magic-link dance and treat the session as the owner — the Texts
// tab + local vault are single-user and never deployed.
//
// TRIPLE-GUARDED so it can NEVER activate on any deployed/production instance:
//   1. NODE_ENV must be exactly "development"  (next dev only; next start = production)
//   2. process.env.VERCEL must be unset        (any Vercel deploy sets this)
//   3. JARVIS_LOCAL_BYPASS must equal "1"       (explicit opt-in; only in local .env.local,
//                                                which is gitignored and never shipped)
// All three must hold. A stray `next start`, preview deploy, or self-hosted replica
// missing the flag falls straight through to real Supabase auth.
export function devOwnerEmail(): string | null {
  if (
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL &&
    process.env.JARVIS_LOCAL_BYPASS === "1"
  ) {
    return ownerEmails()[0] ?? "collinschwartz1@gmail.com";
  }
  return null;
}
