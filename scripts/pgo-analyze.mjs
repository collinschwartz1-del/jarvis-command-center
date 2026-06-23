// PGO intelligence layer. Turns the raw gather()/gatherAnalysisData() pulls into
// trends, due-outs, a scored "focus this week" ranking, a watch list, and wins —
// then (optionally) a grounded AI executive summary on top of those exact numbers.
//
// Deterministic first: every flag/score is computed here and is explainable. The
// AI step only narrates the computed facts (no new numbers), so it can't drift.
//
// analyze(gathered, data) -> analysis object (JSON-safe; cached + rendered)
// aiSummary(analysis, gathered) -> { headline, bullets[] } | null

import Anthropic from "@anthropic-ai/sdk";

const usd = (n) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("en-US")}`);
const pctChange = (cur, base) => (base ? ((cur - base) / Math.abs(base)) * 100 : null);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function analyze(gathered, data) {
  const { properties = [], trend = [], operating_income = 0 } = gathered;
  const { noiHistory = [], expenseRows = [], delinqNow = [], delinqPrior = [], curDate } = data;

  // ---- portfolio trends ----
  const noiSeries = trend.map((t) => t.noi);
  const latestNoi = noiSeries.at(-1) ?? 0;
  const priorNoi = noiSeries.at(-2) ?? null;
  const avg3Noi = avg(noiSeries.slice(-4, -1)); // 3 months before latest
  const incSeries = trend.map((t) => t.income);
  const expSeries = trend.map((t) => t.expense);
  const opexRatio = incSeries.at(-1) ? expSeries.at(-1) / incSeries.at(-1) : null;
  const opexRatio3 = avg(trend.slice(-4, -1).map((t) => (t.income ? t.expense / t.income : 0)));

  const arNow = delinqNow.reduce((s, r) => s + Number(r.total_balance || 0), 0);
  const arPrior = delinqPrior.reduce((s, r) => s + Number(r.total_balance || 0), 0);

  const trends = {
    noi_latest: latestNoi,
    noi_mom_pct: pctChange(latestNoi, priorNoi),
    noi_vs_avg3_pct: pctChange(latestNoi, avg3Noi),
    noi_direction: priorNoi == null ? "flat" : latestNoi >= priorNoi ? "up" : "down",
    opex_ratio: opexRatio,
    opex_ratio_3mo: opexRatio3 || null,
    opex_ratio_trend: opexRatio != null && opexRatio3 ? (opexRatio > opexRatio3 ? "rising" : "easing") : "flat",
    ar_now: arNow,
    ar_wow: arPrior ? arNow - arPrior : null,
    ar_pct_income: operating_income ? (arNow / operating_income) * 100 : null,
  };

  // ---- per-property NOI history (declining streak, prev month) ----
  const histById = new Map();
  for (const r of noiHistory) {
    const id = Number(r.property_id);
    const noi = Number(r.income || 0) - Number(r.expense || 0);
    if (!histById.has(id)) histById.set(id, []);
    histById.get(id).push({ month: r.month, noi });
  }
  const decliningStreak = (series) => {
    let n = 0;
    for (let i = series.length - 1; i > 0; i--) {
      if (series[i].noi < series[i - 1].noi) n++;
      else break;
    }
    return n;
  };

  // ---- expense spikes per property (operating account vs trailing 3-mo avg) ----
  const acctSeries = new Map(); // key id|account -> {name, months:[{month,amt}]}
  for (const r of expenseRows) {
    const key = `${r.property_id}|${r.account_name}`;
    if (!acctSeries.has(key))
      acctSeries.set(key, { id: Number(r.property_id), name: r.property_name, account: r.account_name, months: [] });
    acctSeries.get(key).months.push({ month: r.month, amt: Number(r.amt || 0) });
  }
  const spikeById = new Map(); // id -> biggest spike {account, latest, avg, pct}
  for (const s of acctSeries.values()) {
    s.months.sort((a, b) => a.month.localeCompare(b.month));
    const latest = s.months.at(-1);
    const base = avg(s.months.slice(0, -1).map((m) => m.amt));
    if (!latest || base <= 0) continue;
    const over = latest.amt - base;
    if (latest.amt >= 1.5 * base && over >= 2000) {
      const cur = spikeById.get(s.id);
      if (!cur || over > cur.over)
        spikeById.set(s.id, { account: s.account, latest: latest.amt, avg: Math.round(base), over, pct: (over / base) * 100 });
    }
  }

  // ---- delinquency deltas per lease ----
  const priorByLease = new Map(delinqPrior.map((r) => [r.lease_id, r]));
  const newly90 = new Map(); // id -> {count, amt}
  const growing = new Map(); // id -> {count, amt}  (notice given, balance up)
  for (const r of delinqNow) {
    const id = Number(r.property_id);
    const prev = priorByLease.get(r.lease_id);
    const over90 = Number(r.over_90 || 0);
    const prevOver90 = prev ? Number(prev.over_90 || 0) : 0;
    if (over90 > 0 && prevOver90 === 0) {
      const e = newly90.get(id) || { count: 0, amt: 0 };
      e.count++; e.amt += over90; newly90.set(id, e);
    }
    if (r.is_notice_given && prev && Number(r.total_balance || 0) > Number(prev.total_balance || 0) + 50) {
      const e = growing.get(id) || { count: 0, amt: 0 };
      e.count++; e.amt += Number(r.total_balance || 0) - Number(prev.total_balance || 0); growing.set(id, e);
    }
  }

  // ---- eviction aging per property (from current snapshot) ----
  const ref = curDate ? new Date(curDate) : new Date();
  const evictById = new Map(); // id -> {count, oldestDays}
  for (const r of delinqNow) {
    if (!r.eviction_pending_date) continue;
    const id = Number(r.property_id);
    const d = new Date(r.eviction_pending_date.value || r.eviction_pending_date);
    const days = Math.round((ref - d) / 86400000);
    const e = evictById.get(id) || { count: 0, oldestDays: 0 };
    e.count++; e.oldestDays = Math.max(e.oldestDays, days); evictById.set(id, e);
  }

  // ---- score each property ----
  const scored = properties.map((p) => {
    const id = p.property_id;
    const income = p.income || 0;
    const noi = p.noi || 0;
    const margin = income ? (noi / income) * 100 : null;
    const series = histById.get(id) || [];
    const streak = decliningStreak(series);
    const prevMonthNoi = series.length >= 2 ? series.at(-2).noi : null;
    const spike = spikeById.get(id);
    const n90 = newly90.get(id);
    const grow = growing.get(id);
    const evict = evictById.get(id);
    const arPctIncome = income ? ((p.ar_total || 0) / income) * 100 : 0;

    let score = 0;
    const reasons = [];
    if (noi < 0) { score += 40; reasons.push(`Negative NOI (${usd(noi)})`); }
    else if (margin != null && margin < 10) { score += 20; reasons.push(`Thin NOI margin (${margin.toFixed(0)}%)`); }
    else if (margin != null && margin < 20) { score += 10; }
    if (streak >= 3) { score += 25; reasons.push(`NOI down ${streak} straight months`); }
    else if (streak === 2) { score += 15; reasons.push(`NOI down 2 straight months`); }
    if (arPctIncome > 15) { score += 20; reasons.push(`A/R ${arPctIncome.toFixed(0)}% of income (${usd(p.ar_total)})`); }
    else if (arPctIncome > 8) { score += 10; reasons.push(`Elevated A/R (${usd(p.ar_total)})`); }
    if ((p.ar_over_90 || 0) > 0) { score += 10; reasons.push(`${usd(p.ar_over_90)} in 90+ days`); }
    if (evict) {
      score += Math.min(evict.count * 3, 15);
      if (evict.oldestDays > 45) { score += 10; reasons.push(`${evict.count} eviction(s), oldest ${evict.oldestDays}d`); }
      else reasons.push(`${evict.count} eviction(s) pending`);
    }
    if (n90) { score += 10; reasons.push(`${n90.count} lease(s) newly 90+ (${usd(n90.amt)})`); }
    if (grow) { score += 8; reasons.push(`${grow.count} noticed lease(s) still growing`); }
    if (spike) { score += 15; reasons.push(`${spike.account} +${spike.pct.toFixed(0)}% (${usd(spike.latest)} vs ${usd(spike.avg)} avg)`); }

    return {
      property_id: id, name: p.property_name || `#${id}`, score,
      noi, margin, ar_total: p.ar_total || 0, streak, prevMonthNoi,
      newlyNegative: noi < 0 && prevMonthNoi != null && prevMonthNoi >= 0,
      reasons, spike: spike || null, evict: evict || null, n90: n90 || null, grow: grow || null,
      momNoi: prevMonthNoi != null ? noi - prevMonthNoi : null,
    };
  });

  const focus = scored.filter((p) => p.score >= 30).sort((a, b) => b.score - a.score).slice(0, 7);
  const focusIds = new Set(focus.map((p) => p.property_id));
  const watch = scored.filter((p) => p.score >= 15 && p.score < 30 && !focusIds.has(p.property_id))
    .sort((a, b) => b.score - a.score).slice(0, 7);
  const wins = scored.filter((p) => p.streak === 0 && p.momNoi != null && p.momNoi > 0 && p.noi > 0)
    .sort((a, b) => b.momNoi - a.momNoi).slice(0, 5);

  // ---- due-outs (action list) ----
  const dueOuts = [];
  for (const p of scored) {
    if (p.evict && p.evict.oldestDays > 45)
      dueOuts.push({ kind: "eviction", priority: 1, text: `${p.name}: push eviction to completion — ${p.evict.count} case(s), oldest ${p.evict.oldestDays} days.` });
    if (p.n90)
      dueOuts.push({ kind: "delinquency", priority: 2, text: `${p.name}: ${p.n90.count} lease(s) newly crossed 90+ days (${usd(p.n90.amt)}) — escalate.` });
    if (p.grow)
      dueOuts.push({ kind: "delinquency", priority: 2, text: `${p.name}: ${p.grow.count} noticed lease(s) with balance still rising — follow up.` });
    if (p.newlyNegative)
      dueOuts.push({ kind: "noi", priority: 1, text: `${p.name}: flipped to negative NOI this month (${usd(p.noi)}) — review.` });
    if (p.spike)
      dueOuts.push({ kind: "expense", priority: 3, text: `${p.name}: ${p.spike.account} spiked to ${usd(p.spike.latest)} (+${p.spike.pct.toFixed(0)}% vs ${usd(p.spike.avg)} avg) — verify.` });
  }
  dueOuts.sort((a, b) => a.priority - b.priority);

  return {
    generated_for: gathered.period,
    trends,
    focus,
    watch,
    wins,
    dueOuts,
    counts: { focus: focus.length, watch: watch.length, dueOuts: dueOuts.length },
  };
}

