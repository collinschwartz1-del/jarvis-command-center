import type { AmAgendas } from "@/lib/types";

// Per-meeting agendas, mapped to the Meeting Operating System. Each is a
// <details> so the page stays scannable; sections with no items are hidden.
const ORDER = ["huddle", "warRoom", "redZoneCmd", "stabilized", "leadership"];

export function Agendas({ agendas }: { agendas: AmAgendas }) {
  const keys = ORDER.filter((k) => agendas[k]);
  return (
    <div className="space-y-2">
      {keys.map((k) => {
        const a = agendas[k];
        const sections = Object.entries(a.sections).filter(([, items]) => items && items.length);
        const total = sections.reduce((n, [, items]) => n + items.length, 0);
        return (
          <details key={k} className="rounded-lg border border-border bg-panel/30 p-3" open={k === "warRoom" || k === "redZoneCmd"}>
            <summary className="cursor-pointer select-none text-sm font-semibold text-text">
              {a.title} <span className="font-mono text-[10px] text-muted">· {total} items</span>
            </summary>
            <div className="mt-3 space-y-3">
              {sections.length ? (
                sections.map(([name, items]) => (
                  <div key={name}>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{name}</div>
                    <ul className="mt-1 space-y-1">
                      {items.map((s, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-text">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-muted">No items this week.</p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
