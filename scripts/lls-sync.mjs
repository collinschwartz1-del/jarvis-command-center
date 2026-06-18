// Jarvis LLS sync — headless, credential-based (no MCP).
//
// Pulls Liquid Lending Solutions data into Supabase so /lending can read it:
//   Lendr  → /loans (+summary), /investors, /payments, /loans/:id/comments
//            The REST API exposes raw resources (no aggregated dashboard-stats
//            route), so the fund snapshot is COMPUTED here from that raw data.
//   Gmail  → borrower-request / draw / payoff mail, classified by Claude and
//            matched to a loan by property address + borrower name
//
// Mirrors scripts/intel.mjs: same env loader, same Gmail OAuth refresh, each
// source wrapped so one failure can't kill the run; missing creds = clean skip.
// NEVER sends, replies, or moves money.
//
//   Lendr     → LENDR_API_BASE (https://joinlendr.com/api/v1) / LENDR_API_KEY
//   Gmail     → GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN
//   Claude    → ANTHROPIC_API_KEY
//   Supabase  → NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Run:  node scripts/lls-sync.mjs   (cron calls this ~hourly)

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
const MODEL = process.env.INTEL_MODEL || "claude-sonnet-4-6";
if (!SUPA_URL || !SUPA_KEY) {
  console.error("lls-sync: missing SUPABASE creds — aborting.");
  process.exit(1);
}
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const claude = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

const SINCE_DAYS = Number(process.env.LLS_MAIL_DAYS || 7);
const num = (v) => (v == null || v === "" ? 0 : Number(v));
const DAY = 86400000;

// ============================ Lendr ============================
const LENDR_BASE = (process.env.LENDR_API_BASE || "").replace(/\/$/, "");
const LENDR_KEY = process.env.LENDR_API_KEY;

