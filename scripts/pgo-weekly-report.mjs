// Jarvis PGO weekly report — headless, credential-based. The property-management
// twin of scripts/lls-monthly-report.mjs. Computes the figures from BigQuery
// (scripts/pgo-bq.mjs), renders a one-page HTML report, converts to PDF via
// Google Drive, drops the PDF in a Drive folder, writes an Obsidian note,
// EMAILS the summary + PDF link to Collin, and records the link in pgo_reports
// so /pgo can surface it.
//
//   BigQuery → PGO_BQ_KEY_PATH / PGO_BQ_BILLING_PROJECT / PGO_BQ_DATASET
//   Google   → GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN  (scopes: drive.file +
//              gmail.compose — compose can both draft AND send)
//   Drive    → GDRIVE_PGO_FOLDER_ID (target folder; falls back to LLS folder)
//   Email    → PGO_REPORT_TO (default collinschwartz1@gmail.com)
//   Supabase → NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Run:  node scripts/pgo-weekly-report.mjs       (cron, Friday PM)

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { gather, arAsOf, gatherAnalysisData, bqReady } from "./pgo-bq.mjs";
import { analyze, aiSummary } from "./pgo-analyze.mjs";

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
const FOLDER = process.env.GDRIVE_PGO_FOLDER_ID || process.env.GDRIVE_LLS_FOLDER_ID;
const MAIL_TO = process.env.PGO_REPORT_TO || "collinschwartz1@gmail.com";
const VAULT_DIR =
  process.env.PGO_VAULT_DIR ||
  "/Users/collinschweattz/Documents/Second Brain/06-Finance/PGO Reports";

if (!SUPA_URL || !SUPA_KEY) { console.error("pgo-report: missing Supabase creds."); process.exit(1); }
if (!bqReady()) { console.error("pgo-report: missing PGO BigQuery creds."); process.exit(1); }

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const usd = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// ISO week id, e.g. 2026-W25
function weekId(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---- Google (token + Drive PDF + Gmail send) ----
async function googleToken() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Google creds absent (need drive.file + gmail.compose).");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

function multipart(metadata, mediaType, media) {
  const boundary = "jarvis_pgo_boundary_x";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`
  );
  const body = Buffer.concat([head, Buffer.from(media), Buffer.from(`\r\n--${boundary}--`)]);
  return { boundary, body };
}

async function htmlToDrivePdf(token, html, name) {
  const docPart = multipart(
    { name: `${name} (tmp)`, mimeType: "application/vnd.google-apps.document" },
    "text/html",
    html
  );
  const docRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${docPart.boundary}` }, body: docPart.body }
  );
  if (!docRes.ok) throw new Error(`drive doc create ${docRes.status}: ${await docRes.text()}`);
  const docId = (await docRes.json()).id;

  const pdfRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!pdfRes.ok) throw new Error(`drive export ${pdfRes.status}: ${await pdfRes.text()}`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());

  const meta = { name: `${name}.pdf`, mimeType: "application/pdf" };
  if (FOLDER) meta.parents = [FOLDER];
  const pdfPart = multipart(meta, "application/pdf", pdf);
  const upRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${pdfPart.boundary}` }, body: pdfPart.body }
  );
  if (!upRes.ok) throw new Error(`drive pdf upload ${upRes.status}: ${await upRes.text()}`);
  const out = await upRes.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  return out;
}

// Send the report as an HTML email to Collin. gmail.compose can send.
async function sendEmail(token, to, subject, html) {
  const raw = [
    `To: ${to}`,
    "Content-Type: text/html; charset=UTF-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    html,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${await r.text()}`);
  return r.json();
}

