import { money, shortDate } from "@/lib/format";
import type { LlsRawStats } from "@/lib/types";

// 30-day cash view: payoffs (money in) vs new originations (money out) and the
// net, plus the dated timeline. Source: dashboard-stats.pipeline_vs_payoffs.
export function CashflowStrip({ raw }: { raw: LlsRawStats }) {
  const pp = raw?.pipeline_vs_payoffs;
  if (!pp) return null;
  const net = pp.net ?? pp.inflow_total - pp.outflow_total;

  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Maturing in
          </div>
          <div className="tabular mt-1 font-mono text-lg text-emerald-300">
            {money(pp.inflow_total)}
          </div>
          <div className="font-mono text-[10px] text-muted">{pp.inflow_count} loans</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Deploys out
          </div>
          <div className="tabular mt-1 font-mono text-lg text-amber-300">
            {money(pp.outflow_total)}
          </div>
          <div className="font-mono text-[10px] text-muted">{pp.outflow_count} loans</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Net 30d
          </div>
          <div
            className={`tabular mt-1 font-mono text-lg ${
              net >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {net >= 0 ? "+" : ""}
            {money(net)}
          </div>
          <div className="font-mono text-[10px] text-muted">liquidity swing</div>
        </div>
      </div>

      {pp.timeline?.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border pt-3">
          {pp.timeline.slice(0, 12).map((t, i) => (
            <div
              key={`${t.loan_id}-${i}`}
              className="flex items-center gap-3 text-xs"
            >
              <span className="w-12 shrink-0 font-mono text-[10px] text-muted">
                {shortDate(t.date_iso)}
              </span>
              <span
                className={`inline-flex w-16 shrink-0 justify-center rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                  t.type === "payoff"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {t.type === "payoff" ? "Matures" : "Deploy"}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">
                {t.address}
                <span className="text-muted">
                  {" "}
                  · {t.city}, {t.state}
                </span>
              </span>
              <span
                className={`tabular shrink-0 font-mono ${
                  t.type === "payoff" ? "text-emerald-300" : "text-amber-300"
                }`}
              >
                {t.type === "payoff" ? "+" : "−"}
                {money(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
