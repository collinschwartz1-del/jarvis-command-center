import type { Agent } from "@/lib/types";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            agent.online
              ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
              : "bg-zinc-600"
          }`}
        />
        <span className="font-mono text-sm font-medium text-text">{agent.name}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">
          {timeAgo(agent.last_run_at)}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{agent.job}</p>
      {agent.last_summary && (
        <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-zinc-300">
          <span className="text-accent">↳ </span>
          {agent.last_summary}
        </p>
      )}
    </div>
  );
}
