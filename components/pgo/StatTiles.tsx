import { MetricTile } from "@/components/metric-tile";
import { compactMoney } from "@/lib/format";
import type { PgoSnapshot } from "@/lib/types";

// Top stat row for the PGO portfolio — latest-month operating NOI (with MoM
// delta), income/expense, total delinquent A/R, evictions, property count.
export function StatTiles({ snap }: { snap: PgoSnapshot | null }) {
  if (!snap) return null;

  const noi = snap.noi ?? 0;
  const prior = snap.noi_prior;
  let moM = "vs prior month";
  if (prior != null && prior !== 0) {
    const d = ((noi - prior) / Math.abs(prior)) * 100;
    moM = `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% MoM`;
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricTile label="Net Operating Income" value={compactMoney(noi)} sub={moM} />
      <MetricTile
        label="Income"
        value={compactMoney(snap.operating_income)}
        sub={`${snap.property_count ?? "—"} properties`}
      />
      <MetricTile
        label="Operating Expense"
        value={compactMoney(snap.operating_expense)}
        sub={snap.period ?? "—"}
      />
      <MetricTile
        label="Delinquent A/R"
        value={compactMoney(snap.ar_total)}
        sub={`${compactMoney(snap.ar_over_90)} over 90d`}
      />
      <MetricTile
        label="Evictions Pending"
        value={snap.evictions_pending ?? 0}
        sub={`${snap.notices_given ?? 0} notices given`}
      />
    </div>
  );
}
