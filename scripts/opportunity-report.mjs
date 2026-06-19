// Jarvis DAILY OPPORTUNITY REPORT — "source to cash" digest.
//
// Compiles revenue opportunities from every inbound channel into ONE ranked
// report, "closest to cash first":
//
//   Money owed    → Lendr/LLS (live API): payoffs maturing, past-maturity
//                   holdovers to collect, draw requests; + MASC tracker payoffs.
//   Email         → email_briefs + deal_analyses (written upstream by intel.mjs).
//   Texts/iMessage→ chat.db (last 24h inbound) scanned by a LOCAL Ollama model.
//                   Raw message text NEVER leaves the Mac — only distilled
//                   opportunity flags are kept. (Text Intelligence rule.)
//   Pipelines     → sue/trackers wholesaler + services trackers: warm/proven
//                   contacts worth a nudge.
//
// Output:
//   1. Dated markdown → sue/trackers/opportunities/YYYY-MM-DD.md (+ -latest.md)
//   2. Emailed digest of the top items to Collin (his own inbox; never to others).
//
// NEVER sends to a third party, replies, or moves money. Read + summarize only.
//
// Run:  node scripts/opportunity-report.mjs
// Cron: called by morning-board.sh after intel.mjs + sync.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

// ---------------- env ----------------
function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const HOME = homedir();
const TRACKERS = process.env.OPP_TRACKERS_DIR ||
  join(HOME, "Documents/my-ai-team/sue/trackers");
const REPORT_TO = process.env.OPP_REPORT_TO || "collinschwartz1@gmail.com";
const EMAIL_TEXTS = process.env.OPP_EMAIL_TEXTS !== "0"; // include distilled text opps in email
const SEND_EMAIL = process.env.OPP_SEND_EMAIL !== "0";   // set 0 to skip the email step
const TOP_N = Number(process.env.OPP_TOP_N || 12);

const LENDR_BASE = (process.env.LENDR_API_BASE || "").replace(/\/$/, "");
const LENDR_KEY = process.env.LENDR_API_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OPP_OLLAMA_MODEL || "llama3.1:8b";

const db = SUPA_URL && SUPA_KEY
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
  : null;

// ---------------- helpers ----------------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DAY = 86400e3;
const now = new Date();
const todayISO = now.toISOString().slice(0, 10);
const money = (n) =>
  n == null ? "" : "$" + Math.round(n).toLocaleString("en-US");
const daysFromNow = (d) => Math.round((new Date(d) - now) / DAY);

// Opportunity stages, ranked closest-to-cash first. Higher weight = nearer cash.
const STAGE = { owed: 400, closing: 300, lead: 200, nurture: 100 };
// op = { source, stage, title, who, amount, action, why, urgent?:bool }
function score(op) {
  let s = STAGE[op.stage] ?? 100;
  if (op.urgent) s += 60;
  // $ tiebreak inside a stage: up to +99 for a $1M+ item (log-scaled).
  if (op.amount) s += Math.min(99, Math.log10(op.amount + 1) * 16);
  return s;
}

const ok = (label, n) => console.log(`opp: ${label}: ${n}`);
const warn = (label, e) =>
  console.error(`opp: ${label} failed — ${e?.message || e}`);

