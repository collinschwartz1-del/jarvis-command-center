// Shared BigQuery query + compute layer for PGO (Point Guard Omaha).
// Used by scripts/pgo-sync.mjs (caches to Supabase) and
// scripts/pgo-weekly-report.mjs (renders the weekly report). Keep the figures
// computed here so both surfaces always agree.
//
// Source: live Buildium export in BigQuery, authorized views under
//   api-data-pull-492404.pgo_shared   (read via Collin's Jarvis SA, jobs billed
//   to crypto-lodge-499921-h9). The SA key is local-only.
//
// Env (.env.local):
//   PGO_BQ_KEY_PATH         path to the service-account JSON
//   PGO_BQ_BILLING_PROJECT  project that runs/bills the queries (crypto-lodge…)
//   PGO_BQ_DATASET          fully-qualified dataset 'api-data-pull-492404.pgo_shared'
//
// NOI convention: operating only. income = SUM(total_amount WHERE
// t12_section='income'); expense = SUM(... t12_section='expense'); NOI = income
// - expense. non_operating_income / non_operating_expense are excluded.

import { BigQuery } from "@google-cloud/bigquery";

// Env is read lazily (at call time), NOT at module load — the importing script
// calls loadEnv() in its body, which runs *after* this module is evaluated.
const env = () => ({
  KEY: process.env.PGO_BQ_KEY_PATH,
  BILLING: process.env.PGO_BQ_BILLING_PROJECT,
  DATASET: process.env.PGO_BQ_DATASET, // 'api-data-pull-492404.pgo_shared'
});

export function bqReady() {
  const { KEY, BILLING, DATASET } = env();
  return !!(KEY && BILLING && DATASET);
}

function client() {
  const { KEY, BILLING } = env();
  if (!bqReady()) {
    throw new Error(
      "PGO BigQuery not configured (PGO_BQ_KEY_PATH / PGO_BQ_BILLING_PROJECT / PGO_BQ_DATASET)."
    );
  }
  return new BigQuery({ keyFilename: KEY, projectId: BILLING });
}

// Fully-qualified view reference, backtick-quoted for Standard SQL.
function view(name) {
  return "`" + `${env().DATASET}.${name}` + "`";
}

async function q(sql) {
  const [rows] = await client().query({ query: sql, location: "US" });
  return rows;
}

const num = (v) => (v == null ? 0 : Number(v));

// Richer pulls for the intelligence layer (scripts/pgo-analyze.mjs):
//   - per-property monthly NOI history (trend / declining detection)
//   - per-property per-account operating expense by month (category spike detection)
//   - delinquency at lease grain, current snapshot + ~7 days prior (escalation deltas)
// Operating-only throughout (t12_section income/expense) — CapEx excluded by design.
export async function gatherAnalysisData() {
  const fin = view("financial_snapshots");
  const del = view("delinquency_snapshots");

  // 1 — NOI history per property, last 6 months
  const noiHistory = await q(`
    SELECT property_id, snapshot_month AS month,
           ROUND(SUM(IF(t12_section='income',  total_amount, 0))) AS income,
           ROUND(SUM(IF(t12_section='expense', total_amount, 0))) AS expense
    FROM ${fin}
    WHERE snapshot_month >= FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
    GROUP BY property_id, month
    ORDER BY property_id, month
  `);

  // 2 — operating expense by property + account, last 4 months (spike detection)
  const expenseRows = await q(`
    SELECT property_id, ANY_VALUE(property_name) AS property_name,
           account_name, snapshot_month AS month, ROUND(SUM(total_amount)) AS amt
    FROM ${fin}
    WHERE t12_section='expense'
      AND snapshot_month >= FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 4 MONTH))
    GROUP BY property_id, account_name, month
  `);

  // 3 — delinquency at lease grain: current snapshot + the snapshot ~7 days prior
  const [dates] = await q(`
    SELECT CAST(MAX(snapshot_date) AS STRING) AS cur,
           CAST((SELECT MAX(snapshot_date) FROM ${del}
                 WHERE snapshot_date <= DATE_SUB((SELECT MAX(snapshot_date) FROM ${del}), INTERVAL 7 DAY)) AS STRING) AS prior
    FROM ${del}
  `);
  const leaseCols = `lease_id, property_id, total_balance,
    balance_over_90_days AS over_90, is_notice_given, eviction_pending_date`;
  const delinqNow = dates.cur ? await q(`
    SELECT ${leaseCols} FROM ${del} WHERE snapshot_date = DATE('${dates.cur}')
  `) : [];
  const delinqPrior = dates.prior ? await q(`
    SELECT ${leaseCols} FROM ${del} WHERE snapshot_date = DATE('${dates.prior}')
  `) : [];

  return { noiHistory, expenseRows, delinqNow, delinqPrior, curDate: dates.cur, priorDate: dates.prior };
}

// Total delinquent A/R as of the latest snapshot on or before (today - daysAgo).
// Used by the weekly report for a week-over-week A/R delta. Returns null if no
// snapshot exists that far back.
export async function arAsOf(daysAgo) {
  const del = view("delinquency_snapshots");
  const [row] = await q(`
    SELECT ROUND(SUM(total_balance)) AS ar_total
    FROM ${del}
    WHERE snapshot_date = (
      SELECT MAX(snapshot_date) FROM ${del}
      WHERE snapshot_date <= DATE_SUB(CURRENT_DATE(), INTERVAL ${Number(daysAgo)} DAY)
    )
  `);
  return row && row.ar_total != null ? Number(row.ar_total) : null;
}

