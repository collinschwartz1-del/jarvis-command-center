// Jarvis — email reply pipeline (draft → Sue review → Collin approves in /replies).
//
// THE SINGLE inbound-reply drafter. (Karen's cloud routine no longer drafts
// individual replies — it does triage digests + proactive nudges only — so there
// is exactly one system staging reply drafts and one place that learns.)
//
// Flow per run (reads the last 48h of Gmail inbox, latest inbound msg per thread):
//   0. FILTER     — drop no-reply/transactional/auto-reply/e-sign/calendar-bot
//                   senders deterministically (lib/draft-control). The model never
//                   sees a robot. (kills "drafted a reply to DocuSign/GitHub".)
//   0b. DEDUP     — skip a thread if we've already drafted for its latest inbound
//                   message OR it has an open draft. Only a NEW inbound message
//                   re-opens a thread. (kills "answered thread comes back tomorrow".)
//   0c. HARD NET  — refuse money/wire/signature threads deterministically; logged
//                   as 'excluded', never drafted. (safety floor under the model.)
//   1. DRAFT      — narrow-safe scope: draft LOW-RISK ROUTINE replies in Collin's
//                   voice. Investor/LP, loan/borrower status, pricing/terms,
//                   partner-sensitive, legal, or anything that commits a number →
//                   category "needs-collin": NOT drafted, surfaced for him.
//                   Decision threads get 2-3 labeled variants.
//   2. SUE REVIEW — judges each variant: approve | hold (+reason). Sue owns this.
//   3. STAGE      — rows with >=1 approved variant → status 'pending' for /replies.
//                   Collin picks a variant; the dashboard stages the Gmail draft.
//                   This script NEVER writes to Gmail and nothing auto-sends.
//
// SELF-LEARNING: each run loads Collin's recent verdicts (dismiss/edit/approve
// from draft_feedback) and feeds them to the drafter + Sue as "here's what he
// rejected / how he rewrites" — so the pipeline adapts to him over time.
//
// Every processed message gets exactly ONE ledger row in email_drafts (status:
// pending | held | excluded | no_reply | needs_collin) — full audit trail and the
// dedup key in one place.
//
// Run:  node scripts/draft-replies.mjs           (stages pending replies)
//       node scripts/draft-replies.mjs --dry      (classify + print, write nothing)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  isReplyableSender,
  isHardExcluded,
  loadDedupState,
  dedupSkip,
  loadFeedbackMemory,
} from "../lib/draft-control.mjs";

const DRY = process.argv.includes("--dry");

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

// ---------- Pass 1: drafter (NARROW-SAFE scope + reply in Collin's voice) ----------
const DRAFTER_SYS = `You are Collin Schwartz's email assistant. You draft replies in HIS voice, and you are CONSERVATIVE about what you draft. The robot/no-reply senders are already filtered out — every thread you see is from a human.

VOICE (email, mid-formality): Direct, anti-corporate, no fluff. Short paragraphs (1-3 sentences). NO bullet points. Bold at most ONE key line. Sign off "— Collin". Contractions fine. No corporate buzzwords ("synergy", "leverage" as a verb, "circle back", "touch base"), no marketing/urgency language, no "I hope this helps", at most one exclamation point ever. Operator-to-operator, never salesman. State things as fact, not "I think". NEVER invent a fact, date, or figure — leave a clear placeholder like [confirm date].

SCOPE — narrow first. Classify each thread:
- "reply"        → a LOW-RISK, ROUTINE message you can safely answer in Collin's voice: scheduling, intros, logistics, quick acknowledgments, "got it / here it is / let's talk", simple yes/no on non-committal matters. Draft it.
- "needs-collin" → a thread where a wrong word costs money or trust, or that requires Collin's judgment/authority. DO NOT draft. Set this for ANY of:
    • Investor / LP communications or capital (LeavenWealth, Liquid Lending fund investors)
    • Borrower-facing or loan-status content (Lendr / LLS)
    • Pricing, offers, terms, deal splits, or anything that commits a number/price/legal term
    • Money movement, wires, payment instructions, bank details (these are also caught upstream, but flag them)
    • Partner-sensitive matters (Tyler/Acreage, Vince/Titan, Chris/Mitch at LeavenWealth)
    • Anything needing a signature, or a legal/contract commitment
    • High-stakes named-person threads where nuance matters
- "no-reply-needed" → genuinely needs no reply (a thank-you with nothing owed, an FYI, a confirmation). Skip.

When unsure between "reply" and "needs-collin", choose "needs-collin". Drafting fewer, safer replies is the goal — Collin would rather write the hard ones himself than fix a wrong auto-draft.

REPLY SHAPE (only for "reply"): set reply_kind:
- "single"   → one natural reply. ONE variant labeled "Reply".
- "decision" → sender asks yes/no or either/or and Collin could go more than one way. 2-3 variants, ONE per path, each a COMPLETE standalone reply, labeled by the path ("Yes — confirm", "Propose Thursday instead", "Decline"). Genuinely different answers, not rewordings. Never guess which way he leans.

Output STRICT JSON only.`;

