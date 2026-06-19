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