// Pull everything the dashboard + report need in one gather() so the two stay
// in lockstep. Returns a plain object (JSON-safe) ready to cache or render.
export async function gather() {
  // ---- financials: latest month, prior month, 6-month NOI trend ----
  const fin = view("financial_snapshots");
  const trendRows = await q(`
    SELECT snapshot_month AS month,
           ROUND(SUM(IF(t12_section='income',  total_amount, 0))) AS income,
           ROUND(SUM(IF(t12_section='expense', total_amount, 0))) AS expense
    FROM ${fin}
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `);
  const trend = trendRows
    .map((r) => ({
      month: r.month,
      income: num(r.income),
      expense: num(r.expense),
      noi: num(r.income) - num(r.expense),
    }))
    .reverse(); // chronological for charting

  const latest = trend[trend.length - 1] || null;
  const prior = trend[trend.length - 2] || null;
  const period = latest ? latest.month : null;

  // ---- per-property, latest month ----
  let properties = [];
  if (period) {
    const perProp = await q(`
      SELECT property_id, ANY_VALUE(property_name) AS property_name,
             ROUND(SUM(IF(t12_section='income',  total_amount, 0))) AS income,
             ROUND(SUM(IF(t12_section='expense', total_amount, 0))) AS expense
      FROM ${fin}
      WHERE snapshot_month = '${period}'
      GROUP BY property_id
    `);
    properties = perProp.map((r) => ({
      property_id: Number(r.property_id),
      property_name: r.property_name,
      income: num(r.income),
      expense: num(r.expense),
      noi: num(r.income) - num(r.expense),
      ar_total: 0,
      ar_over_90: 0,
      evictions_pending: 0,
      units_delinquent: 0,
    }));
  }

  // ---- delinquency: latest day, portfolio aging + per-property ----
  const del = view("delinquency_snapshots");
  const [delDateRow] = await q(`SELECT CAST(MAX(snapshot_date) AS STRING) AS d FROM ${del}`);
  const delDate = delDateRow ? delDateRow.d : null;

  let aging = { ar_0_30: 0, ar_31_60: 0, ar_61_90: 0, ar_over_90: 0, ar_total: 0 };
  let evictions = 0;
  let notices = 0;
  if (delDate) {
    const [agg] = await q(`
      SELECT ROUND(SUM(balance_0_to_30_days))  AS ar_0_30,
             ROUND(SUM(balance_31_to_60_days)) AS ar_31_60,
             ROUND(SUM(balance_61_to_90_days)) AS ar_61_90,
             ROUND(SUM(balance_over_90_days))  AS ar_over_90,
             ROUND(SUM(total_balance))         AS ar_total,
             COUNTIF(eviction_pending_date IS NOT NULL) AS evictions,
             COUNTIF(is_notice_given) AS notices
      FROM ${del}
      WHERE snapshot_date = DATE('${delDate}')
    `);
    aging = {
      ar_0_30: num(agg.ar_0_30),
      ar_31_60: num(agg.ar_31_60),
      ar_61_90: num(agg.ar_61_90),
      ar_over_90: num(agg.ar_over_90),
      ar_total: num(agg.ar_total),
    };
    evictions = num(agg.evictions);
    notices = num(agg.notices);

    // per-property delinquency, fold into properties[]
    const perPropDel = await q(`
      SELECT property_id,
             ROUND(SUM(total_balance))        AS ar_total,
             ROUND(SUM(balance_over_90_days)) AS ar_over_90,
             COUNTIF(eviction_pending_date IS NOT NULL) AS evictions,
             COUNT(DISTINCT unit_id) AS units_delinquent
      FROM ${del}
      WHERE snapshot_date = DATE('${delDate}')
      GROUP BY property_id
    `);
    const byId = new Map(properties.map((p) => [p.property_id, p]));
    for (const r of perPropDel) {
      const id = Number(r.property_id);
      let p = byId.get(id);
      if (!p) {
        p = {
          property_id: id, property_name: null, income: 0, expense: 0, noi: 0,
          ar_total: 0, ar_over_90: 0, evictions_pending: 0, units_delinquent: 0,
        };
        properties.push(p);
        byId.set(id, p);
      }
      p.ar_total = num(r.ar_total);
      p.ar_over_90 = num(r.ar_over_90);
      p.evictions_pending = num(r.evictions);
      p.units_delinquent = num(r.units_delinquent);
    }
  }

  // sort properties by NOI desc for display
  properties.sort((a, b) => b.noi - a.noi);

  return {
    period,
    property_count: properties.length,
    operating_income: latest ? latest.income : 0,
    operating_expense: latest ? latest.expense : 0,
    noi: latest ? latest.noi : 0,
    noi_prior: prior ? prior.noi : null,
    delinquency_date: delDate,
    ...aging,
    evictions_pending: evictions,
    notices_given: notices,
    trend,
    properties,
    // recurring charges (rent roll) intentionally absent — pending John's grant
    recurring_charges_available: false,
  };
}
