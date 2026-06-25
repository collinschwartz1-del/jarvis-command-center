// Pure role logic — no Supabase, no next/headers imports, so this is safe to
// import from edge middleware as well as server components/routes.
//
// Three roles:
//   owner  — full read/write (Collin). Can approve cards, route deals, etc.
//   viewer — read-only (Karen, EA). Sees everything, can mutate nothing.
//   caller — SCOPED to /sourcing only (the dialing VA). Can work the call queue
//            and log dispositions, but cannot see/reach any other tab or data.
//
// Env (comma-separated emails) can ADD people, but the hard roster below is the
// source of truth so access is correct regardless of what a given deploy has set:
//   OWNER_EMAILS   — defaults to Collin's two addresses. Falls back to the
//                    legacy ALLOWED_EMAILS so existing deploys keep working.
//   CALLER_EMAILS  — added to CALLER_ROSTER (Tyler + Karen — Deals-tab-only).
//   VIEWER_EMAILS  — read-only-everywhere. No default; anyone who is an owner or
//                    caller is stripped out so a caller can never leak past Deals.

export type Role = "owner" | "viewer" | "caller";

// Hard roster of full-access owners (Collin + co-owners). Always owners regardless
// of deploy env, mirroring the viewer/caller rosters. Tyler is an Acreage Brothers
// co-owner Collin promoted to full owner access 2026-06-25 (was viewer).
const OWNER_ROSTER = [
  "collinschwartz1@gmail.com",
  "collin@leavenwealth.com",
  "tyler.trelles@bhhsamb.com",
];

// Hard roster of Deals-only users (the dialing desk). Confined to /sourcing — they
// cannot see Core, Inbox, LLS, PGO, or any other tab.
const CALLER_ROSTER = ["karen@leavenwealth.com"];

// Hard roster of read-only viewers (EA / co-owners who should see-but-not-touch).
// Empty for now — Tyler was promoted to OWNER_ROSTER above. Owner/caller rosters
// win over a stale env entry, so promotion is a code-only change — no deploy-env edit.
const VIEWER_ROSTER: string[] = [];

// Paths a `caller` may reach. Everything else redirects to /sourcing.
const CALLER_PATHS = ["/sourcing", "/auth", "/login"];

function parse(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function ownerEmails(): string[] {
  // Hard roster is the source of truth; env additions (OWNER_EMAILS, legacy
  // ALLOWED_EMAILS) are unioned in so existing deploys keep working.
  return [
    ...new Set([
      ...OWNER_ROSTER,
      ...parse(process.env.OWNER_EMAILS ?? process.env.ALLOWED_EMAILS),
    ]),
  ];
}

// Read-only-everywhere viewers: hard roster + env additions, minus owners (owner wins).
export function viewerEmails(): string[] {
  const owners = new Set(ownerEmails());
  return [...new Set([...VIEWER_ROSTER, ...parse(process.env.VIEWER_EMAILS)])].filter(
    (e) => !owners.has(e)
  );
}

// Deals-only callers: hard roster + env additions, minus owners and viewers. The
// viewer/owner rosters WIN, so a stale CALLER_EMAILS entry (e.g. a former caller
// since promoted to viewer, like Tyler) can't drag someone back into the Deals
// confine — promotion is a code-only change, no deploy-env edit needed.
export function callerEmails(): string[] {
  const owners = new Set(ownerEmails());
  const viewers = new Set([...VIEWER_ROSTER, ...parse(process.env.VIEWER_EMAILS)]);
  return [...new Set([...CALLER_ROSTER, ...parse(process.env.CALLER_EMAILS)])].filter(
    (e) => !owners.has(e) && !viewers.has(e)
  );
}

// Anyone who can reach the command center at all (owners ∪ viewers ∪ callers).
export function allowedEmails(): string[] {
  return [...ownerEmails(), ...viewerEmails(), ...callerEmails()];
}

export function roleOf(email?: string | null): Role | null {
  if (!email) return null;
  const e = email.toLowerCase();
  if (ownerEmails().includes(e)) return "owner";
  if (viewerEmails().includes(e)) return "viewer";
  if (callerEmails().includes(e)) return "caller";
  return null;
}

export function isAllowed(email?: string | null): boolean {
  return roleOf(email) !== null;
}

export function isOwner(email?: string | null): boolean {
  return roleOf(email) === "owner";
}

export function isCaller(email?: string | null): boolean {
  return roleOf(email) === "caller";
}

// Where a role lands by default (callers never see the Core dashboard).
export function homePathFor(role: Role | null): string {
  return role === "caller" ? "/sourcing" : "/";
}

// Route-level gate. Owners/viewers may reach anything; callers are confined to
// CALLER_PATHS. Pure string logic so middleware (edge) can call it.
export function canAccessPath(role: Role | null, path: string): boolean {
  if (role === "caller") {
    return CALLER_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  }
  return role === "owner" || role === "viewer";
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
