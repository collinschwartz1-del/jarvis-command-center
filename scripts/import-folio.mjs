// FolioExcel portfolio import (PGO).
//
// FolioExcel (app.folioexcel.com/company/pgo/financials) has no API, so this is
// the bridge: you export the financials to CSV, drop the file in the dropzone,
// and run this. It upserts every property row into the `properties` table and
// regenerates a markdown portfolio summary in the Jarvis file brain.
//
//   npm run import-folio                 # reads the default dropzone CSV
//   npm run import-folio -- /path/to.csv # or pass an explicit path
//
// Default dropzone:  $JARVIS_DIR/jarvis/state/portfolio/folio-export.csv
// Writes summary to: $JARVIS_DIR/jarvis/state/portfolio-summary.md
//
// Dependency-free: parses CSV directly. If Folio gives you .xlsx, open it and
// "Save As / Export → CSV" first (the file brain only needs the values).
//
// Column mapping is heuristic (see HEADER_MAP). Unmapped columns are preserved
// verbatim in the `raw` jsonb column, so no data is ever dropped — once we see
// a real export we tighten the map without needing to re-export.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- env (standalone node doesn't auto-read .env.local) ---
function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JARVIS = process.env.JARVIS_DIR;
if (!URL || !KEY || !JARVIS) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or JARVIS_DIR");
  process.exit(1);
}

const COMPANY = process.env.FOLIO_COMPANY || "pgo";
const csvPath =
  process.argv[2] || join(JARVIS, "jarvis", "state", "portfolio", "folio-export.csv");

if (!existsSync(csvPath)) {
  console.error(`\nNo export found at:\n  ${csvPath}\n`);
  console.error("Export the Folio financials to CSV and drop it there (or pass a path),");
  console.error("then re-run.  npm run import-folio -- /path/to/export.csv\n");
  process.exit(1);
}

// --- minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  text = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// canonical column -> accepted header aliases (normalized)
const HEADER_MAP = {
  name:                 ["name", "property", "propertyname", "asset", "assetname"],
  address:              ["address", "streetaddress", "propertyaddress"],
  city:                 ["city"],
  state:                ["state", "st"],
  zip:                  ["zip", "zipcode", "postalcode"],
  asset_type:           ["assettype", "type", "category"],
  status:               ["status", "ownershipstatus"],
  units:                ["units", "unitcount", "doors", "numunits", "ofunits"],
  as_of_date:           ["asof", "asofdate", "period", "periodend", "date", "reportdate", "month"],
  occupancy:            ["occupancy", "occupancypct", "occupancyrate", "occ", "physicaloccupancy"],
  gross_potential_rent: ["grosspotentialrent", "gpr", "potentialrent", "grossrent", "scheduledrent"],
  actual_revenue:       ["actualrevenue", "revenue", "totalrevenue", "income", "totalincome", "effectivegrossincome", "egi"],
  operating_expenses:   ["operatingexpenses", "opex", "expenses", "totalexpenses", "totaloperatingexpenses"],
  noi:                  ["noi", "netoperatingincome"],
  debt_service:         ["debtservice", "mortgage", "loanpayment", "totaldebtservice", "annualdebtservice"],
  cash_flow:            ["cashflow", "netcashflow", "cashflowafterdebt", "cfads"],
  market_value:         ["marketvalue", "value", "currentvalue", "appraisedvalue", "estimatedvalue"],
  loan_balance:         ["loanbalance", "debt", "mortgagebalance", "outstandingloan", "principalbalance", "loanamount"],
  equity:               ["equity", "ownerequity", "netequity"],
  cap_rate:             ["caprate", "cap", "capitalizationrate"],
  dscr:                 ["dscr", "debtcoverageratio", "dcr"],
  ownership_pct:        ["ownershippct", "ownership", "ownershippercent", "share", "ownershipshare"],
  notes:                ["notes", "note", "comments", "comment"],
};

// invert for lookup
const ALIAS = {};
for (const [canon, aliases] of Object.entries(HEADER_MAP))
  for (const a of aliases) ALIAS[a] = canon;

const NUMERIC = new Set([
  "units", "occupancy", "gross_potential_rent", "actual_revenue",
  "operating_expenses", "noi", "debt_service", "cash_flow", "market_value",
  "loan_balance", "equity", "cap_rate", "dscr", "ownership_pct",
]);

function toNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"); // (1,234) -> -1234
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// --- parse the export ---
const rows = parseCSV(readFileSync(csvPath, "utf8"));
if (rows.length < 2) { console.error("Export has no data rows."); process.exit(1); }

