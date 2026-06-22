// Jarvis inbox triage rules — the SINGLE source of truth for what Jarvis
// SUPPRESSES (never surfaces to Collin) and how it remembers what he's already
// cleared. Imported by BOTH scripts/intel.mjs (the cron, plain Node ESM) and the
// Next app (lib/queries, app/actions) — so it stays dependency-free plain JS with
// JSDoc types (tsconfig allowJs + bundler resolution type-checks it directly).
//
// IMPORTANT: muting here only changes what JARVIS shows. It NEVER touches Gmail —
// no labels, no archive, no delete. The mail stays in the real inbox untouched.

/**
 * Senders Jarvis should never surface. Match is case-insensitive against the
 * full email, its exact domain, OR any subdomain of a listed domain. Add a line
 * here to permanently silence a sender. (This is the list you edit by hand.)
 * @type {string[]}
 */
export const MUTED_SENDERS = [
  // --- infra / deploy / DNS (machine noise, never a human decision) ---
  "vercel.com",
  "cloudflare.com",
  "cloudflareclient.com",
  "github.com",
  // --- Google infra / account / security / billing notices ---
  "no-reply@accounts.google.com",
  "noreply-dmarc-support@google.com",
  "no-reply@google.com",
  "googlecloud@google.com",
  "cloudplatform-noreply@google.com",
  "payments-noreply@google.com",
  "google-noreply@google.com",
  // --- Collin's own automated reports (Jarvis / Sue self-sends) ---
  // Remove this line if you ever want self-notes to surface in the brief.
  "collinschwartz1@gmail.com",
];

/**
 * Keyword patterns for automated noise that slips past the sender list (status
 * pages, receipts, billing, CI). Case-insensitive substring match on
 * "from_name + subject". Keep these specific — a false mute hides real mail.
 * @type {string[]}
 */
export const MUTED_PATTERNS = [
  "deploy succeeded",
  "deployment ready",
  "your deployment",
  "build failed",
  "build succeeded",
  "ssl certificate",
  "certificate renew",
  "dns record",
  "usage report",
  "your receipt",
  "payment receipt",
  "invoice from vercel",
  "uptime monitor",
  "status update for",
  "automated report",
  "no-reply",
  "do not reply to this",
];

/**
 * Decide whether a raw message is machine noise Jarvis should suppress before it
 * ever reaches the summarizer (saves tokens and keeps the brief clean).
 * @param {{from_email?:string, from_name?:string, subject?:string}} msg
 * @returns {{muted:boolean, reason:string}}
 */
export function classifyNoise(msg) {
  const email = String(msg.from_email || "").toLowerCase().trim();
  const domain = email.includes("@") ? email.split("@")[1] : email;
  for (const raw of MUTED_SENDERS) {
    const s = raw.toLowerCase();
    if (s.includes("@")) {
      if (email === s) return { muted: true, reason: `sender:${raw}` };
    } else if (domain === s || domain.endsWith("." + s)) {
      return { muted: true, reason: `sender:${raw}` };
    }
  }
  const hay = `${msg.from_name || ""} ${msg.subject || ""}`.toLowerCase();
  for (const p of MUTED_PATTERNS) {
    if (hay.includes(p.toLowerCase())) return { muted: true, reason: `pattern:${p}` };
  }
  return { muted: false, reason: "" };
}

/**
 * Normalize an action item into a stable signature so the SAME item raised on a
 * later cron run can be recognized and suppressed once Collin has cleared it.
 * Lowercase, strip punctuation, collapse whitespace, cap length. This is the key
 * that ends the "Kathleen Miller" re-nag loop.
 * @param {string} text
 * @returns {string}
 */
export function actionSignature(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Wire / payment-instruction items collapse to ONE shared signature per person
 * ("wire"), so once Collin clears a wire flag for someone, ANY future wire
 * re-raise from that person is suppressed — not just the identical wording.
 * @param {string} text
 * @returns {boolean}
 */
export function isWireItem(text) {
  return /wire-verify|\bwire\b|payment instruction|bank detail|routing number|account number|\bach\b/i.test(
    String(text || "")
  );
}

/** The four triage buckets, in display priority order. */
export const INBOX_CATEGORIES = ["sign", "question", "awaiting", "fyi"];
