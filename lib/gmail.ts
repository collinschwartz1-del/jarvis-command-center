// Server-only Gmail helper. Mints an access token from the stored refresh token
// and writes reply DRAFTS on a thread. Scope is gmail.compose — this NEVER sends.
// Ported from scripts/draft-replies.mjs so the dashboard approve action can stage
// a Gmail draft the moment Collin picks a reply variant in /replies.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function gmailToken(): Promise<string | null> {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token as string;
}

export interface DraftTarget {
  thread_id: string;
  to_email: string;
  subject: string;
  // RFC headers so the draft threads correctly in Gmail
  in_reply_to?: string | null; // original Message-ID
  references?: string | null;
}

// Create a Gmail draft reply on the thread. Returns Gmail's draft id. Never sends.
export async function writeGmailDraft(
  token: string,
  target: DraftTarget,
  body: string
): Promise<string> {
  const auth = { Authorization: `Bearer ${token}` };
  let subject = target.subject || "";
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
  const refs = [target.references, target.in_reply_to].filter(Boolean).join(" ");
  const mime = [
    `To: ${target.to_email}`,
    `Subject: ${subject}`,
    target.in_reply_to ? `In-Reply-To: ${target.in_reply_to}` : "",
    refs ? `References: ${refs}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\r\n");
  const raw = Buffer.from(mime).toString("base64url");
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { threadId: target.thread_id, raw } }),
    }
  );
  if (!res.ok) throw new Error(`gmail draft ${res.status}: ${await res.text()}`);
  return (await res.json()).id as string;
}
