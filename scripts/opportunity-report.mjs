// Jarvis DAILY ACQUISITION OPPORTUNITY REPORT — "source to cash" deal flow.
//
// Compiles ONLY properties & businesses to PURCHASE or REFINANCE into one
// ranked report, closest-to-cash first. This is an acquisition pipeline, not a
// collections report — it does NOT surface LLS loan repayments/payoffs (that is
// money coming back to the fund, not a deal to acquire). LLS can be re-enabled
// with OPP_INCLUDE_LLS=1 if ever wanted.
//
//   Email   → deal_analyses (property deals flagged by intel.mjs) + email_briefs
//             filtered to acquisition / refinance / business-for-sale intent.
//   Texts   → chat.db (last 24h inbound) scanned by a LOCAL Ollama model for
//             property/business for-sale & refi signals. Raw text NEVER leaves
//             the Mac — only distilled opportunity flags are kept.
//   Sources → sue/trackers wholesaler pipeline: off-market inventory sources.
//
// Ranking (closest-to-cash first):
//   ready     docs/financials in hand → underwrite / make an offer now
//   qualified identified deal, needs a couple data points
//   new       raw inbound lead to qualify
//   source    a channel to work for inventory (wholesalers)
//
// Output:
//   1. Dated markdown → sue/trackers/opportunities/YYYY-MM-DD.md (+ -latest.md)
//   2. Emailed digest of the top items to Collin (his own inbox; never others).
//
// NEVER sends to a third party, replies, or moves money. Read + summarize only.
//
// Run:  node scripts/opportunity-report.mjs
// Cron: called by morning-board.sh after intel.mjs + sync.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
const EMAIL_TEXTS = process.env.OPP_EMAIL_TEXTS !== "0";
const SEND_EMAIL = process.env.OPP_SEND_EMAIL !== "0";
const INCLUDE_LLS = process.env.OPP_INCLUDE_LLS === "1"; // off by default
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
const money = (n) => (n == null ? "" : "$" + Math.round(n).toLocaleString("en-US"));
const daysFromNow = (d) => Math.round((new Date(d) - now) / DAY);

// Acquisition stages, ranked closest-to-cash first.
const STAGE = { ready: 400, qualified: 300, new: 200, source: 100 };
// kind: "property" | "business" | "refi"  → icon for the report
const ICON = { property: "🏢", business: "🏬", refi: "🔄" };
// op = { source, stage, kind, title, who, amount, action, why, local?, urgent? }
function score(op) {
  let s = STAGE[op.stage] ?? 100;
  if (op.urgent) s += 50;
  if (op.amount) s += Math.min(99, Math.log10(op.amount + 1) * 16); // $ tiebreak
  return s;
}

const ok = (label, n) => console.log(`opp: ${label}: ${n}`);
const warn = (label, e) => console.error(`opp: ${label} failed — ${e?.message || e}`);

// Intent matchers — what counts as a thing to BUY or REFINANCE.
const ACQ_RE = /(for sale|off[- ]?market|wholesale|seller financ|owner financ|assignment|under contract|listing|cap rate|noi|multifamily|duplex|tri-?plex|four-?plex|apartment|portfolio|land deal|business for sale|acquire|acquisition|buy box|distressed|value-?add|deal flow|pocket listing)/i;
const REFI_RE = /(refinance|refi|cash[- ]?out|recapitaliz|rate-?and-?term|bridge to perm|take-?out loan|new debt|loan maturing.*refi)/i;
const BIZ_RE = /(business for sale|acquire (a |the )?business|buy(ing)? a (company|business)|SaaS for sale|book of business|seller'?s discretionary|SDE|EBITDA multiple|main street|roll-?up)/i;
// Exclude money-MOVING noise that isn't a thing to acquire: a loan being paid
// off, wire-verification, lien releases. These are collections/ops, not deals.
const EXCLUDE_RE = /(payoff|wire[- ]?verify|wire instruction|wire fraud|remittance|lien release|satisfaction of (mortgage|note)|good-?through|per-?diem)/i;

// ================= SOURCE: Email (deal flags + acquisition/refi intent) =====
async function fromEmail() {
  const ops = [];
  if (!db) { console.log("opp: Supabase absent — skipping email."); return ops; }
  const sinceISO = new Date(now - 2 * DAY).toISOString();

  // deal_analyses = real-estate deals flagged by intel.mjs → properties to buy.
  try {
    const { data } = await db
      .from("deal_analyses")
      .select("deal_name,address,asset_type,units,price,docs_status,questions,person_email,created_at")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false });
    for (const d of data || []) {
      // Skip payoffs / wire-verify items — those are repayments, not acquisitions.
      if (EXCLUDE_RE.test([d.deal_name, d.address, (d.questions || []).join(" ")].filter(Boolean).join(" "))) continue;
      const ready = /attached|complete|received|in hand/i.test(d.docs_status || "");
      ops.push({
        source: "Email", kind: "property",
        stage: ready ? "ready" : "qualified",
        amount: d.price ? num(d.price) : null,
        title: `${d.deal_name || d.address || "(unnamed property)"}`,
        who: d.person_email || "",
        action: ready
          ? "Underwrite / make an offer — docs in hand"
          : `Request financials & qualify (${d.docs_status || "missing financials"})`,
        why: [d.asset_type, d.units ? `${d.units} units` : null, d.address]
          .filter(Boolean).join(" · ") || "Inbound property deal.",
      });
    }
  } catch (e) { warn("deal_analyses", e); }

  // email_briefs filtered to acquisition / refinance / business-for-sale intent.
  try {
    const { data } = await db
      .from("email_briefs")
      .select("person_name,person_email,summary,action_items,updated_at")
      .gte("updated_at", sinceISO)
      .order("updated_at", { ascending: false });
    for (const b of data || []) {
      const items = Array.isArray(b.action_items) ? b.action_items : [];
      const text = (b.summary || "") + " " + items.join(" ");
      if (EXCLUDE_RE.test(text)) continue; // payoff / wire-verify ops noise
      const isRefi = REFI_RE.test(text);
      const isBiz = BIZ_RE.test(text);
      const isAcq = ACQ_RE.test(text);
      if (!isRefi && !isBiz && !isAcq) continue; // only purchase/refi intent
      ops.push({
        source: "Email",
        kind: isBiz ? "business" : isRefi ? "refi" : "property",
        stage: "new", amount: null,
        title: `${b.person_name || b.person_email}`,
        who: b.person_email || "",
        action: items[0] || (isRefi ? "Evaluate refinance" : "Qualify the deal"),
        why: (b.summary || "").slice(0, 160),
      });
    }
  } catch (e) { warn("email_briefs", e); }

  ok("Email opportunities", ops.length);
  return ops;
}

