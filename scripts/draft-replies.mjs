// Jarvis — email reply pipeline (draft → Sue review → Collin approves in /replies).
//
// Reads the last 48h of Gmail (same credentialed pull as intel.mjs), then for
// each inbound thread that needs a reply:
//   1. GATE      — drafter classifies routine | excluded | no-reply-needed.
//                  "narrow first": only low-risk routine replies are drafted.
//                  Hard-excluded: investor/LP, borrower/loan-status (Lendr/LLS),
//                  pricing/offers, partner-sensitive (Tyler/Vince), money/wires,
//                  anything needing a signature, sensitive named-person threads.
//   2. DRAFT     — writes the reply in Collin's voice (short paras, no bullets,
//                  one bold line max, "— Collin"). For DECISION threads (yes/no,
//                  this-or-that), it writes 2-3 LABELED variants — one per path —
//                  so Collin just picks the answer. Simple threads get one.
//   3. SUE REVIEW— a separate pass carrying Collin's Approval Rules + voice lens,
//                  judging EACH variant: approve | hold (+reason). Sue owns this.
//   4. STAGE     — rows with >=1 Sue-approved variant are saved status 'pending'
//                  for the Jarvis /replies tab. Collin picks a variant there and
//                  the dashboard stages the Gmail draft. This script never writes
//                  to Gmail and nothing auto-sends.
//
// Every candidate is logged to email_drafts (variants + verdicts + status) as an
// audit trail. Status: pending | held | excluded.
//
// Run:  node scripts/draft-replies.mjs   (stages pending replies for the dashboard)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// --- env (same loader as intel.mjs / sync.mjs) ---
function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.DRAFT_MODEL || process.env.INTEL_MODEL || "claude-sonnet-4-6";
if (!SUPA_URL || !SUPA_KEY || !ANTHROPIC_KEY) {
  console.error("draft-replies: missing SUPABASE or ANTHROPIC creds — aborting.");
  process.exit(1);
}
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

const SINCE_HOURS = 48;

// ---------- Gmail (REST + fetch; token carries readonly + compose) ----------
async function gmailToken() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

function header(payload, name) {
  const h = (payload?.headers || []).find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}
function decodeBody(payload) {
  function walk(p) {
    if (!p) return "";
    if (p.mimeType === "text/plain" && p.body?.data)
      return Buffer.from(p.body.data, "base64").toString("utf8");
    for (const part of p.parts || []) {
      const t = walk(part);
      if (t) return t;
    }
    return "";
  }
  return walk(payload).slice(0, 4000);
}

// Pull last 48h INBOX messages (skip our own SENT, promo, social). Keep the
// latest inbound message per thread — that's what we'd be replying to.
async function fetchInboundThreads(token) {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
      `newer_than:2d in:inbox -category:promotions -category:social`
    )}&maxResults=80`,
    { headers: auth }
  ).then((r) => r.json());

  const byThread = new Map();
  for (const { id } of list.messages || []) {
    const m = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: auth }
    ).then((r) => r.json());
    if ((m.labelIds || []).includes("SENT")) continue; // our own message
    const from = header(m.payload, "From");
    const email = (from.match(/<(.+?)>/)?.[1] || from).trim().toLowerCase();
    const name = from.replace(/<.+?>/, "").replace(/"/g, "").trim() || email;
    const internalDate = Number(m.internalDate || 0);
    const prev = byThread.get(m.threadId);
    if (prev && prev.internalDate >= internalDate) continue;
    byThread.set(m.threadId, {
      thread_id: m.threadId,
      msg_id: m.id,
      internalDate,
      from_name: name,
      from_email: email,
      subject: header(m.payload, "Subject"),
      msg_message_id: header(m.payload, "Message-ID"),
      references: header(m.payload, "References"),
      body: decodeBody(m.payload),
      snippet: m.snippet || "",
    });
  }
  const threads = [...byThread.values()];
  console.log(`draft-replies: ${threads.length} inbound threads in last ${SINCE_HOURS}h.`);
  return threads;
}

// ---------- Pass 1: drafter (scope gate + reply in Collin's voice) ----------
const DRAFTER_SYS = `You are Collin Schwartz's email assistant. You draft replies in HIS voice and you classify what is safe to draft.

VOICE (this is email, mid-formality): Direct, anti-corporate, no fluff. Short paragraphs (1-3 sentences). NO bullet points — use paragraph breaks. Bold at most ONE key line. Sign off "— Collin". Contractions are fine. No corporate buzzwords (no "synergy", "optimize", "leverage" as a verb, "circle back", "touch base"), no marketing/urgency language, no "I hope this helps", no exclamation points (one max, ever). Operator-to-operator, never salesman. State things as fact, not "I think". If you don't have a fact, do NOT invent it — leave a clearly-marked placeholder like [confirm date] instead.

SCOPE — draft a reply for EVERY thread that needs one. Collin wants a prepopulated reply ready for every email, not just easy ones. The only threads you skip are ones that genuinely need NO reply (newsletter, receipt, FYI, auto-notification, thank-you with nothing owed) → category:"no-reply-needed". Everything else → category:"reply".

