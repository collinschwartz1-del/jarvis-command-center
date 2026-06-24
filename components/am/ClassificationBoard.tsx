import { money } from "@/lib/format";
import type { AmClassification, AmChange } from "@/lib/types";

const TIERS = [
  { key: "redZone", label: "Red Zone", ring: "border-red-500/40", dot: "bg-red-500", count: "red" },
  { key: "nonStabilized", label: "Non-Stabilized", ring: "border-amber-500/40", dot: "bg-amber-400", count: "nonStab" },
  { key: "stabilized", label: "Stabilized", ring: "border-emerald-500/30", dot: "bg-emerald-400", count: "stab" },
] as const;

// Three-column classification board driven by the OS rules. Red Zone + Non-Stab
// show reasons; Stabilized is collapsed to a count + any exceptions.
export function ClassificationBoard({ cls, changes }: { cls: AmClassification; changes: AmChange[] }) {
  return (
    <div className="space-y-4">
      {changes.length > 0 && (
        <div className="rounded-lg border border-border bg-panel/40 p-3 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">Status changes · </span>
          {changes.map((c, i) => (
            <span key={i} className="mr-3">
              <span className="text-text">{c.name}</span>{" "}
              <span className={c.dir === "escalated" ? "text-red-400" : "text-emerald-400"}>
                {c.from} → {c.to}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {TIERS.map((t) => {
          const rows = cls[t.key];
          return (
            <div key={t.key} className={`rounded-lg border ${t.ring} p-3`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-text">{t.label}</span>
                <span className="ml-auto font-mono text-sm text-muted">{cls.counts[t.count]}</span>
              </div>
              {t.key === "stabilized" ? (
                <p className="px-1 py-2 text-[11px] text-muted">
                  {cls.counts.stab} properties performing within tolerance. Oversight, not management.
                </p>
              ) : rows.length ? (
                <ul className="space-y-2">
                  {rows.map((p) => (
                    <li key={p.property_id} className="rounded border border-border/60 bg-panel/30 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text">{p.name}</span>
                        <span className={`font-mono text-xs ${p.noi < 0 ? "text-red-400" : "text-muted"}`}>{money(p.noi)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted">{p.reasons.slice(0, 3).join(" · ")}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 py-2 text-[11px] text-muted">None.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