// ================= SOURCE A: Lendr / LLS (money owed) =================
async function lendr(path) {
  if (!LENDR_BASE || !LENDR_KEY) return null;
  const r = await fetch(`${LENDR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${LENDR_KEY}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`lendr ${path} ${r.status}`);
  return r.json();
}

async function fromLendr() {
  const ops = [];
  if (!LENDR_BASE || !LENDR_KEY) { console.log("opp: Lendr creds absent — skipping."); return ops; }

  // Only loans that matured within this window are a fresh "collect/extend"
  // opportunity. Loans matured longer ago are known holdovers/extensions —
  // they belong in a portfolio-risk view, not a daily cash digest — so we roll
  // them into one summary line instead of flooding the report.
  const PAST_DAYS = Number(process.env.OPP_PAST_MATURITY_DAYS || 60);
  const loansR = await lendr("/loans");
  const loans = (loansR?.data || []).filter((l) => l.status === "active");
  const oldHoldovers = [];
  for (const l of loans) {
    const who = l.borrower?.name?.full || l.borrower?.name || "borrower";
    const addr = [l.address, l.city, l.state].filter(Boolean).join(", ");
    const amt = num(l.amount);
    if (l.maturity_date) {
      const dd = daysFromNow(l.maturity_date);
      if (dd < 0 && -dd <= PAST_DAYS) {
        ops.push({
          source: "LLS", stage: "owed", urgent: true, amount: amt,
          title: `Past-maturity loan — ${who}`,
          who, action: `Collect / extend: matured ${-dd}d ago (${l.maturity_date})`,
          why: `${money(amt)} principal past due${addr ? ` · ${addr}` : ""}. Recent holdover — fastest cash.`,
        });
      } else if (dd < 0) {
        oldHoldovers.push(amt);
      } else if (dd <= 30) {
        ops.push({
          source: "LLS", stage: "owed", amount: amt,
          title: `Payoff maturing in ${dd}d — ${who}`,
          who, action: `Confirm payoff timeline / reload capital (matures ${l.maturity_date})`,
          why: `${money(amt)} returns within 30 days${addr ? ` · ${addr}` : ""}.`,
        });
      }
    }
  }

  // One rolled-up line for the aged book so it's visible but not noisy.
  if (oldHoldovers.length) {
    const tot = oldHoldovers.reduce((s, n) => s + n, 0);
    ops.push({
      source: "LLS", stage: "owed", amount: tot, rollup: true,
      title: `${oldHoldovers.length} aged holdovers (>${PAST_DAYS}d past maturity)`,
      who: "", action: "Portfolio-risk review — extend, restructure, or foreclose (see LLS dashboard)",
      why: `${money(tot)} in long-past-maturity principal. Not daily-actionable; tracked for risk.`,
    });
  }

  // Pending draw requests = borrower needs funds → keeps the loan performing.
  try {
    const draws = await lendr("/draw-requests");
    const list = Array.isArray(draws?.data) ? draws.data
      : Array.isArray(draws?.data?.draw_requests) ? draws.data.draw_requests : [];
    for (const d of list) {
      const st = String(d.status || "").toLowerCase();
      if (st && !/(approved|funded|paid|complete|denied|reject)/.test(st)) {
        ops.push({
          source: "LLS", stage: "closing", amount: num(d.amount),
          title: `Draw request pending — ${d.borrower_name || d.loan?.borrower?.name || "borrower"}`,
          who: d.borrower_name || "borrower",
          action: `Review & action draw (${money(num(d.amount))}, status: ${d.status})`,
          why: "Pending draw keeps a loan performing and interest accruing.",
        });
      }
    }
  } catch (e) { warn("lendr draw-requests", e); }

  ok("LLS opportunities", ops.length);
  return ops;
}

// ================= SOURCE B: Email (briefs + deal flags) =================
async function fromEmail() {
  const ops = [];
  if (!db) { console.log("opp: Supabase absent — skipping email."); return ops; }
  const sinceISO = new Date(now - 2 * DAY).toISOString();

  // Deal analyses = inbound real-estate opportunities flagged by intel.mjs.
  try {
    const { data } = await db
      .from("deal_analyses")
      .select("deal_name,address,asset_type,units,price,docs_status,questions,person_email,created_at")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false });
    for (const d of data || []) {
      const ready = /attached|complete|received/i.test(d.docs_status || "");
      ops.push({
        source: "Email", stage: ready ? "closing" : "lead",
        amount: d.price ? num(d.price) : null,
        title: `Deal: ${d.deal_name || d.address || "(unnamed)"}`,
        who: d.person_email || "",
        action: ready
          ? "Underwrite — docs in hand"
          : `Request docs / qualify (${d.docs_status || "missing financials"})`,
        why: [d.asset_type, d.units ? `${d.units} units` : null, d.address]
          .filter(Boolean).join(" · ") || "Inbound deal email.",
      });
    }
  } catch (e) { warn("deal_analyses", e); }

  // Email briefs with action items = inbound people worth a reply (potential cash).
  try {
    const { data } = await db
      .from("email_briefs")
      .select("person_name,person_email,summary,action_items,updated_at")
      .gte("updated_at", sinceISO)
      .order("updated_at", { ascending: false });
    const CASH = /(buy|sell|offer|deal|invest|loan|fund|wire|pay|quote|proposal|contract|close|refer|hire|engage|book|call)/i;
    for (const b of data || []) {
      const items = Array.isArray(b.action_items) ? b.action_items : [];
      const cashy = CASH.test((b.summary || "") + " " + items.join(" "));
      if (!cashy) continue;
      ops.push({
        source: "Email", stage: "lead", amount: null,
        title: `Reply: ${b.person_name || b.person_email}`,
        who: b.person_email || "",
        action: items[0] || "Respond — cash-relevant thread",
        why: (b.summary || "").slice(0, 160),
      });
    }
  } catch (e) { warn("email_briefs", e); }

  ok("Email opportunities", ops.length);
  return ops;
}

// ================= SOURCE C: Texts / iMessage (LOCAL ONLY) =================
// Raw text is read from chat.db and fed ONLY to a local Ollama model. Nothing
// raw is retained or transmitted — we keep only the distilled opportunity flags.
async function fromTexts() {
  const ops = [];
  const dbPath = join(HOME, "Library/Messages/chat.db");
  if (!existsSync(dbPath)) { console.log("opp: chat.db absent — skipping texts."); return ops; }

  let rows = [];
  try {
    // Apple stores message.date as ns since 2001-01-01 (offset 978307200s).
    const sql = `
      SELECT COALESCE(h.id,'?') AS handle, m.text AS text
      FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.is_from_me = 0 AND m.text IS NOT NULL AND length(m.text) > 0
        AND (m.date/1000000000 + 978307200) > strftime('%s','now','-1 day')
      ORDER BY m.date DESC LIMIT 250;`;
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    rows = JSON.parse(out || "[]");
  } catch (e) {
    warn("chat.db read (needs Full Disk Access)", e);
    return ops;
  }
  if (!rows.length) { ok("Text opportunities", 0); return ops; }

  // Compact per-handle so the local model sees recent context per contact.
  const byHandle = {};
  for (const r of rows) (byHandle[r.handle] ??= []).push(r.text.replace(/\s+/g, " ").trim());
  const compact = Object.entries(byHandle).slice(0, 40).map(([handle, msgs]) => ({
    handle, msgs: msgs.slice(0, 8),
  }));

  const prompt =
`You are a local revenue-opportunity scanner for a real-estate investor & lender.
Below are recent inbound text messages grouped by sender handle. Identify ONLY
messages that are a potential SOURCE OF CASH: someone wanting to buy/sell a
property, an off-market deal, a loan/lending request, money owed or a payment, a
referral, or a service/consulting inquiry. Ignore personal chatter, spam, 2FA
codes, and notifications.

Return STRICT JSON only: {"opps":[{"handle":"<sender>","summary":"<=18 words, no raw quotes","action":"<the next step>"}]}
If none, return {"opps":[]}.

DATA:
${JSON.stringify(compact)}`;

  let parsed = { opps: [] };
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: "json", options: { temperature: 0 } }),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const j = await r.json();
    parsed = JSON.parse(j.response || '{"opps":[]}');
  } catch (e) {
    warn("ollama text scan", e);
    return ops;
  }

  for (const o of parsed.opps || []) {
    ops.push({
      source: "Text", stage: "lead", amount: null, local: true,
      title: `Text: ${o.handle || "unknown"}`,
      who: o.handle || "",
      action: o.action || "Reply",
      why: o.summary || "",
    });
  }
  ok("Text opportunities", ops.length);
  return ops;
}

// ================= SOURCE D: Pipelines (trackers) =================
function fromTrackers() {
  const ops = [];

  // MASC loans — money owed (e.g. HHH3 payoff in progress).
  try {
    const f = join(TRACKERS, "masc-loans.md");
    if (existsSync(f)) {
      const t = readFileSync(f, "utf8");
      const re = /###\s+(.+?)\n([\s\S]*?)(?=\n###|\n##\s|$)/g;
      let m;
      while ((m = re.exec(t))) {
        const head = m[1].trim(), body = m[2];
        const open = /status:\*\*\s*OPEN|payoff in progress|awaiting/i.test(body) ||
          /payoff/i.test(head);
        if (!open) continue;
        const due = body.match(/payoff due\**\s*\$?([\d,]+)/i) ||
          body.match(/\$([\d,]+)\b/);
        ops.push({
          source: "MASC", stage: "owed", urgent: true,
          amount: due ? num(due[1].replace(/,/g, "")) : null,
          title: `MASC payoff: ${head}`,
          who: head,
          action: "Confirm ledger + refresh good-through; collect on clearance",
          why: "Payoff in progress — money owed to MASC.",
        });
      }
    }
  } catch (e) { warn("masc-loans", e); }

  // Wholesaler pipeline — Tier 1 PROVEN/WARM contacts worth re-engaging for deals.
  try {
    const f = join(TRACKERS, "wholesaler-pipeline.md");
    if (existsSync(f)) {
      const t = readFileSync(f, "utf8");
      const tier1 = t.split(/## Tier 2/)[0]; // proven + warm inbound block
      for (const line of tier1.split("\n")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length < 4) continue;
        const tier = cells.find((c) => /^(PROVEN|WARM)$/.test(c));
        if (!tier) continue;
        const src = cells[0].replace(/\*\*/g, "");
        if (/^source$/i.test(src)) continue;
        ops.push({
          source: "Wholesaler", stage: tier === "PROVEN" ? "closing" : "nurture",
          amount: null, urgent: tier === "PROVEN",
          title: `Re-engage wholesaler: ${src}`,
          who: cells[1],
          action: tier === "PROVEN"
            ? "Re-engage — already closed a deal together"
            : "Nudge for current off-market inventory (Sue drafts, Collin approves)",
          why: cells[cells.length - 1].slice(0, 140),
        });
      }
    }
  } catch (e) { warn("wholesaler-pipeline", e); }

  // Services pipeline — any live lead (not the empty placeholder row).
  try {
    const f = join(TRACKERS, "services-pipeline.md");
    if (existsSync(f)) {
      const t = readFileSync(f, "utf8");
      for (const line of t.split("\n")) {
        if (!/^\|/.test(line) || /none yet|^\|\s*#|^\|\s*-+/.test(line)) continue;
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length < 7 || cells[2] === "—" || !cells[2]) continue;
        ops.push({
          source: "Services", stage: "lead", amount: null,
          title: `Service lead: ${cells[2]}`,
          who: cells[2], action: `Advance stage (${cells[3]})`,
          why: cells[7] || "AI services pipeline lead.",
        });
      }
    }
  } catch (e) { warn("services-pipeline", e); }

  ok("Tracker opportunities", ops.length);
  return ops;
}

// ================= render =================
function render(ops) {
  const byStage = { owed: [], closing: [], lead: [], nurture: [] };
  for (const o of ops) (byStage[o.stage] ?? byStage.lead).push(o);

  const totalOwed = ops
    .filter((o) => o.stage === "owed" && o.amount && !o.rollup)
    .reduce((s, o) => s + o.amount, 0);

  const head = {
    owed: "💰 Money owed / cash in motion (collect)",
    closing: "🔥 Ready to close (push)",
    lead: "📥 New leads (qualify)",
    nurture: "🌱 Nurture / re-engage",
  };
  let md = `# Daily Opportunity Report — ${todayISO}\n\n`;
  md += `> Source-to-cash digest · ranked closest-to-cash first · ${ops.length} opportunities`;
  if (totalOwed) md += ` · **${money(totalOwed)} owed/in-motion**`;
  md += `\n\n`;

  for (const stage of ["owed", "closing", "lead", "nurture"]) {
    const list = byStage[stage].sort((a, b) => score(b) - score(a));
    if (!list.length) continue;
    md += `## ${head[stage]}\n\n`;
    for (const o of list) {
      const amt = o.amount ? ` — **${money(o.amount)}**` : "";
      md += `- **[${o.source}] ${o.title}**${amt}\n`;
      md += `  - ▸ ${o.action}\n`;
      if (o.who) md += `  - 👤 ${o.who}\n`;
      if (o.why) md += `  - _${o.why}_\n`;
    }
    md += `\n`;
  }
  md += `---\n_Generated ${now.toISOString()} · read-only · nothing sent or moved._\n`;
  return md;
}

function emailHTML(ops) {
  const top = ops.slice(0, TOP_N).filter((o) => EMAIL_TEXTS || o.source !== "Text");
  const rows = top.map((o) => {
    const amt = o.amount ? ` — ${money(o.amount)}` : "";
    return `<li style="margin:0 0 10px"><b>[${o.source}] ${o.title}</b>${amt}<br>
      <span style="color:#444">▸ ${o.action}</span>
      ${o.who ? `<br><span style="color:#888;font-size:12px">${o.who}</span>` : ""}</li>`;
  }).join("");
  const totalOwed = ops.filter((o) => o.stage === "owed" && o.amount && !o.rollup).reduce((s, o) => s + o.amount, 0);
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">💵 Daily Opportunity Report — ${todayISO}</h2>
    <p style="color:#666;margin:0 0 14px">${ops.length} opportunities, closest-to-cash first${totalOwed ? ` · <b>${money(totalOwed)} owed/in-motion</b>` : ""}.</p>
    <ol style="padding-left:18px">${rows}</ol>
    <p style="color:#999;font-size:12px">Full report in sue/trackers/opportunities/${todayISO}.md · read-only.</p>
  </div>`;
}

// ---- Gmail send (gmail.compose scope; recipient = Collin only) ----
async function gmailToken() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET,
    refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}`);
  return (await r.json()).access_token;
}

