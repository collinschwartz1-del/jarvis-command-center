// Draft control plane — the SINGLE gate every reply-draft must pass through.
//
// Three jobs, all here so there is one source of truth (imported by
// scripts/draft-replies.mjs and re-usable by any other drafter):
//   1. RELEVANCE FILTER  — drop no-reply / transactional / auto-reply / e-sign /
//      calendar-bot senders BEFORE the model ever sees them. This is deterministic
//      and runs first: it kills the "drafted a reply to DocuSign / GitHub / a
//      bank no-reply" noise and saves tokens.
//   2. HARD-EXCLUDE NET  — a deterministic backstop for money/wire/signature so a
//      reply is NEVER drafted into those threads even if the model misjudges. The
//      model is the primary scoper (narrow-safe); this is the seatbelt.
//   3. DEDUP             — message-keyed, status-agnostic. A thread is suppressed
//      once we've drafted for its latest inbound message OR it already has an open
//      draft. Only a genuinely NEW inbound message re-opens a thread. This is the
//      fix for "a thread I already answered/dismissed comes back the next day."
//   4. FEEDBACK MEMORY   — load Collin's recent dismiss/edit/approve signals and
//      render them into a prompt block so the drafter learns what he rejects.
//
// Plain dependency-free ESM + JSDoc (same posture as inbox-rules.mjs) so both the
// cron (plain Node) and, if needed, the Next app can import it.

import { classifyNoise, isWireItem } from "./inbox-rules.mjs";

// ---------------------------------------------------------------------------
// 1. RELEVANCE FILTER — never draft a reply to a machine.
// ---------------------------------------------------------------------------

/**
 * Local-part patterns that mean "automated sender, do not reply". Matched
 * case-insensitively against the part before the @.
 * @type {RegExp}
 */
const ROBOT_LOCALPART =
  /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounce|bounces|auto(?:mated|confirm|responder)?|dse_|adobesign|echosign|qbo|billing|invoices?|receipts?|platformnotifications|alerts?|noreply.*|reply\+)/i;

/**
 * Whole domains (exact or any subdomain) that only ever send transactional mail.
 * @type {string[]}
 */
const ROBOT_DOMAINS = [
  "docusign.net",
  "docusign.com",
  "adobesign.com",
  "echosign.com",
  "hellosign.com",
  "dropboxsign.com",
  "safesendreturns.com",
  "intuit.com",
  "quickbooks.com",
  "billdu.com",
  "mail.billdu.com",
  "resimpli.com",
  "replicate.email",
  "registrar.vercel.com",
  "vercel.com",
  "github.com",
  "google.com",
  "googlemail.com",
  "calendar-server.bounces.google.com",
  "anbank.com",
];

/**
 * Subject signatures that mean the message is a notification/auto-reply/e-sign
 * ask — none of which is answered by typing a reply. Kept specific so a real
 * human's mail isn't dropped. Signature/e-sign asks are intentionally here: they
 * need Collin to GO SIGN, not to reply, and they're hard-excluded anyway.
 * @type {string[]}
 */
const NONREPLY_SUBJECTS = [
  "automatic reply",
  "auto-reply",
  "out of office",
  "undeliverable",
  "delivery status notification",
  "mail delivery failed",
  "please sign",
  "signature requested",
  "please review and e-sign",
  "please docusign",
  "reminder: please sign",
  "completed: ",
  "invitation from an unknown sender", // forwarded calendar invite — accept/decline in Calendar, not by email
  "accepted: ",
  "declined: ",
  "has been shut down",
  "run failed",
  "verify your domain",
  "low credit",
  "credit alert",
  "notification of electronic transaction",
  "outstanding task",
];

/**
 * Should we even consider drafting a reply to this sender? Runs the existing
 * inbox noise classifier first, then the reply-specific robot rules.
 * @param {{from_email?:string, from_name?:string, subject?:string}} msg
 * @returns {{replyable:boolean, reason:string}}
 */
export function isReplyableSender(msg) {
  // Reuse the inbox triage mute list (infra/Google/self-sends/receipts/CI).
  const noise = classifyNoise(msg);
  if (noise.muted) return { replyable: false, reason: `noise:${noise.reason}` };

  const email = String(msg.from_email || "").toLowerCase().trim();
  const local = email.includes("@") ? email.split("@")[0] : email;
  const domain = email.includes("@") ? email.split("@")[1] : "";

  if (ROBOT_LOCALPART.test(local))
    return { replyable: false, reason: `robot-localpart:${local}` };

  for (const d of ROBOT_DOMAINS) {
    if (domain === d || domain.endsWith("." + d))
      return { replyable: false, reason: `robot-domain:${d}` };
  }

  const subj = String(msg.subject || "").toLowerCase();
  for (const p of NONREPLY_SUBJECTS) {
    if (subj.includes(p)) return { replyable: false, reason: `nonreply-subject:${p}` };
  }

  return { replyable: true, reason: "" };
}

// ---------------------------------------------------------------------------
// 2. HARD-EXCLUDE NET — money/wire/signature must never get an auto-draft.
// ---------------------------------------------------------------------------

/** @type {RegExp} */
const SIGNATURE_RE =
  /\b(sign(ature)?|e-?sign|docusign|adobe ?sign|notariz|execute the|countersign)\b/i;

/**
 * Deterministic safety net: even if the model wants to draft, refuse on
 * money-movement / wire / signature threads. The narrow-safe prompt is the
 * primary scoper; this guarantees the floor.
 * @param {{subject?:string, body?:string, snippet?:string}} msg
 * @returns {{excluded:boolean, reason:string}}
 */
