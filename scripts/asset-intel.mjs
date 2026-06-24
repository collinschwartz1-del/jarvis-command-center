// LeavenWealth Asset Management intelligence — encodes the Meeting Operating
// System as code. Takes the PGO data (gather + analyze) and produces:
//   1. property classification: Stabilized / Non-Stabilized / Red Zone (+ changes)
//   2. per-meeting agendas mapped to the OS structure
//   3. the Owner's Weekly Brief (Collin's direction layer) + grounded AI summary
//
// Classification rules mirror the OS doc's "Property Classification Rules",
// using data proxies (occupancy/leasing arrive once rent-roll unblocks):
//   Red Zone        cash flow threatened / severe collections / aged evictions
//   Non-Stabilized  underperforming NOI, declining, elevated A/R, active value-add
//   Stabilized      none of the above
//
// Headless + cloud-safe. ClickUp orphan cross-ref + calendar mapping are layered
// in by the runner when those feeds are connected.

import Anthropic from "@anthropic-ai/sdk";

const usd = (n) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("en-US")}`);

// Tunable thresholds (dials Collin can adjust after a few weeks).
export const RULES = {
  redZone:  { score: 55, arPctIncome: 40, evictionDays: 60, noiNegative: true },
  nonStab:  { score: 30, marginPct: 15, decliningStreak: 2, arPctIncome: 15 },
};

export function classify(gathered, analysis) {
  const props = gathered.properties || [];
  // index analysis scoring by property for reasons
  const scoreById = new Map();
  for (const p of [...(analysis?.focus || []), ...(analysis?.watch || [])]) scoreById.set(p.property_id, p);

  const rows = props.map((p) => {
    const income = p.income || 0;
    const noi = p.noi || 0;
    const margin = income ? (noi / income) * 100 : null;
    const arPct = income ? ((p.ar_total || 0) / income) * 100 : 0;
    const scored = scoreById.get(p.property_id);
    const score = scored?.score ?? 0;
    const streak = scored?.streak ?? 0;
    const reasons = scored?.reasons ? [...scored.reasons] : [];

    // ---- classification ----
    let tier = "Stabilized";
    const redTriggers = [];
    if (noi < 0) redTriggers.push("Negative NOI — cash flow threatened");
    if (arPct > RULES.redZone.arPctIncome) redTriggers.push(`A/R ${arPct.toFixed(0)}% of income`);
    if (score >= RULES.redZone.score) redTriggers.push(`Composite risk score ${score}`);
    if ((scored?.reasons || []).some((r) => /oldest \d{2,}d/.test(r) && Number((r.match(/oldest (\d+)d/) || [])[1]) > RULES.redZone.evictionDays))
      redTriggers.push("Aged evictions (60+ days)");

    const nonStabTriggers = [];
    if (score >= RULES.nonStab.score) nonStabTriggers.push(`Risk score ${score}`);
    if (margin != null && margin < RULES.nonStab.marginPct) nonStabTriggers.push(`Thin NOI margin ${margin.toFixed(0)}%`);
    if (streak >= RULES.nonStab.decliningStreak) nonStabTriggers.push(`NOI down ${streak} months`);
    if (arPct > RULES.nonStab.arPctIncome) nonStabTriggers.push(`Elevated A/R ${arPct.toFixed(0)}%`);

    if (redTriggers.length) tier = "Red Zone";
    else if (nonStabTriggers.length) tier = "Non-Stabilized";

    return {
      property_id: p.property_id,
      name: p.property_name || `#${p.property_id}`,
      tier,
      score,
      noi,
      income,
      margin,
      ar_total: p.ar_total || 0,
      ar_pct_income: arPct,
      evictions: p.evictions_pending || 0,
      streak,
      reasons: (tier === "Red Zone" ? redTriggers : tier === "Non-Stabilized" ? nonStabTriggers : []).concat(
        reasons.filter((r) => !/score/i.test(r))
      ).slice(0, 5),
      source: "pgo-bigquery",
    };
  });

  const byTier = (t) => rows.filter((r) => r.tier === t).sort((a, b) => b.score - a.score);
  return {
    redZone: byTier("Red Zone"),
    nonStabilized: byTier("Non-Stabilized"),
    stabilized: byTier("Stabilized"),
    counts: {
      red: rows.filter((r) => r.tier === "Red Zone").length,
      nonStab: rows.filter((r) => r.tier === "Non-Stabilized").length,
      stab: rows.filter((r) => r.tier === "Stabilized").length,
      total: rows.length,
    },
    all: rows,
  };
}