async function sendDigest(ops) {
  if (!SEND_EMAIL) { console.log("opp: email send disabled."); return; }
  const token = await gmailToken();
  if (!token) { console.log("opp: Gmail creds absent — skipping email."); return; }
  const subject = `💵 Daily Opportunities — ${todayISO} (${ops.length})`;
  const raw = [
    `To: ${REPORT_TO}`, `From: ${REPORT_TO}`, `Subject: ${subject}`,
    "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "",
    emailHTML(ops),
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${await r.text()}`);
  ok("digest emailed to " + REPORT_TO, 1);
}

// ================= main =================
async function main() {
  const results = await Promise.allSettled([
    fromLendr(), fromEmail(), fromTexts(),
    Promise.resolve(fromTrackers()),
  ]);
  const ops = [];
  for (const r of results) {
    if (r.status === "fulfilled") ops.push(...r.value);
    else warn("source", r.reason);
  }
  ops.sort((a, b) => score(b) - score(a));

  const md = render(ops);
  const dir = join(TRACKERS, "opportunities");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${todayISO}.md`), md);
  writeFileSync(join(TRACKERS, "daily-opportunities-latest.md"), md);
  console.log(`opp: wrote ${ops.length} opportunities → ${join(dir, todayISO + ".md")}`);

  try { await sendDigest(ops); } catch (e) { warn("sendDigest", e); }
}

main().catch((e) => { console.error("opp: fatal", e); process.exit(1); });