// Grounded executive summary. Returns null on any failure (report degrades to the
// deterministic sections). Only narrates the computed analysis — no new numbers.
export async function aiSummary(analysis, gathered) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.PGO_AI_MODEL || "claude-sonnet-4-6";
  const claude = new Anthropic({ apiKey: key });

  const facts = {
    period: gathered.period,
    portfolio: {
      noi: gathered.noi, income: gathered.operating_income, expense: gathered.operating_expense,
      ar_total: gathered.ar_total, evictions_pending: gathered.evictions_pending,
    },
    trends: analysis.trends,
    focus: analysis.focus.map((p) => ({ name: p.name, score: p.score, noi: p.noi, reasons: p.reasons })),
    watch: analysis.watch.map((p) => ({ name: p.name, reasons: p.reasons })),
    wins: analysis.wins.map((p) => ({ name: p.name, mom_noi_gain: p.momNoi })),
    due_outs: analysis.dueOuts.map((d) => d.text),
  };

  const prompt = `You are an asset-management analyst briefing the owner of Point Guard Omaha's property portfolio for the week. Below is a computed analysis (JSON). Write a tight executive summary.

RULES:
- Use ONLY the numbers/facts in the JSON. Do not invent figures.
- Operator tone: direct, no filler, no hedging.
- Lead with the single most important thing.
- Prioritize action: what to focus on and why it matters.
- Return STRICT JSON: {"headline": "<one punchy sentence>", "bullets": ["<3-6 prioritized bullets, each a concrete focus/action with the why>"]}

DATA:
${JSON.stringify(facts, null, 2)}`;

  try {
    const res = await claude.messages.create({
      model,
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    if (parsed && parsed.headline && Array.isArray(parsed.bullets)) return parsed;
    return null;
  } catch (e) {
    console.error("pgo-analyze: AI summary failed:", e.message);
    return null;
  }
}
