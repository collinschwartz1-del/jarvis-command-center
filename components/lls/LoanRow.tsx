import { money, shortDate } from "@/lib/format";
import type { LlsLoan } from "@/lib/types";

export function LoanRow({ loan }: { loan: LlsLoan }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text">
          {loan.borrower_name || "—"}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {loan.address}
          {loan.city ? ` · ${loan.city}, ${loan.state}` : ""}
        </div>
      </div>
      <div className="ml-auto text-right">
        <div className="tabular font-mono text-sm text-text">{money(loan.amount)}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
          {loan.stage || loan.status || "active"}
          {loan.payoff_date ? ` · due ${shortDate(loan.payoff_date)}` : ""}
        </div>
      </div>
    </div>
  );
}