REPLY SHAPE — decide reply_kind for each "reply" thread:
- "single": there is one natural reply. Produce ONE variant labeled "Reply".
- "decision": the sender is asking a yes/no, an either/or, or to pick between options, and Collin could reasonably go more than one way. Produce 2-3 variants, ONE per path, each a COMPLETE standalone reply. Label each by the path it takes, e.g. "Yes — confirm", "No — decline", "Propose Thursday instead", "Option A", "Option B". Do NOT make the variants trivial rewordings of each other — they must represent genuinely different answers. Never invent which way Collin leans; just have each answer ready.

SENSITIVITY — set "sensitivity":"sensitive" (else "normal") and a short "sensitive_reason" when the thread touches any of:
- Investor/LP communications or capital (LeavenWealth, Liquid Lending fund investors)
- Borrower-facing or loan-status content (Lendr / LLS loans)
- Pricing, offers, or terms (Titan $9,997, lending terms, deal splits)
- Partner-sensitive matters (Tyler/Acreage, Vince/Titan)
- Money movement, wires, payment instructions, or bank-detail changes (sensitive_reason MUST start with "WIRE/MONEY:")
- Anything needing a signature, or that would commit Collin to a number/price/legal term
- High-stakes named-person threads where a wrong word matters

You STILL draft sensitive threads — but the draft must be SAFE: never confirm wire/bank details or payment instructions, never commit to a specific number/price/legal term, never invent facts. When the safe move is to slow down, draft exactly that (e.g. "Let's get on a quick call to nail down the details.", "Send that over and I'll review.", "Want to make sure we're aligned before I commit — let's talk Thursday."). Leave anything uncertain as a clear placeholder like [confirm amount]. For WIRE/MONEY especially: the reply must NOT confirm or repeat any account/routing/payment detail — steer to an out-of-band verbal confirmation.

Output STRICT JSON only.`;

function drafterPrompt(threads) {
  const compact = threads.map((t, i) => ({
    i,
    from_name: t.from_name,
    from_email: t.from_email,
    subject: t.subject,
    text: (t.body || t.snippet || "").slice(0, 2000),
  }));
  return `Inbound threads (last ${SINCE_HOURS}h):\n${JSON.stringify(compact)}\n\n` +
`For each thread, return STRICT JSON:
{
 "items":[{
   "i":int,
   "category":"reply|no-reply-needed",
   "sensitivity":"normal|sensitive",            // "normal" when category=="no-reply-needed"
   "sensitive_reason":string|null,              // short why, when sensitive
   "reply_kind":"single|decision|null",         // null unless category=="reply"
   "variants":[                                  // 1 for single, 2-3 for decision; [] unless reply
     {"label":string, "body":string}            // body = full reply in Collin's voice (SAFE if sensitive)
   ]
 }]
}
No prose outside the JSON.`;
}

// ---------- Pass 2: Sue review (Approval Rules + voice lens) ----------
const SUE_SYS = `You are Sue, Collin's orchestrator and sign-off gate. You REVIEW prepopulated email reply OPTIONS before they reach Collin's dashboard. Some threads carry several variants (one per answer Collin could give) — judge EACH variant on its own. You do not write them — you judge them. Be strict; when unsure, HOLD that variant.

Every reply-needed thread gets a draft now, including sensitive ones (investor/LP, loan, pricing, partner, money/wire, signature). You do NOT hold a variant just because the thread is sensitive — you hold it only if the DRAFT ITSELF is unsafe or off-voice. Judge the words on the page.

Approve a variant only if ALL are true:
- It does NOT confirm/commit anything it shouldn't: no wire/bank/payment details repeated or confirmed, no specific number/price/legal term committed, no signature implied, no investor/loan facts asserted. On sensitive threads the safe reply slows things down (get on a call, "send it over and I'll review", verify out-of-band) — that is exactly what to APPROVE.
- It sounds like Collin: direct, no corporate jargon, no marketing language, short paragraphs, no bullet lists, signs "— Collin". No exclamation-point spam.
- It contains no fabricated facts, dates, figures, or commitments. Unknowns are left as clear placeholders, not guessed.

If a variant commits to money/price/legal terms, confirms wire/payment details, invents facts, or is off-voice → verdict:"hold" with a one-line note on what Collin should decide or fix. Otherwise verdict:"approve". For WIRE/MONEY threads, hold ANY variant that repeats or confirms a payment/account detail.

