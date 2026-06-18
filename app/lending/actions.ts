"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { createLoanComment } from "@/lib/lendr";

// Reply flow for the LLS Borrower Inbox. We DRAFT the email reply on its Gmail
// thread (Collin reviews + sends from Gmail — honors the check-before-send rule)
// and, when asked, mirror the same text into the loan's Lendr comments so the
// team sees the response. No auto-send anywhere.

type ReplyResult = { ok: boolean; draft: boolean; comment: boolean; error?: string };

async function gmailToken(): Promise<string | null> {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}`);
  return (await r.json()).access_token;
}

function gmailHeader(payload: any, name: string): string {
  const h = (payload?.headers || []).find(
    (x: any) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}

// Build an RFC-822 reply and save it as a draft attached to the thread.
async function draftGmailReply(
  messageId: string,
  threadId: string,
  body: string
): Promise<void> {
  const token = await gmailToken();
  if (!token) throw new Error("Gmail not configured (need compose scope).");
  const auth = { Authorization: `Bearer ${token}` };

  // read the original to thread the reply correctly
  const orig = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=References`,
    { headers: auth }
  ).then((r) => r.json());

  const origMsgId = gmailHeader(orig.payload, "Message-ID");
  const from = gmailHeader(orig.payload, "From");
  const to = (from.match(/<(.+?)>/)?.[1] || from).trim();
  let subject = gmailHeader(orig.payload, "Subject") || "";
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
  const refs = [gmailHeader(orig.payload, "References"), origMsgId]
    .filter(Boolean)
    .join(" ");

  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    origMsgId ? `In-Reply-To: ${origMsgId}` : "",
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
      body: JSON.stringify({ message: { threadId, raw } }),
    }
  );
  if (!res.ok) throw new Error(`gmail draft ${res.status}: ${await res.text()}`);
}

export async function replyToLlsEmail(
  messageId: string,
  body: string,
  alsoComment: boolean
): Promise<ReplyResult> {
  const text = body.trim();
  if (!text) return { ok: false, draft: false, comment: false, error: "Empty reply." };

  const db = supabaseAdmin();
  const { data: item } = await db
    .from("lls_inbox")
    .select("gmail_thread_id, matched_loan_id, subject, from_email")
    .eq("gmail_message_id", messageId)
    .maybeSingle();
  if (!item) return { ok: false, draft: false, comment: false, error: "Email not found." };

  let draft = false;
  let comment = false;
  try {
    await draftGmailReply(messageId, item.gmail_thread_id, text);
    draft = true;
  } catch (e: any) {
    return { ok: false, draft: false, comment: false, error: e.message };
  }

  if (alsoComment && item.matched_loan_id) {
    try {
      await createLoanComment(item.matched_loan_id, `Collin (via Jarvis): ${text}`);
      comment = true;
    } catch (e: any) {
      // draft already saved — report the partial failure but don't lose it
      await db.from("activity").insert({
        actor: "collin",
        kind: "lls_reply_comment_failed",
        ref_table: "lls_inbox",
        ref_id: messageId,
        summary: `Draft saved, Lendr comment failed: ${e.message}`,
      });
    }
  }

  await db.from("lls_inbox").update({ handled: true }).eq("gmail_message_id", messageId);
  await db.from("activity").insert({
    actor: "collin",
    kind: "lls_reply_drafted",
    ref_table: "lls_inbox",
    ref_id: messageId,
    summary: `Drafted reply to ${item.from_email}${comment ? " + Lendr comment" : ""}`,
  });
  revalidatePath("/lending");
  return { ok: true, draft, comment };
}

export async function markHandled(messageId: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("lls_inbox").update({ handled: true }).eq("gmail_message_id", messageId);
  revalidatePath("/lending");
}