function drafterPrompt(threads, learned) {
  const compact = threads.map((t, i) => ({
    i,
    from_name: t.from_name,
    from_email: t.from_email,
    subject: t.subject,
    text: (t.body || t.snippet || "").slice(0, 2000),
  }));
  return `Inbound threads (last ${SINCE_HOURS}h), all from humans:\n${JSON.stringify(compact)}\n${learned || ""}\n` +
`For each thread, return STRICT JSON:
{
 "items":[{
   "i":int,
   "category":"reply|needs-collin|no-reply-needed",
   "needs_collin_reason":string|null,           // short why, when category=="needs-collin"
   "reply_kind":"single|decision|null",         // null unless category=="reply"
   "variants":[                                  // 1 for single, 2-3 for decision; [] unless reply
     {"label":string, "body":string}            // body = full reply in Collin's voice
   ]
 }]
}
No prose outside the JSON.`;
}

// ---------- Pass 2: Sue review (Approval Rules + voice lens) ----------
const SUE_SYS = `You are Sue, Collin's sign-off gate. You REVIEW prepopulated reply OPTIONS before they reach his dashboard. Some threads carry several variants (one per answer he could give) — judge EACH on its own. You judge; you don't write. Be strict; when unsure, HOLD.

Approve a variant only if ALL are true:
- It commits nothing it shouldn't: no wire/bank/payment detail repeated or confirmed, no specific number/price/legal term committed, no signature implied, no investor/loan facts asserted. (Money/wire/signature threads are filtered upstream — if one slips through, HOLD every variant.)
- It sounds like Collin: direct, no corporate jargon, no marketing language, short paragraphs, no bullet lists, signs "— Collin", no exclamation-point spam.
- No fabricated facts, dates, figures, or commitments. Unknowns are clear placeholders, not guesses.

Otherwise verdict:"hold" with a one-line note on what to fix or decide. Output STRICT JSON only.`;

function suePrompt(reviewItems, learned) {
  return `Reply options to review (each thread i has one or more variants v):\n${JSON.stringify(reviewItems)}\n${learned || ""}\n` +
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
  if (DRY) return;
  const { error } = await db.from("email_drafts").insert(row);
  if (error) console.error("draft-replies: log error", row.gmail_thread_id, error.message);
}

// A minimal ledger row (no draft): records that we processed this message and why
// we didn't stage a reply, so dedup never reconsiders it and there's an audit trail.
function ledgerRow(t, status, reason) {
  return {
    gmail_thread_id: t.thread_id, gmail_msg_id: t.msg_id,
    person_name: t.from_name, person_email: t.from_email, subject: t.subject,
    original_snippet: (t.body || t.snippet || "").slice(0, 1500),
    reply_to_message_id: t.msg_message_id || null,
    reply_references: t.references || null,
    category: status === "no_reply" ? "no-reply-needed" : "reply",
    reply_kind: "single",
    sensitivity: status === "excluded" || status === "needs_collin" ? "sensitive" : "normal",
    excluded_reason: reason || null,
    variants: [], draft_body: null,
    sue_verdict: "pending", sue_note: null,
    status,
  };
}

