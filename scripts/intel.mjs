// Jarvis morning INTEL refresh — headless, credential-based (no MCP).
//
// Replaces the old `claude -p "Refresh..."` step in morning-board.sh, which
// failed under cron because the claude.ai connectors (Gmail / M365 / Supabase)
// are only authenticated in an *interactive* session. This script uses its own
// stored credentials instead, so it works from a 7am cron job.
//
//   Gmail    → OAuth refresh token (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)
//   M365     → client-credentials app (MS_TENANT_ID/CLIENT_ID/SECRET/USER) — OPTIONAL
//   Claude   → ANTHROPIC_API_KEY (already in .env.local)
//   Supabase → SUPABASE_SERVICE_ROLE_KEY (already in .env.local)
//
// Reads last 48h of mail, summarizes by person → email_briefs, flags deal
// emails → deal_analyses, and NEVER sends, replies, or moves money. Each source
// is wrapped so one failure can't kill the run; missing creds = clean skip.
//
// Run:  node scripts/intel.mjs        (cron calls this)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// --- env (same loader as sync.mjs) ---
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
const MODEL = process.env.INTEL_MODEL || "claude-sonnet-4-6";
if (!SUPA_URL || !SUPA_KEY || !ANTHROPIC_KEY) {
  console.error("intel: missing SUPABASE or ANTHROPIC creds — aborting.");
  process.exit(1);
}
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

const SINCE_HOURS = 48;
const sinceSec = Math.floor(Date.now() / 1000) - SINCE_HOURS * 3600;

// ---------- Gmail (REST + fetch; no googleapis dep) ----------
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
  // walk parts for the first text/plain body
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

async function fetchGmail() {
  const token = await gmailToken();
  if (!token) { console.log("intel: Gmail creds absent — skipping Gmail."); return []; }
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
      `newer_than:2d -category:promotions -category:social`
    )}&maxResults=80`,
    { headers: auth }
  ).then((r) => r.json());
  const out = [];
  for (const { id } of list.messages || []) {
    const m = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: auth }
    ).then((r) => r.json());
    const from = header(m.payload, "From");
    const email = (from.match(/<(.+?)>/)?.[1] || from).trim().toLowerCase();
    const name = from.replace(/<.+?>/, "").replace(/"/g, "").trim() || email;
    out.push({
      mailbox: "gmail",
      from_name: name,
      from_email: email,
      subject: header(m.payload, "Subject"),
      date: header(m.payload, "Date"),
      snippet: m.snippet || "",
      body: decodeBody(m.payload),
      has_attachment: JSON.stringify(m.payload).includes('"filename":"') &&
        !/"filename":""/.test(JSON.stringify(m.payload)),
    });
  }
  console.log(`intel: pulled ${out.length} Gmail messages.`);
  return out;
}

// ---------- Microsoft 365 (Graph; OPTIONAL) ----------
async function fetchM365() {
  const tenant = process.env.MS_TENANT_ID;
  const id = process.env.MS_CLIENT_ID;
  const secret = process.env.MS_CLIENT_SECRET;
  const user = process.env.MS_USER; // the mailbox UPN to read
  if (!tenant || !id || !secret || !user) {
    console.log("intel: M365 creds absent — skipping M365.");
    return [];
  }
  const tok = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id, client_secret: secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  ).then((r) => r.json());
  if (!tok.access_token) throw new Error(`m365 token: ${JSON.stringify(tok)}`);
  const sinceIso = new Date(sinceSec * 1000).toISOString();
  const data = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/messages` +
      `?$filter=receivedDateTime ge ${sinceIso}&$top=80` +
      `&$select=from,subject,bodyPreview,receivedDateTime,hasAttachments`,
    { headers: { Authorization: `Bearer ${tok.access_token}` } }
  ).then((r) => r.json());
  const out = (data.value || []).map((m) => ({
    mailbox: "m365",
    from_name: m.from?.emailAddress?.name || "",
    from_email: (m.from?.emailAddress?.address || "").toLowerCase(),
    subject: m.subject || "",
    date: m.receivedDateTime || "",
    snippet: m.bodyPreview || "",
    body: m.bodyPreview || "",
    has_attachment: !!m.hasAttachments,
  }));
  console.log(`intel: pulled ${out.length} M365 messages.`);
  return out;
}

// ---------- Claude: summarize by person + flag deals ----------
// Web access for enrichment is opt-in (INTEL_WEB=1) so the daily cron doesn't
// silently incur search cost/latency. When off, summarize from the email text only.
const WEB = process.env.INTEL_WEB === "1";
const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];

