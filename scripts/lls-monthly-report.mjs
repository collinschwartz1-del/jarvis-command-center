// Jarvis LLS monthly financial report — headless, credential-based.
//
// Builds a one-page financial-health report for a month, COMPUTED from Lendr's
// raw REST data (/loans, /investors, /payments — there is no aggregated
// dashboard-stats route), renders it to HTML, converts to PDF via Google Drive
// (upload HTML → Drive Doc → export PDF), drops the PDF in a Drive folder, and
// records the link in lls_reports so /lending can surface it.
//
//   Lendr   → LENDR_API_BASE (https://joinlendr.com/api/v1) / LENDR_API_KEY
//   Google  → GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN  (refresh token must
//             include the drive.file scope — re-run gmail-auth with it)
//   Drive   → GDRIVE_LLS_FOLDER_ID (target folder for the PDFs)
//   Supabase→ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Run:  node scripts/lls-monthly-report.mjs            (cron, 1st of month)
//       node scripts/lls-monthly-report.mjs 2026-05    (backfill a month)

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const LENDR_BASE = (process.env.LENDR_API_BASE || "").replace(/\/$/, "");
const LENDR_KEY = process.env.LENDR_API_KEY;
const FOLDER = process.env.GDRIVE_LLS_FOLDER_ID;
// Obsidian: monthly report also written here as Markdown (Collin's pick 2026-06-18).
const VAULT_DIR =
  process.env.LLS_VAULT_DIR ||
  "/Users/collinschweattz/Documents/Second Brain/06-Finance/LLS Reports";
if (!SUPA_URL || !SUPA_KEY) { console.error("lls-report: missing Supabase creds."); process.exit(1); }
if (!LENDR_BASE || !LENDR_KEY) { console.error("lls-report: missing Lendr creds."); process.exit(1); }

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const num = (v) => (v == null || v === "" ? 0 : Number(v));
const usd = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function priorMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const PERIOD = process.argv[2] || priorMonth();

