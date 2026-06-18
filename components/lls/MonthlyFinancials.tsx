import { FileText, TrendingUp } from "lucide-react";
import { compactMoney } from "@/lib/format";
import type { LlsRawStats, LlsReport } from "@/lib/types";

// Earnings trend (last 12 months) from dashboard-stats.lender_earnings, plus a
// link to the latest generated monthly report PDF in Drive.
export function MonthlyFinancials({
  raw,
  reports,
}: {
  raw: LlsRawStats;
  reports: LlsReport[];
}) {
  const earnings = raw?.lender_earnings || {};
  const months = Object.keys(earnings)
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort()
    .slice(-12)
    .map((k) => ({ month: k, earned: Number(earnings[k]?.earned || 0) }));
  const max = Math.max(1, ...months.map((m) => m.earned));
  const latest = reports[0];

  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      <div className="flex items-center gap-2">
        <TrendingUp size={14} className="text-accent" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          Interest earned · trailing 12mo
        </span>
        {latest?.web_view_link && (
          <a
            href={latest.web_view_link}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-border-bright px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <FileText size={11} /> {latest.period} report
          </a>
        )}
      </div>

      <div className="mt-4 flex h-28 items-end gap-1.5">
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-accent/50"
              style={{ height: `${Math.max(2, (m.earned / max) * 100)}%` }}
              title={`${m.month}: ${compactMoney(m.earned)}`}
            />
            <span className="font-mono text-[8px] text-muted">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>

      {months.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 font-mono text-[10px] text-muted">
          <span>{months[0].month}</span>
          <span className="text-zinc-300">
            latest {compactMoney(months[months.length - 1].earned)}
          </span>
          <span>{months[months.length - 1].month}</span>
        </div>
      )}

      {!latest && (
        <p className="mt-3 text-xs text-muted">
          No monthly report generated yet — runs on the 1st (npm run lls-report).
        </p>
      )}
    </div>
  );
}
