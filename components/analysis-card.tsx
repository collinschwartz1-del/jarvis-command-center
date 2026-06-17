import { Building2, Hammer, AlertTriangle, HelpCircle, FileText } from "lucide-react";
import type { DealAnalysis } from "@/lib/types";

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted border-border bg-panel-2";
  if (score >= 7) return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  if (score >= 5) return "text-amber-300 border-amber-500/40 bg-amber-500/10";
  return "text-rose-300 border-rose-500/40 bg-rose-500/10";
}

export function AnalysisCard({ a }: { a: DealAnalysis }) {
  const isFlip = a.asset_type === "flip";
  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        {isFlip ? (
          <Hammer size={15} className="text-amber-300" />
        ) : (
          <Building2 size={15} className="text-accent" />
        )}
        <span className="text-sm font-semibold text-text">{a.deal_name}</span>
        {a.address && <span className="font-mono text-[11px] text-muted">{a.address}</span>}
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded border px-2.5 py-1 font-mono text-xs font-semibold ${scoreColor(
            a.fit_score
          )}`}
        >
          {a.fit_score != null ? `LW FIT ${a.fit_score}/10` : a.routed_to ? "ROUTED" : "SCREEN"}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>{a.asset_type}</span>
        {a.units != null && (
          <>
            <span className="text-border-bright">/</span>
            <span>{a.units} units</span>
          </>
        )}
        {a.source && (
          <>
            <span className="text-border-bright">/</span>
            <span>{a.source}</span>
          </>
        )}
      </div>

      {a.verdict && (
        <p className="mt-3 border-l-2 border-accent/60 pl-3 text-sm leading-relaxed text-zinc-200">
          {a.verdict}
        </p>
      )}

      {a.snapshot && <p className="mt-3 text-sm leading-relaxed text-muted">{a.snapshot}</p>}

      {a.routed_to && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
          <Hammer size={12} /> Routed to {a.routed_to}
        </div>
      )}

      {a.fit_table.length > 0 && (
        <div className="mt-4 overflow-hidden rounded border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-panel-2 font-mono uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Metric</th>
                <th className="px-3 py-1.5 font-medium">Deal</th>
                <th className="px-3 py-1.5 font-medium">LW Target</th>
                <th className="px-3 py-1.5 font-medium">Read</th>
              </tr>
            </thead>
            <tbody>
              {a.fit_table.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5 text-zinc-300">{r.metric}</td>
                  <td className="px-3 py-1.5 text-zinc-200">{r.deal}</td>
                  <td className="px-3 py-1.5 text-muted">{r.target}</td>
                  <td className="px-3 py-1.5 text-zinc-300">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.red_flags.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-rose-400/80">
            <AlertTriangle size={12} /> Red Flags
          </div>
          <ul className="mt-1.5 space-y-1">
            {a.red_flags.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-300">
                <span className="text-rose-400">▸</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.questions.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent/80">
            <HelpCircle size={12} /> Questions for Broker
          </div>
          <ul className="mt-1.5 space-y-1">
            {a.questions.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-300">
                <span className="text-accent">▸</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.docs_status && (
        <div className="mt-4 flex items-start gap-1.5 rounded border border-border bg-panel-2 p-2.5 text-xs text-muted">
          <FileText size={12} className="mt-0.5 shrink-0" />
          {a.docs_status}
        </div>
      )}
    </div>
  );
}
