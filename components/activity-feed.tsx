import type { Activity } from "@/lib/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ActivityFeed({ items }: { items: Activity[] }) {
  if (!items.length) {
    return <p className="text-sm text-muted">No activity yet.</p>;
  }
  return (
    <ul className="space-y-0">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-start gap-3 border-b border-border py-2.5 last:border-0"
        >
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-zinc-300">{a.summary}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              {a.actor ?? "system"} · {a.kind}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted">
            {timeAgo(a.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}
