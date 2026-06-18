// Thin Lendr REST client (server-only). Used by app/lending/actions.ts to post
// loan comments. The sync script (scripts/lls-sync.mjs) inlines the same calls
// in plain JS — keep the two in step if Lendr's API shape changes.
//
// Env:
//   LENDR_API_BASE  e.g. https://api.lendr.com/v1   (no trailing slash)
//   LENDR_API_KEY   team API key (Bearer)
//
// Endpoints: /loans (with ?filter=...), /loans/:id/comments

const BASE = process.env.LENDR_API_BASE;
const KEY = process.env.LENDR_API_KEY;

function ensure(): { base: string; key: string } {
  if (!BASE || !KEY) {
    throw new Error("Lendr API not configured (LENDR_API_BASE / LENDR_API_KEY).");
  }
  return { base: BASE.replace(/\/$/, ""), key: KEY };
}

async function call<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { base, key } = ensure();
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Lendr ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function listLoans<T = unknown>(filter?: string): Promise<T> {
  const q = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  return call<T>(`/loans${q}`);
}

export function listLoanComments<T = unknown>(loanId: string): Promise<T> {
  return call<T>(`/loans/${encodeURIComponent(loanId)}/comments`);
}

export function createLoanComment(
  loanId: string,
  body: string
): Promise<{ id?: string | number }> {
  // Lendr's comment field is `comment` (per the API schema), not `body`.
  return call(`/loans/${encodeURIComponent(loanId)}/comments`, {
    method: "POST",
    json: { comment: body },
  });
}
