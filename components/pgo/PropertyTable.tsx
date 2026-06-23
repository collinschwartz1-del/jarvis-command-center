import { money } from "@/lib/format";
import type { PgoProperty } from "@/lib/types";

// Per-property rollup, pre-sorted by NOI desc (query order). Flags negative-NOI
// and any property with a pending eviction or 90+ day balance.
export function PropertyTable({ properties }: { properties: PgoProperty[] }) {
  if (!properties.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-panel/50 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
            <th className="px-3 py-2">Property</th>
            <th className="px-3 py-2 text-right">Income</th>
            <th className="px-3 py-2 text-right">Expense</th>
            <th className="px-3 py-2 text-right">NOI</th>
            <th className="px-3 py-2 text-right">A/R</th>
            <th className="px-3 py-2 text-right">90+</th>
            <th className="px-3 py-2 text-right">Evict</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.property_id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 text-text">{p.property_name ?? `#${p.property_id}`}</td>
              <td className="px-3 py-2 text-right font-mono text-muted">{money(p.operating_income)}</td>
              <td className="px-3 py-2 text-right font-mono text-muted">{money(p.operating_expense)}</td>
              <td
                className={`px-3 py-2 text-right font-mono font-semibold ${
                  (p.noi ?? 0) < 0 ? "text-red-400" : "text-text"
                }`}
              >
                {money(p.noi)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted">
                {p.ar_total ? money(p.ar_total) : "—"}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${
                  (p.ar_over_90 ?? 0) > 0 ? "text-red-400" : "text-muted"
                }`}
              >
                {p.ar_over_90 ? money(p.ar_over_90) : "—"}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${
                  (p.evictions_pending ?? 0) > 0 ? "text-red-400" : "text-muted"
                }`}
              >
                {p.evictions_pending || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