async function lendr(path) {
  const r = await fetch(`${LENDR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${LENDR_KEY}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`lendr ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

// ---- Google Drive (REST + fetch) ----
async function googleToken() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Google creds absent (need drive.file scope).");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

function multipart(metadata, mediaType, media) {
  const boundary = "jarvis_lls_boundary_x";
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

// ---- compute the month's figures from raw Lendr data ----
async function gather(period) {
  const [loansR, investorsR, paymentsR] = await Promise.all([
    lendr("/loans"), lendr("/investors"), lendr("/payments"),
  ]);
  const loans = loansR.data || [];
  const summary = loansR.summary || {};
  const investors = investorsR.data || [];
  const payments = paymentsR.data || [];

  const active = loans.filter((l) => l.status === "active");
  const PIPE = ["new", "underwriting", "preclosing", "clear"];
  const pipeline = loans.filter((l) => PIPE.includes(l.status));

  const cap = investors.reduce(
    (a, i) => ({
      available: a.available + num(i.capital?.available),
      outstanding: a.outstanding + num(i.capital?.outstanding),
      total: a.total + num(i.capital?.total),
    }),
    { available: 0, outstanding: 0, total: 0 }
  );

  // month activity
  const inMonth = (d) => d && String(d).slice(0, 7) === period;
  const originated = loans.filter((l) => inMonth(l.origination_date));
  const collected = payments
    .filter((p) => p.paid_on && inMonth(p.paid_on))
    .reduce((s, p) => s + num(p.total_payment), 0);

  // health
  const activeAmt = active.reduce((s, l) => s + num(l.amount), 0);
  const sumCur = active.reduce((s, l) => s + num(l.current_value), 0);
  const sumArv = active.reduce((s, l) => s + num(l.arv), 0);
  const monthlyInterest = active.reduce((s, l) => s + num(l.amount) * (num(l.rate) / 100) / 12, 0);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const pastMaturity = active.filter((l) => l.maturity_date && new Date(l.maturity_date) < today);

  const byB = {};
  for (const l of active) {
    const nm = (l.borrower?.name && (l.borrower.name.full || l.borrower.name)) || "—";
    byB[nm] = (byB[nm] || 0) + num(l.amount);
  }
  const conc = Object.entries(byB).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    period, cap, summary,
    activeCount: active.length, pipelineCount: pipeline.length, pipelineAmt: pipeline.reduce((s, l) => s + num(l.amount), 0),
    originatedCount: originated.length, originatedAmt: originated.reduce((s, l) => s + num(l.amount), 0),
    collected, monthlyInterest, activeAmt,
    ltv: sumCur > 0 ? (activeAmt / sumCur) * 100 : null,
    arltv: sumArv > 0 ? (activeAmt / sumArv) * 100 : null,
    pastMaturityCount: pastMaturity.length, pastMaturityAmt: pastMaturity.reduce((s, l) => s + num(l.amount), 0),
    uniqueBorrowers: new Set(active.map((l) => l.borrower?.id).filter(Boolean)).size,
    conc,
  };
}

function buildHtml(f) {
  const [y, m] = f.period.split("-");
  const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const row = (k, v) => `<tr><td style="color:#555">${k}</td><td style="text-align:right;font-weight:600">${v}</td></tr>`;
  const conc = f.conc
    .map(([nm, v]) => `<tr><td>${nm}</td><td style="text-align:right">${usd(v)}</td><td style="text-align:right">${f.activeAmt ? ((v / f.activeAmt) * 100).toFixed(1) : "0"}%</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:40px;font-size:13px}
    h1{font-size:22px;margin:0 0 2px} h2{font-size:14px;margin:24px 0 8px;color:#b8860b;border-bottom:2px solid #eee;padding-bottom:4px}
    .sub{color:#777;margin-bottom:8px} table{width:100%;border-collapse:collapse}
    td{padding:5px 2px;border-bottom:1px solid #f0f0f0}
  </style></head><body>
    <h1>Liquid Lending Solutions — Financial Health</h1>
    <div class="sub">${label} &middot; generated by Jarvis from Lendr</div>

    <h2>Capital</h2>
    <table>
      ${row("Total fund", usd(f.cap.total))}
      ${row("Deployed (outstanding)", usd(f.cap.outstanding))}
      ${row("Available to deploy", usd(f.cap.available))}
      ${row("Outstanding principal (loans)", usd(f.summary.total_outstanding_principal_balance))}
    </table>

    <h2>${label} Activity</h2>
    <table>
      ${row("Gross monthly interest (active book)", usd(f.monthlyInterest))}
      ${row("Originations — count", f.originatedCount)}
      ${row("Originations — volume", usd(f.originatedAmt))}
      ${row("Pipeline awaiting approval", `${f.pipelineCount} · ${usd(f.pipelineAmt)}`)}
    </table>

    <h2>Portfolio Health</h2>
    <table>
      ${row("Active loans", f.activeCount)}
      ${row("Unique borrowers (active)", f.uniqueBorrowers)}
      ${row("Portfolio LTV", f.ltv == null ? "—" : `${f.ltv.toFixed(1)}%`)}
      ${row("Portfolio ARLTV", f.arltv == null ? "—" : `${f.arltv.toFixed(1)}%`)}
      ${row("Past-maturity (holdover)", `${f.pastMaturityCount} · ${usd(f.pastMaturityAmt)}`)}
    </table>

    <h2>Top Borrower Concentration</h2>
    <table>${conc || "<tr><td>—</td></tr>"}</table>

    <div style="margin-top:30px;color:#999;font-size:10px">
      Confidential — internal use. Figures computed live from Lendr at generation time.
    </div>
  </body></html>`;
}

// Obsidian note: same figures as the PDF, with Dataview-friendly frontmatter
// and a link to the archived Drive PDF.
function buildMarkdown(f, driveLink) {
  const [y, m] = f.period.split("-");
  const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const r = (k, v) => `| ${k} | ${v} |`;
  const conc = f.conc
    .map(([nm, v]) => `| ${nm} | ${usd(v)} | ${f.activeAmt ? ((v / f.activeAmt) * 100).toFixed(1) : "0"}% |`)
    .join("\n");
  return `---
type: lls-monthly-report
period: ${f.period}
generated: ${new Date().toISOString().slice(0, 10)}
fund_total: ${Math.round(f.cap.total)}
deployed: ${Math.round(f.cap.outstanding)}
available: ${Math.round(f.cap.available)}
active_loans: ${f.activeCount}
monthly_interest: ${Math.round(f.monthlyInterest)}
portfolio_ltv: ${f.ltv == null ? "" : f.ltv.toFixed(1)}
past_maturity_count: ${f.pastMaturityCount}
tags: [lls, finance, monthly-report]
---

# Liquid Lending Solutions — Financial Health · ${label}

> Auto-generated by Jarvis from Lendr.${driveLink ? ` [PDF in Drive](${driveLink})` : ""}

## Capital
| Metric | Value |
| --- | --- |
${r("Total fund", usd(f.cap.total))}
${r("Deployed (outstanding)", usd(f.cap.outstanding))}
${r("Available to deploy", usd(f.cap.available))}
${r("Outstanding principal (loans)", usd(f.summary.total_outstanding_principal_balance))}

## ${label} Activity
| Metric | Value |
| --- | --- |
${r("Gross monthly interest (active book)", usd(f.monthlyInterest))}
${r("Originations — count", f.originatedCount)}
${r("Originations — volume", usd(f.originatedAmt))}
${r("Pipeline awaiting approval", `${f.pipelineCount} · ${usd(f.pipelineAmt)}`)}

## Portfolio Health
| Metric | Value |
| --- | --- |
${r("Active loans", f.activeCount)}
${r("Unique borrowers (active)", f.uniqueBorrowers)}
${r("Portfolio LTV", f.ltv == null ? "—" : `${f.ltv.toFixed(1)}%`)}
${r("Portfolio ARLTV", f.arltv == null ? "—" : `${f.arltv.toFixed(1)}%`)}
${r("Past-maturity (holdover)", `${f.pastMaturityCount} · ${usd(f.pastMaturityAmt)}`)}

## Top Borrower Concentration
| Borrower | Outstanding | % of book |
| --- | --- | --- |
${conc || "| — | — | — |"}

*Confidential — internal use. Figures computed live from Lendr at generation time.*
`;
}

function writeVaultNote(f, driveLink) {
  try {
    mkdirSync(VAULT_DIR, { recursive: true });
    const path = join(VAULT_DIR, `${f.period} - LLS Financial Health.md`);
    writeFileSync(path, buildMarkdown(f, driveLink), "utf8");
    console.log(`lls-report: Obsidian note written → ${path}`);
    return path;
  } catch (e) {
    console.error("lls-report: vault write failed:", e.message);
    return null;
  }
}

async function main() {
  const f = await gather(PERIOD);
  const html = buildHtml(f);
  const name = `LLS Financial Health — ${PERIOD}`;

  let drive = { id: null, webViewLink: null };
  try {
    const token = await googleToken();
    drive = await htmlToDrivePdf(token, html, name);
    console.log(`lls-report: PDF uploaded → ${drive.webViewLink}`);
  } catch (e) {
    console.error("lls-report: Drive step failed:", e.message);
  }

  // Obsidian note (independent of Drive — written even if the PDF step failed).
  writeVaultNote(f, drive.webViewLink);

  const { error } = await db.from("lls_reports").upsert(
    { period: PERIOD, drive_file_id: drive.id, web_view_link: drive.webViewLink, title: name, generated_at: new Date().toISOString() },
    { onConflict: "period" }
  );
  if (error) console.error("lls-report: upsert error", error.message);
  else console.log(`lls-report: recorded ${PERIOD}.`);
}

main().catch((e) => {
  console.error("lls-report: fatal", e);
  process.exit(1);
});