// ---- report body ----
function buildHtml(f, wow, analysis, ai, driveLink, week) {
  const moM =
    f.noi_prior != null && f.noi_prior !== 0
      ? `${f.noi - f.noi_prior >= 0 ? "▲" : "▼"} ${Math.abs(((f.noi - f.noi_prior) / Math.abs(f.noi_prior)) * 100).toFixed(1)}% vs prior month`
      : "—";
  const wowStr =
    wow == null ? "—" : `${f.ar_total - wow >= 0 ? "▲" : "▼"} ${usd(Math.abs(f.ar_total - wow))} vs last week`;

  const row = (k, v, sub) =>
    `<tr><td style="color:#555">${k}${sub ? `<div style="color:#999;font-size:10px">${sub}</div>` : ""}</td><td style="text-align:right;font-weight:600">${v}</td></tr>`;

  const topNeg = f.properties.filter((p) => p.noi < 0).slice(0, 5);
  const topAR = [...f.properties].filter((p) => p.ar_total > 0).sort((a, b) => b.ar_total - a.ar_total).slice(0, 5);
  const negRows = topNeg
    .map((p) => `<tr><td>${p.property_name || "#" + p.property_id}</td><td style="text-align:right;color:#c0392b">${usd(p.noi)}</td></tr>`)
    .join("") || `<tr><td colspan="2" style="color:#999">None — every property cash-flow positive.</td></tr>`;
  const arRows = topAR
    .map((p) => `<tr><td>${p.property_name || "#" + p.property_id}</td><td style="text-align:right">${usd(p.ar_total)}</td><td style="text-align:right;color:#c0392b">${p.evictions_pending || "—"}</td></tr>`)
    .join("") || `<tr><td colspan="3" style="color:#999">No delinquent balances.</td></tr>`;

  // ---- intelligence sections ----
  const a = analysis || { trends: {}, focus: [], watch: [], wins: [], dueOuts: [] };
  const aiBlock = ai
    ? `<div style="background:#f5f8ff;border:1px solid #d6e2ff;border-radius:6px;padding:14px 16px;margin:14px 0">
         <div style="font-weight:700;font-size:14px;margin-bottom:6px">${ai.headline}</div>
         <ul style="margin:0;padding-left:18px">${ai.bullets.map((b) => `<li style="margin:3px 0">${b}</li>`).join("")}</ul>
       </div>`
    : "";

  const fmtPct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const t = a.trends || {};
  const trendRows = [
    row("NOI vs prior month", fmtPct(t.noi_mom_pct), `direction: ${t.noi_direction || "—"}`),
    row("NOI vs 3-mo average", fmtPct(t.noi_vs_avg3_pct)),
    row("Operating expense ratio", t.opex_ratio == null ? "—" : `${(t.opex_ratio * 100).toFixed(0)}%`, `trend: ${t.opex_ratio_trend || "—"}`),
    row("A/R week-over-week", t.ar_wow == null ? "—" : `${t.ar_wow >= 0 ? "▲" : "▼"} ${usd(Math.abs(t.ar_wow))}`),
    row("A/R as % of monthly income", t.ar_pct_income == null ? "—" : `${t.ar_pct_income.toFixed(1)}%`),
  ].join("");

  const focusRows = a.focus.length
    ? a.focus.map((p) => `<tr><td style="font-weight:600">${p.name}</td><td style="text-align:right">${usd(p.noi)}</td><td style="color:#555;font-size:11px">${p.reasons.join(" · ")}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:#999">Nothing scored into the focus zone this week.</td></tr>`;

  const dueRows = a.dueOuts.length
    ? a.dueOuts.slice(0, 12).map((d) => `<li style="margin:3px 0">${d.text}</li>`).join("")
    : `<li style="color:#999">No open action items flagged.</li>`;

  const watchRows = a.watch.length
    ? a.watch.map((p) => `<tr><td>${p.name}</td><td style="color:#555;font-size:11px">${p.reasons.join(" · ")}</td></tr>`).join("")
    : `<tr><td colspan="2" style="color:#999">Nothing on the early-warning list.</td></tr>`;

  const winRows = a.wins.length
    ? a.wins.map((p) => `<tr><td>${p.name}</td><td style="text-align:right;color:#1a7f37">${usd(p.noi)}</td><td style="text-align:right;color:#1a7f37">▲ ${usd(p.momNoi)} MoM</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:#999">—</td></tr>`;

  const intel = `
    <h2>Executive Summary</h2>
    ${aiBlock || '<div style="color:#999">AI summary unavailable this run — see the computed sections below.</div>'}

    <h2>Focus This Week</h2>
    <table><tr><th>Property</th><th style="text-align:right">NOI</th><th>Why it's flagged</th></tr>${focusRows}</table>

    <h2>Due-Outs · Action Items</h2>
    <ul style="margin:6px 0;padding-left:18px">${dueRows}</ul>

    <h2>Trends</h2>
    <table>${trendRows}</table>

    <h2>Watch List · Early Warning</h2>
    <table><tr><th>Property</th><th>Signal</th></tr>${watchRows}</table>

    <h2>Wins · Improving</h2>
    <table><tr><th>Property</th><th style="text-align:right">NOI</th><th style="text-align:right">Change</th></tr>${winRows}</table>
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:40px;font-size:13px}
    h1{font-size:22px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;color:#1f6feb;border-bottom:2px solid #eee;padding-bottom:4px}
    .sub{color:#777;margin-bottom:8px} table{width:100%;border-collapse:collapse}
    td,th{padding:5px 2px;border-bottom:1px solid #f0f0f0;text-align:left}
    ul{font-size:13px}
  </style></head><body>
    <h1>Point Guard Omaha — Weekly Portfolio Report</h1>
    <div class="sub">${week} &middot; financials ${f.period} &middot; delinquency ${f.delinquency_date} &middot; generated by Jarvis from Buildium</div>

    ${intel}

    <h2>Portfolio Operating (latest month · ${f.period})</h2>
    <table>
      ${row("Net Operating Income", usd(f.noi), moM)}
      ${row("Income", usd(f.operating_income))}
      ${row("Operating Expense", usd(f.operating_expense))}
      ${row("Properties", f.property_count)}
    </table>

    <h2>Delinquency (as of ${f.delinquency_date})</h2>
    <table>
      ${row("Total delinquent A/R", usd(f.ar_total), wowStr)}
      ${row("0–30 / 31–60 / 61–90 / 90+", `${usd(f.ar_0_30)} / ${usd(f.ar_31_60)} / ${usd(f.ar_61_90)} / ${usd(f.ar_over_90)}`)}
      ${row("Evictions pending", f.evictions_pending)}
      ${row("Notices given", f.notices_given)}
    </table>

    <h2>Negative-NOI Properties (top 5)</h2>
    <table><tr><th>Property</th><th style="text-align:right">NOI</th></tr>${negRows}</table>

    <h2>Highest Delinquency (top 5)</h2>
    <table><tr><th>Property</th><th style="text-align:right">A/R</th><th style="text-align:right">Evict</th></tr>${arRows}</table>

    ${driveLink ? `<p style="margin-top:18px"><a href="${driveLink}">Open PDF in Drive →</a></p>` : ""}
    <div style="margin-top:24px;color:#999;font-size:10px">
      Confidential — internal use. Figures computed live from Buildium (BigQuery) at generation time.
      Recurring charges (rent roll) pending data access.
    </div>
  </body></html>`;
}

function buildMarkdown(f, wow, driveLink, week) {
  const r = (k, v) => `| ${k} | ${v} |`;
  return `---
type: pgo-weekly-report
week: ${week}
period: ${f.period}
generated: ${new Date().toISOString().slice(0, 10)}
noi: ${Math.round(f.noi)}
income: ${Math.round(f.operating_income)}
expense: ${Math.round(f.operating_expense)}
ar_total: ${Math.round(f.ar_total)}
evictions: ${f.evictions_pending}
property_count: ${f.property_count}
tags: [pgo, property-management, weekly-report]
---

# Point Guard Omaha — Weekly Portfolio Report · ${week}

> Auto-generated by Jarvis from Buildium (BigQuery).${driveLink ? ` [PDF in Drive](${driveLink})` : ""}

## Portfolio Operating (${f.period})
| Metric | Value |
| --- | --- |
${r("Net Operating Income", usd(f.noi))}
${r("Income", usd(f.operating_income))}
${r("Operating Expense", usd(f.operating_expense))}
${r("Properties", f.property_count)}

## Delinquency (${f.delinquency_date})
| Metric | Value |
| --- | --- |
${r("Total delinquent A/R", usd(f.ar_total))}
${r("Week-over-week", wow == null ? "—" : usd(f.ar_total - wow))}
${r("90+ days", usd(f.ar_over_90))}
${r("Evictions pending", f.evictions_pending)}
${r("Notices given", f.notices_given)}

*Confidential — internal use. Recurring charges (rent roll) pending data access.*
`;
}

function writeVaultNote(md, week) {
  try {
    mkdirSync(VAULT_DIR, { recursive: true });
    const path = join(VAULT_DIR, `${week} - PGO Weekly Report.md`);
    writeFileSync(path, md, "utf8");
    console.log(`pgo-report: Obsidian note → ${path}`);
    return path;
  } catch (e) {
    console.error("pgo-report: vault write failed:", e.message);
    return null;
  }
}

async function main() {
  const week = weekId();
  const f = await gather();
  const wow = await arAsOf(7).catch(() => null);

  // intelligence layer: deterministic analysis + grounded AI executive summary
  let analysis = null, ai = null;
  try {
    analysis = analyze(f, await gatherAnalysisData());
    ai = await aiSummary(analysis, f);
    console.log(`pgo-report: analysis — ${analysis.counts.focus} focus, ${analysis.counts.dueOuts} due-outs${ai ? "; AI summary ok" : "; AI summary skipped"}.`);
  } catch (e) {
    console.error("pgo-report: analysis failed (non-fatal):", e.message);
  }

  const name = `PGO Weekly Report — ${week}`;
  const html = buildHtml(f, wow, analysis, ai, null, week);

  let drive = { id: null, webViewLink: null };
  let token = null;
  try {
    token = await googleToken();
    drive = await htmlToDrivePdf(token, html, name);
    console.log(`pgo-report: PDF uploaded → ${drive.webViewLink}`);
  } catch (e) {
    console.error("pgo-report: Drive step failed:", e.message);
  }

  // Obsidian note (independent of Drive). Skipped in the cloud (no local vault) —
  // GitHub Actions sets PGO_SKIP_VAULT=1. The Drive PDF + email cover the cloud run.
  if (process.env.PGO_SKIP_VAULT === "1") {
    console.log("pgo-report: PGO_SKIP_VAULT set — skipping Obsidian note (cloud run).");
  } else {
    writeVaultNote(buildMarkdown(f, wow, drive.webViewLink, week), week);
  }

  // Email Collin the report (HTML body includes the Drive link if present).
  try {
    if (!token) token = await googleToken();
    const emailHtml = buildHtml(f, wow, analysis, ai, drive.webViewLink, week);
    const subj = ai && ai.headline
      ? `PGO Weekly (${week}) — ${ai.headline}`.slice(0, 140)
      : `PGO Weekly — NOI ${usd(f.noi)}, A/R ${usd(f.ar_total)} (${week})`;
    await sendEmail(token, MAIL_TO, subj, emailHtml);
    console.log(`pgo-report: emailed → ${MAIL_TO}`);
  } catch (e) {
    console.error("pgo-report: email step failed:", e.message);
  }

  const { error } = await db.from("pgo_reports").upsert(
    { period: week, drive_file_id: drive.id, web_view_link: drive.webViewLink, title: name, generated_at: new Date().toISOString() },
    { onConflict: "period" }
  );
  if (error) console.error("pgo-report: upsert error", error.message);
  else console.log(`pgo-report: recorded ${week}.`);
}

main().catch((e) => {
  console.error("pgo-report: fatal", e);
  process.exit(1);
});
