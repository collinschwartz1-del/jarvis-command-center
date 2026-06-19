import type { Deal } from "@/lib/types";
import { compactMoney } from "@/lib/format";

export function DealRow({ deal }: { deal: Deal }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text">{deal.name}</div>
        <div className="mt-0.5 text-xs text-muted">
          <span className="uppercase tracking-wide">{deal.kind.replace("_", " ")}</span>
          {deal.source && <span> · {deal.source}</span>}
        </div>
      </div>
      <div className="ml-auto text-right">
        <div className="tabular font-mono text-sm text-text">{compactMoney(deal.value)}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
          {deal.stage}
        </div>
      </div>
    </div>
  );
}