// ================= SOURCE: Texts / iMessage (LOCAL ONLY) =====================
// Raw text is read from chat.db and fed ONLY to a local Ollama model. Nothing
// raw is retained or transmitted — only distilled opportunity flags are kept.
async function fromTexts() {
  const ops = [];
  const dbPath = join(HOME, "Library/Messages/chat.db");
  if (!existsSync(dbPath)) { console.log("opp: chat.db absent — skipping texts."); return ops; }

  let rows = [];
  try {
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

  const byHandle = {};
  for (const r of rows) (byHandle[r.handle] ??= []).push(r.text.replace(/\s+/g, " ").trim());
  const compact = Object.entries(byHandle).slice(0, 40).map(([handle, msgs]) => ({
    handle, msgs: msgs.slice(0, 8),
  }));

  const prompt =
`You are a local DEAL-FLOW scanner for a real-estate investor who BUYS and
REFINANCES properties and businesses (multifamily, single-family flips, land,
and operating businesses).

From the inbound texts below (grouped by sender), identify ONLY messages that
are a PROPERTY or BUSINESS to PURCHASE or REFINANCE — e.g. a property for sale,
an off-market/wholesale deal, a seller wanting to sell, a portfolio, a business
for sale, or a refinance/recapitalization opportunity.

IGNORE everything else: loan payments owed, personal chatter, spam, 2FA codes,
notifications, scheduling, and anything not a thing to buy or refinance.

Return STRICT JSON only:
{"opps":[{"handle":"<sender>","kind":"property|business|refi","summary":"<=18 words, no raw quotes","action":"<the next step>"}]}
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
    const kind = ["property", "business", "refi"].includes(o.kind) ? o.kind : "property";
    ops.push({
      source: "Text", stage: "new", kind, amount: null, local: true,
      title: `${o.handle || "unknown"}`,
      who: o.handle || "",
      action: o.action || "Reply & qualify",
      why: o.summary || "",
    });
  }
  ok("Text opportunities", ops.length);
  return ops;
}

// ================= SOURCE: Wholesaler pipeline (inventory channels) ==========
function fromTrackers() {
  const ops = [];
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
          source: "Wholesaler", stage: "source", kind: "property",
          amount: null, urgent: tier === "PROVEN",
          title: `${src}`,
          who: cells[1],
          action: tier === "PROVEN"
            ? "Re-engage for current inventory — already closed a deal together"
            : "Ask for current off-market deals (Sue drafts, Collin approves)",
          why: cells[cells.length - 1].slice(0, 140),
        });
      }
    }
  } catch (e) { warn("wholesaler-pipeline", e); }
  ok("Source-channel opportunities", ops.length);
  return ops;
}

// ================= SOURCE: LLS (OPT-IN ONLY) ================================
async function lendr(path) {
  if (!LENDR_BASE || !LENDR_KEY) return null;
  const r = await fetch(`${LENDR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${LENDR_KEY}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`lendr ${path} ${r.status}`);
  return r.json();
}
async function fromLendr() {
  // Only runs when OPP_INCLUDE_LLS=1. Surfaces pipeline loans needing capital
  // (a deal to fund), not repayments. Kept minimal and opt-in.
  const ops = [];
  if (!INCLUDE_LLS || !LENDR_BASE || !LENDR_KEY) return ops;
  try {
    const loansR = await lendr("/loans");
    const pipeline = (loansR?.data || []).filter((l) =>
      ["new", "underwriting", "preclosing", "clear"].includes(l.status));
    for (const l of pipeline) {
      const who = l.borrower?.name?.full || l.borrower?.name || "borrower";
      ops.push({
        source: "LLS", stage: "qualified", kind: "property", amount: num(l.amount),
        title: `Loan to fund — ${who}`,
        who, action: `Advance underwriting (${l.stage || l.status})`,
        why: `${money(num(l.amount))} loan in ${l.status}${l.address ? ` · ${l.address}` : ""}.`,
      });
    }
  } catch (e) { warn("lendr pipeline", e); }
  ok("LLS pipeline opportunities", ops.length);
  return ops;
}

// ================= render =================
const HEAD = {
  ready: "🔥 Ready to underwrite / offer (docs in hand)",
  qualified: "🎯 Identified deals (qualify & advance)",
  new: "📥 New leads (sellers / refi inquiries)",
  source: "🌱 Inventory channels (work for deals)",
};
function render(ops) {
  const byStage = { ready: [], qualified: [], new: [], source: [] };
  for (const o of ops) (byStage[o.stage] ?? byStage.new).push(o);
  const known = ops.filter((o) => o.amount).reduce((s, o) => s + o.amount, 0);
  const live = ops.filter((o) => o.stage !== "source").length;

  let md = `# Daily Acquisition Opportunities — ${todayISO}\n\n`;
  md += `> Properties & businesses to buy or refinance · ranked closest-to-cash first · ${live} live deal${live === 1 ? "" : "s"}`;
  if (known) md += ` · **${money(known)} in identified deal value**`;
  md += `\n\n`;

  for (const stage of ["ready", "qualified", "new", "source"]) {
    const list = byStage[stage].sort((a, b) => score(b) - score(a));
    if (!list.length) continue;
    md += `## ${HEAD[stage]}\n\n`;
    for (const o of list) {
      const amt = o.amount ? ` — **${money(o.amount)}**` : "";
      md += `- ${ICON[o.kind] || "•"} **[${o.source}] ${o.title}**${amt}\n`;
      md += `  - ▸ ${o.action}\n`;
      if (o.who) md += `  - 👤 ${o.who}\n`;
      if (o.why) md += `  - _${o.why}_\n`;
    }
    md += `\n`;
  }
  md += `---\n_Generated ${now.toISOString()} · acquisition/refi only · read-only._\n`;
  return md;
}

function emailHTML(ops) {
  const top = ops.slice(0, TOP_N).filter((o) => EMAIL_TEXTS || o.source !== "Text");
  const rows = top.map((o) => {
    const amt = o.amount ? ` — ${money(o.amount)}` : "";
    return `<li style="margin:0 0 10px">${ICON[o.kind] || "•"} <b>[${o.source}] ${o.title}</b>${amt}<br>
      <span style="color:#444">▸ ${o.action}</span>
      ${o.who ? `<br><span style="color:#888;font-size:12px">${o.who}</span>` : ""}</li>`;
  }).join("");
  const known = ops.filter((o) => o.amount).reduce((s, o) => s + o.amount, 0);
  const live = ops.filter((o) => o.stage !== "source").length;
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">🏢 Daily Acquisition Opportunities — ${todayISO}</h2>
    <p style="color:#666;margin:0 0 14px">${live} live deal${live === 1 ? "" : "s"} to buy or refinance, closest-to-cash first${known ? ` · <b>${money(known)} identified deal value</b>` : ""}.</p>
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
  const live = ops.filter((o) => o.stage !== "source").length;
  const subject = `🏢 Daily Acquisitions — ${todayISO} (${live} deals)`;
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
    fromEmail(), fromTexts(),
    Promise.resolve(fromTrackers()),
    fromLendr(),
  ]);
  const ops = [];
  for (const r of results) {
    if (r.status === "fulfilled") ops.push(...r.value);
    else warn("source", r.reason);
  }

  // Dedupe by kind + normalized title; keep the nearest-to-cash instance.
  const seen = new Map();
  for (const o of ops.sort((a, b) => score(b) - score(a))) {
    const key = (o.kind || "") + "|" + (o.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, o);
  }
  const deduped = [...seen.values()].sort((a, b) => score(b) - score(a));
  ops.length = 0; ops.push(...deduped);

  const md = render(ops);
  const dir = join(TRACKERS, "opportunities");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${todayISO}.md`), md);
  writeFileSync(join(TRACKERS, "daily-opportunities-latest.md"), md);
  console.log(`opp: wrote ${ops.length} opportunities → ${join(dir, todayISO + ".md")}`);

  try { await sendDigest(ops); } catch (e) { warn("sendDigest", e); }
}

main().catch((e) => { console.error("opp: fatal", e); process.exit(1); });
