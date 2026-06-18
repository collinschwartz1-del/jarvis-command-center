import { money } from "@/lib/format";
import type { LlsRawStats } from "@/lib/types";

// Borrower concentration — top exposures as a share of the book. A risk/health
// signal: anyone running high is a single point of failure.
export function Concentration({ raw }: { raw: LlsRawStats }) {
  const rows = raw?.concentration_risk;
  if (!rows?.length) return null;
  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      <div className="space-y-2.5">
        {rows.slice(0, 6).map((r, i) => {
          const p = Number(r.percentage) || 0;
          const hot = p >= 10;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-zinc-300">
                {r.first_name} {r.last_name}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className={`h-full rounded-full ${
                    hot ? "bg-rose-400/70" : "bg-accent/60"
                  }`}
                  style={{ width: `${Math.min(100, p)}%` }}
                />
              </div>
              <span className="tabular w-10 shrink-0 text-right font-mono text-xs text-muted">
                {p.toFixed(1)}%
              </span>
              <span className="tabular w-20 shrink-0 text-right font-mono text-xs text-zinc-400">
                {money(Number(r.total_amount))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
