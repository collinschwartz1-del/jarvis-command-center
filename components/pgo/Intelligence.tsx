import { SectionLabel, Empty } from "@/components/ui";
import { money } from "@/lib/format";
import type { PgoAnalysis } from "@/lib/types";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

// Dashboard intelligence: Focus This Week + Due-Outs + Trends + Watch, all from
// the deterministic analysis cached on the snapshot by scripts/pgo-sync.mjs.
// (The AI executive narrative lives in the weekly email/PDF, not here.)
export function Intelligence({ analysis }: { analysis: PgoAnalysis | null | undefined }) {
  if (!analysis) {
    return <Empty>No analysis yet — run the sync to compute trends and focus items.</Empty>;
  }
  const { trends: t, focus, watch, dueOuts } = analysis;

  return (
    <div className="space-y-6">
      {/* Focus + Due-Outs side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionLabel>Focus This Week · {focus.length}</SectionLabel>
          {focus.length ? (
            <ul className="space-y-2">
              {focus.map((p) => (
                <li key={p.property_id} className="rounded-lg border border-border bg-panel/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-text">{p.name}</span>
                    <span className="flex items-center gap-2">
                      <span className={`font-mono text-sm ${p.noi < 0 ? "text-red-400" : "text-text"}`}>{money(p.noi)}</span>
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
                        {p.score}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted">{p.reasons.join(" · ")}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing in the focus zone — portfolio looks steady.</Empty>
          )}
        </div>

        <div>
          <SectionLabel>Due-Outs · Action Items</SectionLabel>
          {dueOuts.length ? (
            <ul className="space-y-1.5 rounded-lg border border-border p-3">
              {dueOuts.slice(0, 12).map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-text">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${d.priority === 1 ? "bg-red-400" : d.priority === 2 ? "bg-amber-400" : "bg-muted"}`} />
                  <span>{d.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No open action items flagged.</Empty>
          )}
        </div>
      </div>

      {/* Trends strip */}
      <div>
        <SectionLabel>Trends</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <TrendTile label="NOI vs prior mo" value={fmtPct(t.noi_mom_pct)} good={(t.noi_mom_pct ?? 0) >= 0} />
          <TrendTile label="NOI vs 3-mo avg" value={fmtPct(t.noi_vs_avg3_pct)} good={(t.noi_vs_avg3_pct ?? 0) >= 0} />
          <TrendTile
            label="Opex ratio"
            value={t.opex_ratio == null ? "—" : `${(t.opex_ratio * 100).toFixed(0)}%`}
            good={t.opex_ratio_trend !== "rising"}
            sub={t.opex_ratio_trend}
          />
          <TrendTile
            label="A/R week-over-week"
            value={t.ar_wow == null ? "—" : `${t.ar_wow >= 0 ? "▲" : "▼"} ${money(Math.abs(t.ar_wow))}`}
            good={(t.ar_wow ?? 0) <= 0}
            sub={t.ar_pct_income == null ? undefined : `${t.ar_pct_income.toFixed(1)}% of income`}
          />
        </div>
      </div>

      {/* Watch list */}
      {watch.length > 0 && (
        <div>
          <SectionLabel>Watch · Early Warning</SectionLabel>
          <ul className="divide-y divide-border/50 rounded-lg border border-border">
            {watch.map((p) => (
              <li key={p.property_id} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="text-sm text-text">{p.name}</span>
                <span className="text-right text-[11px] text-muted">{p.reasons.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TrendTile({ label, value, good, sub }: { label: string; value: string; good: boolean; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${good ? "text-text" : "text-amber-400"}`}>{value}</div>
      {sub && <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{sub}</div>}
    </div>
  );
}