// Status changes vs the previous classification (passed in from the cache).
export function diffClassification(current, prevAll) {
  if (!prevAll || !prevAll.length) return [];
  const prevTier = new Map(prevAll.map((r) => [r.property_id, r.tier]));
  const order = { Stabilized: 0, "Non-Stabilized": 1, "Red Zone": 2 };
  const changes = [];
  for (const r of current.all) {
    const was = prevTier.get(r.property_id);
    if (was && was !== r.tier) {
      const dir = order[r.tier] > order[was] ? "escalated" : "improved";
      changes.push({ name: r.name, from: was, to: r.tier, dir });
    }
  }
  return changes;
}

// Per-meeting agendas mapped to the OS structure.
export function buildAgendas(cls, analysis, gathered, changes = []) {
  const propLine = (p) => `${p.name} — ${usd(p.noi)} NOI${p.ar_total ? `, ${usd(p.ar_total)} A/R` : ""}${p.reasons.length ? ` · ${p.reasons.join("; ")}` : ""}`;

  return {
    huddle: {
      title: "Asset Management Huddle",
      sections: {
        "Red Zone Updates": cls.redZone.map(propLine),
        "Status Changes": changes.map((c) => `${c.name}: ${c.from} → ${c.to} (${c.dir})`),
        "Top Risks (data-flagged)": (analysis?.focus || []).slice(0, 5).map((p) => `${p.name} — ${p.reasons.join("; ")}`),
        "Escalations Needed": cls.redZone.filter((p) => p.evictions > 0 || p.noi < 0).map((p) => `${p.name}: ${p.noi < 0 ? "negative NOI" : ""}${p.evictions ? ` ${p.evictions} evictions pending` : ""}`.trim()),
      },
    },
    stabilized: {
      title: "Stabilized Asset Review (exception-based)",
      sections: {
        "Exceptions Only": cls.stabilized.filter((p) => p.reasons.length || (p.margin != null && p.margin < 25)).map(propLine),
        "Status Evaluation — watch for downgrade": cls.stabilized.filter((p) => p.score >= 15).map((p) => `${p.name} (score ${p.score})`),
      },
    },
    warRoom: {
      title: "Non-Stabilized Asset War Room",
      sections: {
        "KPI / Gap Review": cls.nonStabilized.map(propLine),
        "Expense Anomalies": (analysis?.dueOuts || []).filter((d) => d.kind === "expense").map((d) => d.text),
        "Collections / Delinquency": (analysis?.dueOuts || []).filter((d) => d.kind === "delinquency").map((d) => d.text),
        "Escalations → Red Zone watch": cls.nonStabilized.filter((p) => p.score >= 45).map((p) => `${p.name} (score ${p.score})`),
      },
    },
    redZoneCmd: {
      title: "Red Zone Command",
      sections: {
        "Situation / Financial": cls.redZone.map((p) => `${p.name}: NOI ${usd(p.noi)}, A/R ${usd(p.ar_total)} (${p.ar_pct_income.toFixed(0)}% of income), ${p.evictions} evictions`),
        "Immediate Actions": (analysis?.dueOuts || []).filter((d) => d.priority === 1).map((d) => d.text),
        "Recovery / Exit Criteria": cls.redZone.map((p) => `${p.name}: exit Red Zone when NOI > 0 and A/R < 15% of income`),
      },
    },
    leadership: {
      title: "Leadership Asset Review",
      sections: {
        "Portfolio Scorecard": [
          `NOI ${usd(gathered.noi)} (${analysis?.trends?.noi_mom_pct == null ? "—" : (analysis.trends.noi_mom_pct >= 0 ? "+" : "") + analysis.trends.noi_mom_pct.toFixed(1) + "% MoM"})`,
          `Delinquent A/R ${usd(gathered.ar_total)}`,
          `Evictions pending ${gathered.evictions_pending}`,
        ],
        "Classification Counts": [`Red Zone ${cls.counts.red} · Non-Stabilized ${cls.counts.nonStab} · Stabilized ${cls.counts.stab} (of ${cls.counts.total})`],
        "Status Changes": changes.map((c) => `${c.name}: ${c.from} → ${c.to}`),
      },
    },
  };
}

