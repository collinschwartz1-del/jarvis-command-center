import { compactMoney } from "@/lib/format";
import type { PgoTrendPoint } from "@/lib/types";

// 6-month operating-NOI trend as simple CSS bars (no chart lib). Bars scale to
// the max absolute NOI in the window; negative months render below the baseline.
export function NoiTrend({ trend }: { trend: PgoTrendPoint[] }) {
  const data = trend.slice(-6);
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => Math.abs(d.noi)), 1);

  return (
    <div className="tile rounded-lg border border-border p-5">
      <div className="flex items-end justify-between gap-3">
        {data.map((d) => {
          const h = Math.round((Math.abs(d.noi) / max) * 100);
          const neg = d.noi < 0;
          const [, m] = d.month.split("-");
          const label = new Date(2000, Number(m) - 1, 1).toLocaleDateString("en-US", {
            month: "short",
          });
          return (
            <div key={d.month} className="flex flex-1 flex-col items-center gap-2">
              <div className="font-mono text-[10px] text-muted">{compactMoney(d.noi)}</div>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className={`w-7 rounded-t ${neg ? "bg-red-500/60" : "bg-accent/70"}`}
                  style={{ height: `${Math.max(h, 4)}%` }}
                />
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