// ---------- main ----------
async function main() {
  const token = await gmailToken();
  if (!token) { console.log("draft-replies: Gmail creds absent — nothing to do."); return; }

  const raw = await fetchInboundThreads(token);
  if (!raw.length) { console.log("draft-replies: no inbound threads."); return; }

  // 0. FILTER — robots never reach the model.
  const human = [];
  let filtered = 0;
  for (const t of raw) {
    const r = isReplyableSender(t);
    if (!r.replyable) { filtered++; if (DRY) console.log(`  filter  ${t.from_email} — ${r.reason}`); continue; }
    human.push(t);
  }

  // 0b. DEDUP — message-keyed, status-agnostic.
  const state = await loadDedupState(db);
  const candidates = [];
  let deduped = 0;
  for (const t of human) {
    const d = dedupSkip(t, state);
    if (d.skip) { deduped++; if (DRY) console.log(`  dedup   ${t.from_email} "${t.subject}" — ${d.reason}`); continue; }
    candidates.push(t);
  }

  // 0c. HARD NET — money/wire/signature: log excluded, never draft.
  const draftable = [];
  let hardExcluded = 0;
  for (const t of candidates) {
    const h = isHardExcluded(t);
    if (h.excluded) {
      hardExcluded++;
      if (DRY) console.log(`  EXCLUDE ${t.from_email} "${t.subject}" — ${h.reason}`);
      else await logRow(ledgerRow(t, "excluded", h.reason));
      continue;
    }
    draftable.push(t);
  }

  console.log(
    `draft-replies: ${raw.length} threads → ${filtered} filtered (robot), ` +
    `${deduped} deduped, ${hardExcluded} hard-excluded, ${draftable.length} to classify.`
  );
  if (!draftable.length) { console.log("draft-replies: nothing to draft."); return; }

  // self-learning input
  const learned = await loadFeedbackMemory(db);
  if (learned && DRY) console.log("draft-replies: feedback memory loaded.");

  // Pass 1 — drafter (narrow-safe)
  const d = parseJson(await callClaude(DRAFTER_SYS, drafterPrompt(draftable, learned)), "drafter");
  if (!d?.items) { console.log("draft-replies: drafter returned nothing usable."); return; }
  for (const it of d.items) {
    if (it.category !== "reply") { it.variants = []; continue; }
    if (!Array.isArray(it.variants)) it.variants = [];
    it.variants = it.variants.filter((v) => v && v.body && v.body.trim()).slice(0, 3);
    it.reply_kind = it.variants.length > 1 ? "decision" : "single";
  }
  const byIndex = new Map(d.items.map((it) => [it.i, it]));

  // Pass 2 — Sue reviews every variant of every "reply" thread
  const routine = draftable
    .map((t, i) => ({ t, i, it: byIndex.get(i) }))
    .filter((x) => x.it?.category === "reply" && x.it.variants.length);
  let verdicts = new Map();
  if (routine.length) {
    const reviewItems = routine.map((x) => ({
      i: x.i,
      from: x.t.from_email,
      subject: x.t.subject,
      original: (x.t.body || x.t.snippet || "").slice(0, 1200),
      variants: x.it.variants.map((v, vi) => ({ v: vi, label: v.label, draft: v.body })),
    }));
    const s = parseJson(await callClaude(SUE_SYS, suePrompt(reviewItems, learned)), "sue");
    verdicts = new Map((s?.verdicts || []).map((x) => [`${x.i}:${x.v}`, x]));
  }

  // 3. STAGE — one ledger row per message; pending/held for "reply", needs_collin / no_reply otherwise.
  let staged = 0, optionsApproved = 0, held = 0, noReply = 0, needsCollin = 0;
  for (let i = 0; i < draftable.length; i++) {
    const t = draftable[i];
    const it = byIndex.get(i);

    if (!it || it.category === "no-reply-needed") {
      noReply++;
      if (DRY) console.log(`  no-reply  ${t.from_email} "${t.subject}"`);
      else await logRow(ledgerRow(t, "no_reply", null));
      continue;
    }
    if (it.category === "needs-collin" || !it.variants.length) {
      needsCollin++;
      const reason = it.needs_collin_reason || "needs Collin's judgment";
      if (DRY) console.log(`  NEEDS-COLLIN ${t.from_email} "${t.subject}" — ${reason}`);
      else await logRow(ledgerRow(t, "needs_collin", reason));
      continue;
    }

    const reviewed = it.variants.map((v, vi) => {
      const verdict = verdicts.get(`${i}:${vi}`);
      const ok = verdict?.verdict === "approve";
      if (ok) optionsApproved++;
      return {
        label: v.label, body: v.body,
        verdict: ok ? "approve" : "hold",
        note: verdict?.note || (ok ? null : "held by Sue review"),
      };
    });
    const anyApproved = reviewed.some((v) => v.verdict === "approve");
    const status = anyApproved ? "pending" : "held";
    if (anyApproved) staged++; else held++;
    const lead = reviewed.find((v) => v.verdict === "approve") || reviewed[0];

    if (DRY) {
      console.log(`  ${status.toUpperCase().padEnd(7)} ${t.from_email} "${t.subject}" (${reviewed.length} variant) ${lead?.note ? "— " + lead.note : ""}`);
      continue;
    }
    await logRow({
      gmail_thread_id: t.thread_id, gmail_msg_id: t.msg_id,
      person_name: t.from_name, person_email: t.from_email, subject: t.subject,
      original_snippet: (t.body || t.snippet || "").slice(0, 1500),
      reply_to_message_id: t.msg_message_id || null,
      reply_references: t.references || null,
      category: "reply", reply_kind: it.reply_kind, sensitivity: "normal",
      excluded_reason: null,
      variants: reviewed, draft_body: lead?.body || null,
      sue_verdict: anyApproved ? "approve" : "hold",
      sue_note: anyApproved ? null : (reviewed[0]?.note || "all variants held"),
      status,
    });
  }

  console.log(
    `draft-replies: ${staged} staged for /replies (${optionsApproved} option(s) Sue-approved), ` +
    `${held} held, ${needsCollin} needs-collin, ${noReply} no-reply.` + (DRY ? " [DRY RUN — nothing written]" : "")
  );
}

main().catch((e) => {
  console.error("draft-replies: fatal", e);
  process.exit(1);
});