// The Owner's Weekly Brief — Collin's direction layer (not the operator task list).
export function ownerBrief(cls, analysis, gathered, changes = []) {
  const expenseFlags = (analysis?.dueOuts || []).filter((d) => d.kind === "expense").map((d) => d.text);
  const collections = (analysis?.dueOuts || []).filter((d) => d.kind === "delinquency").map((d) => d.text);
  const escalations = cls.redZone.map((p) => `${p.name}: ${p.reasons[0] || "Red Zone"}`);

  return {
    period: gathered.period,
    headlineStats: {
      noi: gathered.noi,
      noi_mom_pct: analysis?.trends?.noi_mom_pct ?? null,
      ar_total: gathered.ar_total,
      red: cls.counts.red,
      nonStab: cls.counts.nonStab,
    },
    expensesToQuestion: expenseFlags,
    collectionsToPress: collections,
    propertiesToEscalate: escalations,
    statusChanges: changes.map((c) => `${c.name}: ${c.from} → ${c.to} (${c.dir})`),
    trendsToWatch: [
      analysis?.trends?.opex_ratio_trend === "rising" ? `Operating expense ratio is rising (${(analysis.trends.opex_ratio * 100).toFixed(0)}%)` : null,
      analysis?.trends?.ar_wow != null && analysis.trends.ar_wow > 0 ? `A/R grew ${usd(analysis.trends.ar_wow)} week-over-week` : null,
      analysis?.trends?.noi_vs_avg3_pct != null && analysis.trends.noi_vs_avg3_pct < 0 ? `NOI ${analysis.trends.noi_vs_avg3_pct.toFixed(1)}% below 3-month average` : null,
    ].filter(Boolean),
    // orphans (data-flagged but not on a meeting agenda) are injected by the runner
    // once the ClickUp feed is connected.
    orphans: [],
  };
}

// Grounded AI executive summary for the owner brief. Returns null on failure.
export async function aiOwnerSummary(brief, cls) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.PGO_AI_MODEL || "claude-sonnet-4-6";
  const claude = new Anthropic({ apiKey: key });
  const facts = {
    period: brief.period,
    headline_stats: brief.headlineStats,
    red_zone: cls.redZone.map((p) => ({ name: p.name, noi: p.noi, reasons: p.reasons })),
    non_stabilized: cls.nonStabilized.slice(0, 8).map((p) => ({ name: p.name, reasons: p.reasons })),
    expenses_to_question: brief.expensesToQuestion,
    collections_to_press: brief.collectionsToPress,
    status_changes: brief.statusChanges,
    trends_to_watch: brief.trendsToWatch,
  };
  const prompt = `You are the chief of staff to Collin, an OWNER of LeavenWealth (real estate) and Point Guard Omaha (its property manager). Collin's role is direction-setting: he does not run day-to-day operations, he informs the team on expense cuts, anomalies, and trends, and decides escalations. Below is this week's computed asset-management analysis (JSON).

Write Collin's pre-meeting owner brief — what HE should raise and push on this week, before his asset-management and red-zone meetings.

RULES:
- Use ONLY the facts in the JSON. No invented numbers.
- Owner altitude: direction, expense discipline, escalation, accountability — NOT operator task lists.
- Lead with the single highest-leverage thing.
- Each bullet = a specific point Collin should make + why it matters.
- Return STRICT JSON: {"headline":"<one sentence>","bullets":["<4-7 prioritized owner-level points>"]}

DATA:
${JSON.stringify(facts, null, 2)}`;
  try {
    const res = await claude.messages.create({ model, max_tokens: 1100, messages: [{ role: "user", content: prompt }] });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return parsed && parsed.headline && Array.isArray(parsed.bullets) ? parsed : null;
  } catch (e) {
    console.error("asset-intel: AI owner summary failed:", e.message);
    return null;
  }
}
