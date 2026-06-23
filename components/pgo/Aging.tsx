import { money, shortDate } from "@/lib/format";
import type { PgoSnapshot } from "@/lib/types";

// Delinquent A/R aging breakdown for the latest daily snapshot.
export function Aging({ snap }: { snap: PgoSnapshot }) {
  const buckets = [
    { label: "0–30 days", v: snap.ar_0_30 ?? 0, tone: "text-text" },
    { label: "31–60 days", v: snap.ar_31_60 ?? 0, tone: "text-amber-400" },
    { label: "61–90 days", v: snap.ar_61_90 ?? 0, tone: "text-orange-400" },
    { label: "Over 90 days", v: snap.ar_over_90 ?? 0, tone: "text-red-400" },
  ];
  const total = snap.ar_total ?? 0;

  return (
    <div className="tile rounded-lg border border-border p-5">
      <table className="w-full">
        <tbody>
          {buckets.map((b) => {
            const w = total > 0 ? Math.round((b.v / total) * 100) : 0;
            return (
              <tr key={b.label} className="border-b border-border/50 last:border-0">
                <td className="py-2 text-sm text-muted">{b.label}</td>
                <td className="w-1/2 py-2">
                  <div className="h-1.5 w-full rounded-full bg-panel-2">
                    <div
                      className="h-1.5 rounded-full bg-accent/60"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </td>
                <td className={`py-2 text-right font-mono text-sm font-semibold ${b.tone}`}>
                  {money(b.v)}
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="pt-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              Total · {shortDate(snap.delinquency_date)}
            </td>
            <td />
            <td className="pt-3 text-right font-mono text-sm font-semibold text-text">
              {money(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