export function isHardExcluded(msg) {
  const text = `${msg.subject || ""}\n${msg.body || msg.snippet || ""}`;
  if (isWireItem(text)) return { excluded: true, reason: "WIRE/MONEY" };
  if (SIGNATURE_RE.test(text)) return { excluded: true, reason: "SIGNATURE" };
  return { excluded: false, reason: "" };
}

// ---------------------------------------------------------------------------
// 3. DEDUP — message-keyed, status-agnostic.
// ---------------------------------------------------------------------------

/** Terminal statuses: the thread was dealt with. We don't re-draft these. */
export const TERMINAL_STATUSES = [
  "approved",
  "responded",
  "dismissed",
  "delegated",
  "filtered",
  "excluded",
];

/** Open statuses: a draft is already waiting on Collin. Don't stack another. */
export const OPEN_STATUSES = ["pending", "held"];

/**
 * Load the dedup state from email_drafts in ONE query.
 *  - openThreads : thread_ids that already have a pending/held draft (don't stack)
 *  - handledMsgs : gmail_msg_ids we have ALREADY produced a row for (any status)
 * A candidate thread is skipped if its thread_id is open OR its latest inbound
 * gmail_msg_id is in handledMsgs. A new inbound message has a new id → not in the
 * set → it gets drafted. Fails open (empty sets) on error.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
export async function loadDedupState(db, sinceDays = 60) {
  const openThreads = new Set();
  const handledMsgs = new Set();
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  try {
    const { data, error } = await db
      .from("email_drafts")
      .select("gmail_thread_id, gmail_msg_id, status")
      .gte("created_at", since);
    if (error) {
      console.error("draft-control: dedup load failed (continuing open):", error.message);
      return { openThreads, handledMsgs };
    }
    for (const r of data || []) {
      if (r.gmail_msg_id) handledMsgs.add(r.gmail_msg_id);
      if (OPEN_STATUSES.includes(r.status) && r.gmail_thread_id)
        openThreads.add(r.gmail_thread_id);
    }
  } catch (e) {
    console.error("draft-control: dedup load threw (continuing open):", e?.message || e);
  }
  return { openThreads, handledMsgs };
}

/**
 * Should this candidate thread be skipped by dedup?
 * @param {{thread_id:string, msg_id:string}} t
 * @param {{openThreads:Set<string>, handledMsgs:Set<string>}} state
 * @returns {{skip:boolean, reason:string}}
 */
export function dedupSkip(t, state) {
  if (state.handledMsgs.has(t.msg_id))
    return { skip: true, reason: "already-drafted-this-message" };
  if (state.openThreads.has(t.thread_id))
    return { skip: true, reason: "thread-has-open-draft" };
  return { skip: false, reason: "" };
}

// ---------------------------------------------------------------------------
// 4. FEEDBACK MEMORY — the self-learning input.
// ---------------------------------------------------------------------------

/**
 * Pull Collin's recent verdicts and render a compact teaching block for the
 * drafter/Sue prompts. Dismissed drafts are negative examples; edits show the
 * correction (what he changed). Bounded so the prompt stays small.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {number} [limit]
 * @returns {Promise<string>}  empty string when there's nothing to learn yet
 */
export async function loadFeedbackMemory(db, limit = 40) {
  let rows = [];
  try {
    const { data, error } = await db
      .from("draft_feedback")
      .select("subject, person_email, draft_body, edited_body, signal, reason")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("draft-control: feedback load failed (continuing):", error.message);
      return "";
    }
    rows = data || [];
  } catch (e) {
    console.error("draft-control: feedback load threw (continuing):", e?.message || e);
    return "";
  }
  if (!rows.length) return "";

  const dismissed = rows.filter((r) => r.signal === "dismissed").slice(0, 15);
  const edits = rows.filter((r) => r.signal === "edited" && r.edited_body).slice(0, 10);
  const trim = (s, n = 240) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  const parts = [];
  if (dismissed.length) {
    parts.push(
      "Collin DISMISSED these drafts without sending — do NOT draft this kind again " +
        "(wrong sender to reply to, not worth a reply, or off-base):\n" +
        dismissed
          .map((r) => `- [${r.person_email || "?"}] "${trim(r.subject, 80)}" ${r.reason ? `(${trim(r.reason, 60)})` : ""}`)
          .join("\n")
    );
  }
  if (edits.length) {
    parts.push(
      "Collin KEPT but REWROTE these — match the style of his EDIT, not the draft:\n" +
        edits
          .map(
            (r) =>
              `- "${trim(r.subject, 60)}"\n    draft : ${trim(r.draft_body, 160)}\n    collin: ${trim(r.edited_body, 160)}`
          )
          .join("\n")
    );
  }
  if (!parts.length) return "";
  return (
    "\n\n--- LEARNED FROM COLLIN (recent verdicts — weight these heavily) ---\n" +
    parts.join("\n\n") +
    "\n--- end learned ---\n"
  );
}

/**
 * Record one verdict. Best-effort; never throws into the caller.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{draft_id?:string|null, thread_id?:string|null, person_email?:string|null,
 *          subject?:string|null, draft_body?:string|null, edited_body?:string|null,
 *          signal:'dismissed'|'edited'|'approved', reason?:string|null}} row
 */
export async function recordDraftFeedback(db, row) {
  try {
    const { error } = await db.from("draft_feedback").insert(row);
    if (error) console.error("draft-control: feedback insert failed:", error.message);
  } catch (e) {
    console.error("draft-control: feedback insert threw:", e?.message || e);
  }
}
