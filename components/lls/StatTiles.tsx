import { MetricTile } from "@/components/metric-tile";
import { compactMoney, pct } from "@/lib/format";
import type { LlsSnapshot } from "@/lib/types";

// Top stat row — capital available/deployed/total, upcoming payoffs, pipeline
// (loans waiting for approval), and fund-health signals. All from the latest
// Lendr dashboard-stats snapshot.
export function StatTiles({ snap }: { snap: LlsSnapshot | null }) {
  if (!snap) return null;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricTile
        label="Capital Available"
        value={compactMoney(snap.available_capital)}
        sub="to deploy"
      />
      <MetricTile
        label="Deployed"
        value={compactMoney(snap.outstanding_capital)}
        sub={`${snap.active_loan_count ?? "—"} active loans`}
      />
      <MetricTile
        label="Total Fund"
        value={compactMoney(snap.total_capital)}
        sub={`${snap.unique_borrowers ?? "—"} borrowers`}
      />
      <MetricTile
        label="Maturing · 30d"
        value={compactMoney(snap.payoffs_30d_total)}
        sub={`${snap.payoffs_30d_count ?? 0} loans maturing`}
      />
      <MetricTile
        label="Waiting Approval"
        value={compactMoney(snap.pipeline_value)}
        sub={`${snap.pipeline_count ?? 0} in pipeline`}
      />
      <MetricTile
        label="New Deploys · 30d"
        value={compactMoney(snap.originations_30d_total)}
        sub={`${snap.originations_30d_count ?? 0} originating`}
      />
      <MetricTile
        label="Past Maturity"
        value={snap.raw?.past_maturity?.count ?? "—"}
        sub={`${compactMoney(snap.raw?.past_maturity?.total)} holdover`}
      />
      <MetricTile
        label="Monthly Interest"
        value={compactMoney(snap.avg_monthly_interest)}
        sub={`${pct(snap.portfolio_ltv)} portfolio LTV`}
      />
    </div>
  );
}
