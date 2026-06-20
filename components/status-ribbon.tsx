import { getTodayMetric, getLastSync } from "@/lib/queries";
import { timeAgo } from "@/lib/format";

// Server component — the thin status strip above the nav.
// The dot is an HONEST heartbeat: it reads the last `sync_run` and goes
// green/amber/red by how long ago the daily pipeline actually landed data.
// (It used to hardcode "System Online" regardless of whether anything ran.)
export async function StatusRibbon() {
  const [metric, lastSync] = await Promise.all([getTodayMetric(), getLastSync()]);
  const online = metric?.agents_online ?? 0;

  const ageHours = lastSync
    ? (Date.now() - new Date(lastSync).getTime()) / 36e5
    : null;

  // Pipeline runs ~daily (7am board pass). Fresh if it landed within the last
  // day, stale once it misses a morning, dead if it's been quiet 2+ days/never.
  const health =
    ageHours == null
      ? "dead"
      : ageHours < 28
        ? "ok"
        : ageHours < 52
          ? "stale"
          : "dead";

  const dot =
    health === "ok"
      ? "bg-accent"
      : health === "stale"
        ? "bg-amber-400"
        : "bg-red-500";
  const text =
    health === "ok"
      ? "text-accent"
      : health === "stale"
        ? "text-amber-400"
        : "text-red-500";
  const label = lastSync ? `Synced ${timeAgo(lastSync)}` : "No sync yet";

  return (
    <div className="border-b border-border bg-bg/70">
      <div className="mx-auto flex h-7 max-w-6xl items-center gap-4 px-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        <span className={`flex items-center gap-1.5 ${text}`} title="Last successful data sync">
          <span className={`${health === "ok" ? "dot-pulse" : ""} h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
        <span className="text-border-bright">/</span>
        <span>Opus 4.8</span>
        <span className="hidden text-border-bright sm:inline">/</span>
        <span className="hidden text-zinc-400 sm:inline">Figure It The Fuck Out Cockpit</span>
        <span className="ml-auto tabular text-zinc-400">
          {online} <span className="text-muted">agents online</span>
        </span>
      </div>
    </div>
  );
}