// Lendr wraps every response: { success, data, summary?, message, status }.
async function lendr(path) {
  if (!LENDR_BASE || !LENDR_KEY) return null;
  const r = await fetch(`${LENDR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${LENDR_KEY}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`lendr ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

// Pipeline stages (status slug → display name + color), order = board order.
const PIPE = {
  new: { name: "New Applications", color: "gray" },
  underwriting: { name: "Underwriting", color: "yellow" },
  preclosing: { name: "Pre-Closing", color: "blue" },
  clear: { name: "Clear to Close", color: "green" },
};
const isPipeline = (status) => !!PIPE[status];

function normalizeLoan(l, loan_type) {
  const b = l.borrower || {};
  return {
    lendr_id: String(l.id),
    borrower_name: typeof b.name === "string" ? b.name : b.name?.full || null,
    address: l.address ?? null,
    city: l.city ?? null,
    state: l.state ?? null,
    zip: l.zip != null ? String(l.zip) : null,
    amount: l.amount != null ? num(l.amount) : null,
    outstanding_principal: l.outstanding_principal_balance != null
      ? num(l.outstanding_principal_balance)
      : null,
    status: l.status ?? null,
    stage: l.stage ?? PIPE[l.status]?.name ?? null,
    lien_position: l.lien_position ?? null,
    property_type: l.property_type ?? null,
    rate: l.rate != null ? num(l.rate) : null,
    origination_date: l.origination_date || null,
    payoff_date: l.maturity_date || null,
    loan_type,
  };
}

// Pull all loans (default set = every active + in-pipeline loan, plus recent
// closed). Upsert active + pipeline; return them for snapshot + matching.
async function syncLoans() {
  if (!LENDR_BASE || !LENDR_KEY) { console.log("lls-sync: Lendr creds absent — skipping loans."); return null; }
  const resp = await lendr("/loans");
  const raw = resp?.data || [];
  const summary = resp?.summary || {};

  const active = raw.filter((l) => l.status === "active");
  const pipeline = raw.filter((l) => isPipeline(l.status));

  const rows = [
    ...active.map((l) => normalizeLoan(l, "active")),
    ...pipeline.map((l) => normalizeLoan(l, "pipeline")),
  ];
  if (rows.length) {
    const { error } = await db.from("lls_loans").upsert(rows, { onConflict: "lendr_id" });
    if (error) console.error("lls-sync: loan upsert error", error.message);
  }
  console.log(`lls-sync: ${active.length} active + ${pipeline.length} pipeline loans upserted.`);
  return { active, pipeline, summary };
}

// Compute the fund snapshot (scalars + a `raw` blob shaped for the UI) from the
// raw loan/investor/payment data. Mirrors what the old dashboard-stats returned.
async function buildSnapshot(loanRes) {
  if (!loanRes) return null;
  const { active, pipeline, summary } = loanRes;
  const [investorsR, paymentsR] = await Promise.all([
    lendr("/investors"),
    lendr("/payments"),
  ]);
  const investors = investorsR?.data || [];
  const payments = paymentsR?.data || [];

  const today = new Date();
  const todayMid = new Date(today.toISOString().slice(0, 10));
  const in30 = new Date(todayMid.getTime() + 30 * DAY);

  // --- capital (sum per-investor capital → matches the fund totals exactly) ---
  let availableCapital = 0, outstandingCapital = 0, totalCapital = 0;
  for (const i of investors) {
    availableCapital += num(i.capital?.available);
    outstandingCapital += num(i.capital?.outstanding);
    totalCapital += num(i.capital?.total);
  }

  // --- pipeline (loans waiting for approval), by stage ---
  const bd = {};
  let pipelineValue = 0;
  for (const l of pipeline) {
    const s = PIPE[l.status];
    if (!s) continue;
    (bd[l.status] ??= { name: s.name, slug: l.status, color: s.color, total_value: 0, loan_count: 0 });
    bd[l.status].total_value += num(l.amount);
    bd[l.status].loan_count += 1;
    pipelineValue += num(l.amount);
  }
  const breakdown = Object.keys(PIPE)
    .filter((k) => bd[k])
    .map((k) => ({ ...bd[k], total_value: String(bd[k].total_value) }));

  // --- next 30 days: deploys out (pipeline originating) + loans maturing in ---
  const within = (d) => { const x = new Date(d); return x >= todayMid && x <= in30; };
  const deploys = pipeline.filter((l) => l.origination_date && within(l.origination_date));
  const maturing = active.filter((l) => l.maturity_date && within(l.maturity_date));
  const timeline = [
    ...maturing.map((l) => ({
      loan_id: l.id, date_iso: l.maturity_date,
      date_label: fmtDay(l.maturity_date), address: l.address, city: l.city, state: l.state,
      type: "payoff", stage: null, amount: num(l.amount), signed_amount: num(l.amount),
    })),
    ...deploys.map((l) => ({
      loan_id: l.id, date_iso: l.origination_date,
      date_label: fmtDay(l.origination_date), address: l.address, city: l.city, state: l.state,
      type: "origination", stage: l.stage, amount: num(l.amount), signed_amount: -num(l.amount),
    })),
  ].sort((a, b) => new Date(a.date_iso) - new Date(b.date_iso));
  const inflowTotal = maturing.reduce((s, l) => s + num(l.amount), 0);
  const outflowTotal = deploys.reduce((s, l) => s + num(l.amount), 0);

  // --- past-maturity (holdover) watch + portfolio LTV from list values ---
  const pastMaturity = active.filter((l) => l.maturity_date && new Date(l.maturity_date) < todayMid);
  const sumAmt = (a) => a.reduce((s, l) => s + num(l.amount), 0);
  const sumCur = active.reduce((s, l) => s + num(l.current_value), 0);
  const sumArv = active.reduce((s, l) => s + num(l.arv), 0);
  const activeAmt = sumAmt(active);
  const portfolioLtv = sumCur > 0 ? (activeAmt / sumCur) * 100 : null;
  const portfolioArltv = sumArv > 0 ? (activeAmt / sumArv) * 100 : null;

  // --- concentration (active book by borrower) ---
  const byB = {};
  for (const l of active) {
    const nm = (l.borrower?.name && (l.borrower.name.full || l.borrower.name)) || "—";
    byB[nm] = (byB[nm] || 0) + num(l.amount);
  }
  const concentration = Object.entries(byB)
    .map(([nm, v]) => {
      const parts = String(nm).split(" ");
      return {
        first_name: parts.slice(0, -1).join(" ") || nm,
        last_name: parts.length > 1 ? parts[parts.length - 1] : "",
        total_amount: String(v),
        percentage: activeAmt > 0 ? +((v / activeAmt) * 100).toFixed(1) : 0,
      };
    })
    .sort((a, b) => Number(b.total_amount) - Number(a.total_amount))
    .slice(0, 8);

  // --- gross monthly interest on the active book (amount × rate ÷ 12) ---
  const monthlyInterest = active.reduce((s, l) => s + num(l.amount) * (num(l.rate) / 100) / 12, 0);

  // --- lender earnings by month (payments collected) ---
  const earnings = {};
  for (const p of payments) {
    if (!p.paid_on) continue;
    const key = String(p.paid_on).slice(0, 7);
    const [y, m] = key.split("-");
    (earnings[key] ??= { year: Number(y), month: Number(m), earned: 0, projected: 0 });
    earnings[key].earned += num(p.total_payment);
  }

  // --- aged receivables proxy: unpaid payments past due ---
  const agedReceivables = payments
    .filter((p) => p.status !== "paid" && p.due_date && new Date(p.due_date) < todayMid)
    .reduce((s, p) => s + num(p.total_payment), 0);

  const uniqueBorrowers = new Set(active.map((l) => l.borrower?.id).filter(Boolean)).size;

  return {
    available_capital: availableCapital || null,
    outstanding_capital: outstandingCapital || num(summary.total_outstanding_principal_balance) || null,
    total_capital: totalCapital || null,
    aged_receivables: agedReceivables || null,
    portfolio_ltv: portfolioLtv,
    avg_monthly_interest: monthlyInterest || null,
    unique_borrowers: uniqueBorrowers || null,
    active_loan_count: active.length,
    pipeline_value: pipelineValue || null,
    pipeline_count: pipeline.length,
    payoffs_30d_total: inflowTotal || null,
    payoffs_30d_count: maturing.length,
    originations_30d_total: outflowTotal || null,
    originations_30d_count: deploys.length,
    raw: {
      pipeline_value: { total_value: pipelineValue, loan_count: pipeline.length, breakdown },
      pipeline_vs_payoffs: {
        inflow_total: inflowTotal, inflow_count: maturing.length,
        outflow_total: outflowTotal, outflow_count: deploys.length,
        net: inflowTotal - outflowTotal, timeline,
        window_start: todayMid.toISOString(), window_end: in30.toISOString(),
      },
      concentration_risk: concentration,
      lender_earnings: earnings,
      portfolio_arltv: portfolioArltv,
      past_maturity: { count: pastMaturity.length, total: sumAmt(pastMaturity) },
      computed_at: new Date().toISOString(),
    },
  };
}

function fmtDay(d) {
  const x = new Date(d);
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Pull comments for a set of loan ids and upsert (team feedback carry-through).
async function syncComments(loanIds) {
  if (!LENDR_BASE || !LENDR_KEY || !loanIds.length) return 0;
  let n = 0;
  for (const id of loanIds) {
    try {
      const r = await lendr(`/loans/${encodeURIComponent(id)}/comments`);
      const rows = (r?.data || []).map((c) => ({
        lendr_comment_id: String(c.id ?? c.comment_id),
        loan_id: String(id),
        author: c.author?.name || c.author || c.created_by || c.user?.name || null,
        body: c.body || c.comment || c.text || "",
        created_at: c.created_at || c.createdAt || new Date().toISOString(),
      }));
      const valid = rows.filter((x) => x.lendr_comment_id && x.lendr_comment_id !== "null" && x.body);
      if (valid.length) {
        const { error } = await db
          .from("lls_loan_comments")
          .upsert(valid, { onConflict: "lendr_comment_id" });
        if (error) console.error(`lls-sync: comment upsert ${id}`, error.message);
        else n += valid.length;
      }
    } catch (e) {
      console.error(`lls-sync: comments ${id} failed:`, e.message);
    }
  }
  console.log(`lls-sync: ${n} loan comments synced.`);
  return n;
}

// ============================ Gmail ============================
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
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}
function decodeBody(payload) {
  function walk(p) {
    if (!p) return "";
    if (p.mimeType === "text/plain" && p.body?.data)
      return Buffer.from(p.body.data, "base64").toString("utf8");
    for (const part of p.parts || []) { const t = walk(part); if (t) return t; }
    return "";
  }
  return walk(payload).slice(0, 4000);
}

const LLS_QUERY =
  `newer_than:${SINCE_DAYS}d (from:liquidlendingsolutions.com OR ` +
  `to:liquidlendingsolutions.com OR from:lendrmail.com OR liquidlendingsolutions)`;

async function fetchLlsMail() {
  const token = await gmailToken();
  if (!token) { console.log("lls-sync: Gmail creds absent — skipping mail."); return []; }
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(LLS_QUERY)}&maxResults=60`,
    { headers: auth }
  ).then((r) => r.json());
  const out = [];
  for (const { id, threadId } of list.messages || []) {
    const m = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: auth }
    ).then((r) => r.json());
    const from = header(m.payload, "From");
    const email = (from.match(/<(.+?)>/)?.[1] || from).trim().toLowerCase();
    const name = from.replace(/<.+?>/, "").replace(/"/g, "").trim() || email;
    const dateHdr = header(m.payload, "Date");
    out.push({
      gmail_message_id: id,
      gmail_thread_id: threadId || m.threadId || id,
      from_name: name,
      from_email: email,
      subject: header(m.payload, "Subject"),
      received_at: dateHdr ? new Date(dateHdr).toISOString() : null,
      snippet: m.snippet || "",
      body: decodeBody(m.payload),
    });
  }
  console.log(`lls-sync: pulled ${out.length} LLS-related messages.`);
  return out;
}

// ---------- Claude: classify + extract the ask ----------
const SYS =
  "You triage Liquid Lending Solutions (a hard-money lender) mail. For each email, " +
  "classify it and extract the borrower's ask. You NEVER reply or act. Facts only — " +
  "do not invent. Categories: 'borrower-request' (a borrower or the LLS team asking to " +
  "fund/draw/extend/approve a loan or sharing deal details), 'draw' (construction draw " +
  "request), 'payoff' (a payoff quote/notice), 'notification' (automated Lendr/system " +
  "mail), 'other'. Output STRICT JSON only.";

function userPrompt(msgs) {
  const compact = msgs.map((m, i) => ({
    i, from_name: m.from_name, from_email: m.from_email,
    subject: m.subject, text: (m.body || m.snippet || "").slice(0, 1200),
  }));
  return (
    `Emails:\n${JSON.stringify(compact)}\n\n` +
    `Return STRICT JSON: {"items":[{"i":int,"category":"borrower-request|draw|payoff|notification|other",` +
    `"request_summary":"one short line: who wants what (property, amount if stated)",` +
    `"borrower_name":"best guess of the borrower's name or null",` +
    `"property":"street address mentioned or null"}]}. No prose outside the JSON.`
  );
}

async function classify(msgs) {
  if (!claude || !msgs.length) return new Map();
  const resp = await claude.messages.create({
    model: MODEL, max_tokens: 4000, system: SYS,
    messages: [{ role: "user", content: userPrompt(msgs) }],
  });
  const text = resp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const map = new Map();
  try { for (const it of JSON.parse(json).items || []) map.set(it.i, it); }
  catch (e) { console.error("lls-sync: classify parse failed:", text.slice(0, 200)); }
  return map;
}

// ---------- match an email to a loan ----------
const STOP = new Set(["st", "ave", "rd", "dr", "ln", "blvd", "ct", "cir", "way", "n", "s", "e", "w", "the", "of"]);
function tokens(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}
function lastName(name) {
  const p = (name || "").trim().split(/\s+/);
  return p.length ? p[p.length - 1].toLowerCase() : "";
}
function matchLoan(item, msg, loans) {
  const hay = `${msg.subject} ${msg.body || msg.snippet}`;
  const hayTokens = new Set(tokens(hay + " " + (item?.property || "")));
  let best = null, bestScore = 0;
  for (const l of loans) {
    const lt = tokens(`${l.address} ${l.city}`);
    const overlap = lt.filter((t) => hayTokens.has(t)).length;
    const numHit = (l.address || "").match(/\d{2,}/)?.[0];
    const score = overlap + (numHit && hay.includes(numHit) ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = l; }
  }
  if (best && bestScore >= 2) return String(best.id);
  const bn = lastName(item?.borrower_name);
  if (bn) {
    const m = loans.find((l) => lastName(l.borrower?.name?.full || l.borrower?.name) === bn);
    if (m) return String(m.id);
  }
  return null;
}
function priorityFor(msg, category) {
  let p = 0;
  if ((msg.from_email || "").endsWith("@liquidlendingsolutions.com")) p += 100;
  if (category === "borrower-request" || category === "draw") p += 50;
  if (category === "payoff") p += 20;
  if (category === "notification") p -= 20;
  return p;
}

async function syncInbox(loans) {
  const msgs = await fetchLlsMail();
  if (!msgs.length) return { matchedLoanIds: [], count: 0 };
  const cls = await classify(msgs);
  const matchedLoanIds = new Set();
  const rows = msgs.map((m, i) => {
    const it = cls.get(i) || {};
    const category = it.category || "other";
    const matched = matchLoan(it, m, loans);
    if (matched) matchedLoanIds.add(matched);
    return {
      gmail_message_id: m.gmail_message_id,
      gmail_thread_id: m.gmail_thread_id,
      from_name: m.from_name, from_email: m.from_email,
      subject: m.subject, snippet: m.snippet, body: m.body,
      received_at: m.received_at, category,
      request_summary: it.request_summary || null,
      priority: priorityFor(m, category),
      matched_loan_id: matched,
    };
  });
  const { error } = await db.from("lls_inbox").upsert(rows, { onConflict: "gmail_message_id" });
  if (error) console.error("lls-sync: inbox upsert error", error.message);
  console.log(`lls-sync: ${rows.length} inbox items upserted.`);
  return { matchedLoanIds: [...matchedLoanIds], count: rows.length };
}

// ============================ main ============================
async function main() {
  let loanRes = null;
  try { loanRes = await syncLoans(); }
  catch (e) { console.error("lls-sync: loans failed:", e.message); }

  // raw loan objects for matching (the full API objects, not the normalized rows)
  const matchPool = loanRes ? [...loanRes.active, ...loanRes.pipeline] : [];

  let inbox = { matchedLoanIds: [], count: 0 };
  try { inbox = await syncInbox(matchPool); }
  catch (e) { console.error("lls-sync: inbox failed:", e.message); }

  // comments: pipeline loans + any loan an email matched to
  const commentIds = new Set(inbox.matchedLoanIds);
  for (const l of loanRes?.pipeline || []) commentIds.add(String(l.id));
  try { await syncComments([...commentIds]); }
  catch (e) { console.error("lls-sync: comments failed:", e.message); }

  // snapshot last (depends on loans + investors + payments)
  try {
    const snap = await buildSnapshot(loanRes);
    if (snap) {
      const { error } = await db.from("lls_snapshot").insert(snap);
      if (error) console.error("lls-sync: snapshot insert error", error.message);
      else console.log("lls-sync: snapshot stored.");
    }
  } catch (e) {
    console.error("lls-sync: snapshot failed:", e.message);
  }

  console.log("lls-sync: done.");
}

main().catch((e) => {
  console.error("lls-sync: fatal", e);
  process.exit(1);
});