const SYS = `You are Jarvis's inbox analyst. You receive raw recent emails. You NEVER send, reply, or act — you only summarize and flag. Be terse and decision-grade. Facts only — summarize what the emails actually say; do not speculate or insert opinion, and never invent details that aren't in the email. If something is your inference, mark it as such. Skip pure marketing/newsletters/automated noise. Group by sender (person_email). Output STRICT JSON only, matching the schema given. For any email about a real estate deal (multifamily, SFH/flip, land), add a deals[] entry. For any email about a wire, new/changed payment instructions, or bank-detail change, set wire_flag:true on that person and add an action_item starting with "WIRE-VERIFY:".${
  WEB
    ? " You have web search/fetch — use it sparingly to verify or enrich a specific factual claim (a firm, an address, a deal figure) when it materially changes the takeaway. Ground enrichments in what you find."
    : ""
}`;

function userPrompt(msgs) {
  const compact = msgs.map((m, i) => ({
    i, mailbox: m.mailbox, from_name: m.from_name, from_email: m.from_email,
    subject: m.subject, date: m.date,
    has_attachment: m.has_attachment,
    text: (m.body || m.snippet || "").slice(0, 1500),
  }));
  return `Emails (last ${SINCE_HOURS}h):\n${JSON.stringify(compact)}\n\n` +
`Return STRICT JSON:
{
 "briefs":[{"person_name","person_email","mailbox","thread_count":int,"latest_at":ISO8601,
   "summary":"1-3 sentences","takeaways":[".."],"action_items":[".."],"subjects":[".."],"wire_flag":bool}],
 "deals":[{"deal_name","address","asset_type":"multifamily|flip|land","source":"email",
   "units":int|null,"price":number|null,"verdict":"needs-underwrite",
   "docs_status":"financials attached|missing financials","red_flags":[".."],
   "questions":[".."],"person_email","routed_to":"underwriter|flip-tracker"}]
}
Only include people worth a human's attention. No prose outside the JSON.`;
}

async function analyze(msgs) {
  if (!msgs.length) return { briefs: [], deals: [] };
  const resp = await claude.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYS,
    ...(WEB ? { tools: WEB_TOOLS } : {}),
    messages: [{ role: "user", content: userPrompt(msgs) }],
  });
  const text = resp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error("intel: could not parse Claude JSON — raw head:", text.slice(0, 300));
    return { briefs: [], deals: [] };
  }
}

// ---------- upserts ----------
async function upsertBriefs(briefs) {
  let n = 0;
  for (const b of briefs || []) {
    if (!b.person_email) continue;
    const { error } = await db.from("email_briefs").upsert(
      {
        person_name: b.person_name || b.person_email,
        person_email: b.person_email.toLowerCase(),
        mailbox: b.mailbox || "gmail",
        thread_count: b.thread_count ?? null,
        latest_at: b.latest_at || null,
        summary: b.summary || "",
        takeaways: b.takeaways || [],
        action_items: b.action_items || [],
        subjects: b.subjects || [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "person_email" }
    );
    if (error) console.error("intel: brief upsert error", b.person_email, error.message);
    else n++;
  }
  return n;
}

async function upsertDeals(deals) {
  let n = 0;
  for (const d of deals || []) {
    const { error } = await db.from("deal_analyses").insert({
      deal_name: d.deal_name || d.address || "(unnamed deal)",
      address: d.address || null,
      asset_type: d.asset_type || null,
      source: d.source || "email",
      units: d.units ?? null,
      price: d.price ?? null,
      verdict: d.verdict || "needs-underwrite",
      docs_status: d.docs_status || null,
      red_flags: d.red_flags || [],
      questions: d.questions || [],
      routed_to: d.routed_to || "underwriter",
      person_email: d.person_email || null,
    });
    if (error) console.error("intel: deal insert error", d.deal_name, error.message);
    else n++;
  }
  return n;
}

// ---------- main ----------
async function main() {
  const sources = await Promise.allSettled([fetchGmail(), fetchM365()]);
  const msgs = sources.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  for (const s of sources)
    if (s.status === "rejected") console.error("intel: source failed:", s.reason?.message || s.reason);
  if (!msgs.length) {
    console.log("intel: no messages pulled (check credentials). Nothing to do.");
    return;
  }
  const { briefs, deals } = await analyze(msgs);
  const nb = await upsertBriefs(briefs);
  const nd = await upsertDeals(deals);
  const wires = (briefs || []).filter((b) => b.wire_flag).map((b) => b.person_email);
  console.log(`intel: ${nb} briefs, ${nd} deals upserted.`);
  if (wires.length) console.log(`intel: ⚠️ WIRE-VERIFY flags on: ${wires.join(", ")}`);
}

main().catch((e) => {
  console.error("intel: fatal", e);
  process.exit(1);
});
