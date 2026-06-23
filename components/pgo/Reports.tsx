import { Empty } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { PgoReport } from "@/lib/types";

// Archive of the weekly PGO reports (PDFs in Drive). Generated Fri PM and
// emailed to Collin; this lists the back-catalog with links.
export function Reports({ reports }: { reports: PgoReport[] }) {
  if (!reports.length) {
    return <Empty>No weekly reports yet. The first runs Friday PM.</Empty>;
  }
  return (
    <ul className="divide-y divide-border/50 rounded-lg border border-border">
      {reports.map((r) => (
        <li key={r.period} className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm text-text">{r.title ?? r.period}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {shortDate(r.generated_at)}
            </div>
          </div>
          {r.web_view_link ? (
            <a
              href={r.web_view_link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border px-3 py-1 text-xs text-accent transition-colors hover:bg-panel-2"
            >
              Open PDF
            </a>
          ) : (
            <span className="font-mono text-[10px] text-muted">no file</span>
          )}
        </li>
      ))}
    </ul>
  );
}
