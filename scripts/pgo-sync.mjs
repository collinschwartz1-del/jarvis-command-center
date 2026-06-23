// Jarvis PGO sync — queries BigQuery (via scripts/pgo-bq.mjs), computes the
// portfolio snapshot + per-property rollup, and upserts the pgo_* tables that
// app/pgo reads. Run on a schedule (see scripts/pgo-cron.sh). The dashboard
// never queries BigQuery itself — it reads this cache, so it works on Vercel
// where the SA key file doesn't exist (same pattern as lls-sync).
//
//   BigQuery → PGO_BQ_KEY_PATH / PGO_BQ_BILLING_PROJECT / PGO_BQ_DATASET
//   Supabase → NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Run:  node scripts/pgo-sync.mjs

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { gather, bqReady } from "./pgo-bq.mjs";

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
if (!SUPA_URL || !SUPA_KEY) { console.error("pgo-sync: missing Supabase creds."); process.exit(1); }
if (!bqReady()) { console.error("pgo-sync: missing PGO BigQuery creds."); process.exit(1); }

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

async function main() {
  console.log("pgo-sync: querying BigQuery…");
  const f = await gather();
  console.log(
    `pgo-sync: period ${f.period} · ${f.property_count} properties · NOI ${Math.round(f.noi).toLocaleString()} · A/R ${Math.round(f.ar_total).toLocaleString()} · ${f.evictions_pending} evictions`
  );

  // 1 — snapshot (append-only time series)
  const { error: snapErr } = await db.from("pgo_snapshot").insert({
    period: f.period,
    property_count: f.property_count,
    operating_income: f.operating_income,
    operating_expense: f.operating_expense,
    noi: f.noi,
    noi_prior: f.noi_prior,
    ar_total: f.ar_total,
    ar_0_30: f.ar_0_30,
    ar_31_60: f.ar_31_60,
    ar_61_90: f.ar_61_90,
    ar_over_90: f.ar_over_90,
    evictions_pending: f.evictions_pending,
    notices_given: f.notices_given,
    delinquency_date: f.delinquency_date,
    raw: { trend: f.trend, properties: f.properties, recurring_charges_available: f.recurring_charges_available },
  });
  if (snapErr) { console.error("pgo-sync: snapshot insert error", snapErr.message); process.exit(1); }

  // 2 — per-property (upsert latest)
  const rows = f.properties.map((p) => ({
    property_id: p.property_id,
    property_name: p.property_name,
    period: f.period,
    operating_income: p.income,
    operating_expense: p.expense,
    noi: p.noi,
    ar_total: p.ar_total,
    ar_over_90: p.ar_over_90,
    evictions_pending: p.evictions_pending,
    units_delinquent: p.units_delinquent,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error: propErr } = await db.from("pgo_properties").upsert(rows, { onConflict: "property_id" });
    if (propErr) { console.error("pgo-sync: properties upsert error", propErr.message); process.exit(1); }
  }

  console.log(`pgo-sync: done — snapshot + ${rows.length} properties cached.`);
}

main().catch((e) => {
  console.error("pgo-sync: fatal", e);
  process.exit(1);
});