const headers = rows[0];
const mappedCanon = headers.map((h) => ALIAS[norm(h)] || null);
const unmapped = headers.filter((h, i) => !mappedCanon[i]);

const records = [];
for (const r of rows.slice(1)) {
  const rec = { folio_company: COMPANY, source: "folioexcel", raw: {} };
  headers.forEach((h, i) => {
    const val = (r[i] ?? "").trim();
    rec.raw[h] = val;
    const canon = mappedCanon[i];
    if (!canon || val === "") return;
    rec[canon] = NUMERIC.has(canon) ? toNumber(val) : val;
  });
  if (!rec.name) continue; // a row with no property name is a total/blank line
  if (rec.equity == null && rec.market_value != null && rec.loan_balance != null)
    rec.equity = rec.market_value - rec.loan_balance;
  records.push(rec);
}

if (!records.length) {
  console.error("Parsed 0 property rows. Check that the export has a 'Name'/'Property' column.");
  process.exit(1);
}

// --- upsert ---
const db = createClient(URL, KEY, { auth: { persistSession: false } });
let ok = 0;
for (const rec of records) {
  const { error } = await db
    .from("properties")
    .upsert(rec, { onConflict: "folio_company,name,as_of_date" });
  if (error) console.error(`  ${rec.name}:`, error.message);
  else ok++;
}

// --- regenerate the file-brain summary from the DB rollup ---
const fmtMoney = (n) =>
  n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US");
const fmtPct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

const { data: sum } = await db
  .from("portfolio_summary")
  .select("*")
  .eq("folio_company", COMPANY)
  .single();
const { data: props } = await db
  .from("properties")
  .select("name, units, occupancy, market_value, loan_balance, equity, noi, cash_flow, as_of_date")
  .eq("folio_company", COMPANY)
  .order("market_value", { ascending: false, nullsFirst: false });

const today = new Date().toISOString().slice(0, 10);
let md = `# PGO Portfolio Summary\n\n`;
md += `> Source: FolioExcel (app.folioexcel.com/company/${COMPANY}/financials). `;
md += `Auto-generated by \`npm run import-folio\` — do not hand-edit; re-import to refresh.\n`;
md += `> Last import: ${today}. Latest reporting period: ${sum?.latest_as_of ?? "n/a"}.\n\n`;
if (sum) {
  md += `## Portfolio totals\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Properties | ${sum.property_count} |\n`;
  md += `| Total units | ${sum.total_units} |\n`;
  md += `| Avg occupancy | ${fmtPct(sum.avg_occupancy)} |\n`;
  md += `| Total market value | ${fmtMoney(sum.total_value)} |\n`;
  md += `| Total debt | ${fmtMoney(sum.total_debt)} |\n`;
  md += `| Total equity | ${fmtMoney(sum.total_equity)} |\n`;
  md += `| Total NOI | ${fmtMoney(sum.total_noi)} |\n`;
  md += `| Total cash flow | ${fmtMoney(sum.total_cash_flow)} |\n`;
  md += `| Portfolio cap rate | ${sum.portfolio_cap_rate ?? "—"}% |\n\n`;
}
md += `## Properties (${props?.length ?? 0})\n\n`;
md += `| Property | Units | Occ | Value | Debt | Equity | NOI | Cash flow |\n`;
md += `|---|--:|--:|--:|--:|--:|--:|--:|\n`;
for (const p of props ?? []) {
  md += `| ${p.name} | ${p.units ?? "—"} | ${fmtPct(p.occupancy)} | ${fmtMoney(p.market_value)} | ${fmtMoney(p.loan_balance)} | ${fmtMoney(p.equity)} | ${fmtMoney(p.noi)} | ${fmtMoney(p.cash_flow)} |\n`;
}
md += `\n`;
if (unmapped.length) {
  md += `> Unmapped export columns (preserved in \`properties.raw\`, not yet summarized): `;
  md += unmapped.map((h) => `\`${h}\``).join(", ") + `.\n`;
}

const outPath = join(JARVIS, "jarvis", "state", "portfolio-summary.md");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md);

await db.from("activity").insert({
  actor: "import-folio",
  kind: "portfolio_import",
  ref_table: "properties",
  summary: `Imported ${ok}/${records.length} PGO properties from Folio export; regenerated portfolio-summary.md`,
});

console.log(`✅ Imported ${ok}/${records.length} properties into the command center.`);
console.log(`   Mapped columns: ${mappedCanon.filter(Boolean).length}/${headers.length}.`);
if (unmapped.length) console.log(`   Unmapped (kept in raw): ${unmapped.join(", ")}`);
console.log(`   Summary written: ${outPath}`);
