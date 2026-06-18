import { money } from "@/lib/format";
import type { LlsRawStats } from "@/lib/types";

const COLOR: Record<string, string> = {
  gray: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  yellow: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

// Loans waiting for approval, by Lendr pipeline stage.
export function PipelineBoard({ raw }: { raw: LlsRawStats }) {
  const pv = raw?.pipeline_value;
  if (!pv?.breakdown?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {pv.breakdown.map((s) => (
        <div
          key={s.slug}
          className={`ticked rounded-lg border bg-panel p-4 ${
            COLOR[s.color] ?? COLOR.gray
          }`}
        >
          <div className="font-mono text-[10px] uppercase tracking-wider opacity-80">
            {s.name}
          </div>
          <div className="tabular mt-2 font-mono text-xl font-semibold">
            {money(Number(s.total_value))}
          </div>
          <div className="mt-1 font-mono text-[10px] opacity-70">
            {s.loan_count} loan{s.loan_count === 1 ? "" : "s"}
          </div>
        </div>
      ))}
    </div>
  );
}