Output STRICT JSON only.`;

function suePrompt(reviewItems) {
  return `Reply options to review (each thread i has one or more variants v):\n${JSON.stringify(reviewItems)}\n\n` +
`Return STRICT JSON — one verdict per (thread i, variant v):
{ "verdicts":[{"i":int,"v":int,"verdict":"approve|hold","note":string}] }
No prose outside the JSON.`;
}

function parseJson(text, label) {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(json); }
  catch {
    console.error(`draft-replies: could not parse ${label} JSON — head:`, text.slice(0, 300));
    return null;
  }
}

async function callClaude(system, user) {
  const resp = await claude.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
  });
  return resp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

async function logRow(row) {
  const { error } = await db.from("email_drafts").insert(row);
  if (error) console.error("draft-replies: log error", row.gmail_thread_id, error.message);
}

// ---------- main ----------
async function main() {
  const token = await gmailToken();
  if (!token) {
    console.log("draft-replies: Gmail creds absent — nothing to do.");
    return;
  }
  const threads = await fetchInboundThreads(token);
  if (!threads.length) { console.log("draft-replies: no inbound threads."); return; }

  // Pass 1 — drafter (drafts a reply for EVERY reply-needed thread; flags sensitive)
  const d = parseJson(await callClaude(DRAFTER_SYS, drafterPrompt(threads)), "drafter");
  if (!d?.items) { console.log("draft-replies: drafter returned nothing usable."); return; }
  // Normalize: each reply item carries variants[]; tolerate a legacy draft_body.
  for (const it of d.items) {
    if (it.category !== "reply") { it.variants = []; continue; }
    if (!Array.isArray(it.variants) || !it.variants.length) {
      it.variants = it.draft_body ? [{ label: "Reply", body: it.draft_body }] : [];
    }
    it.variants = it.variants.filter((v) => v && v.body && v.body.trim()).slice(0, 3);
    it.reply_kind = it.variants.length > 1 ? "decision" : "single";
    it.sensitivity = it.sensitivity === "sensitive" ? "sensitive" : "normal";
  }
  const byIndex = new Map(d.items.map((it) => [it.i, it]));

  // Pass 2 — Sue reviews EVERY variant of every reply-needed thread (verdict per variant)
  const routine = threads
    .map((t, i) => ({ t, i, it: byIndex.get(i) }))
    .filter((x) => x.it?.category === "reply" && x.it.variants.length);
  let verdicts = new Map(); // key `${i}:${v}` -> {verdict, note}
  if (routine.length) {
    const reviewItems = routine.map((x) => ({
      i: x.i,
      from: x.t.from_email,
      subject: x.t.subject,
      sensitivity: x.it.sensitivity,
      sensitive_reason: x.it.sensitive_reason || null,
      original: (x.t.body || x.t.snippet || "").slice(0, 1200),
      variants: x.it.variants.map((v, vi) => ({ v: vi, label: v.label, draft: v.body })),
    }));
    const s = parseJson(await callClaude(SUE_SYS, suePrompt(reviewItems)), "sue");
    verdicts = new Map((s?.verdicts || []).map((x) => [`${x.i}:${x.v}`, x]));
  }

  let staged = 0, optionsApproved = 0, held = 0, noReply = 0, sensitive = 0;
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    const it = byIndex.get(i);
    if (!it || it.category === "no-reply-needed") { noReply++; continue; }
    if (!it.variants.length) { noReply++; continue; } // drafter flagged reply but produced nothing usable

    // attach Sue's per-variant verdict
    const reviewed = it.variants.map((v, vi) => {
      const verdict = verdicts.get(`${i}:${vi}`);
      const ok = verdict?.verdict === "approve";
      if (ok) optionsApproved++;
      return {
        label: v.label,
        body: v.body,
        verdict: ok ? "approve" : "hold",
        note: verdict?.note || (ok ? null : "held by Sue review"),
      };
    });
    const anyApproved = reviewed.some((v) => v.verdict === "approve");
    const status = anyApproved ? "pending" : "held";
    if (anyApproved) staged++; else held++;
    if (it.sensitivity === "sensitive") sensitive++;

    // Pick a sensible legacy draft_body (first approved, else first) for back-compat.
    const lead = reviewed.find((v) => v.verdict === "approve") || reviewed[0];

    await logRow({
      gmail_thread_id: t.thread_id, gmail_msg_id: t.msg_id,
      person_name: t.from_name, person_email: t.from_email, subject: t.subject,
      original_snippet: (t.body || t.snippet || "").slice(0, 1500),
      reply_to_message_id: t.msg_message_id || null,
      reply_references: t.references || null,
      category: "reply", reply_kind: it.reply_kind,
      sensitivity: it.sensitivity,
      excluded_reason: it.sensitivity === "sensitive" ? (it.sensitive_reason || "sensitive — review carefully") : null,
      variants: reviewed, draft_body: lead?.body || null,
      sue_verdict: anyApproved ? "approve" : "hold",
      sue_note: anyApproved ? null : (reviewed[0]?.note || "all variants held"),
      status,
    });
  }

  console.log(
    `draft-replies: ${staged} thread(s) staged for /replies ` +
    `(${optionsApproved} reply option(s) Sue-approved, ${sensitive} flagged sensitive), ` +
    `${held} held, ${noReply} no-reply-needed.`
  );
}

main().catch((e) => {
  console.error("draft-replies: fatal", e);
  process.exit(1);
});
