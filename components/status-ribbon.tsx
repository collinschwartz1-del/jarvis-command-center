import { getTodayMetric } from "@/lib/queries";

// Server component — the thin "FIGURE IT THE FUCK OUT COCKPIT" status strip above the nav.
export async function StatusRibbon() {
  const metric = await getTodayMetric();
  const online = metric?.agents_online ?? 0;

  return (
    <div className="border-b border-border bg-bg/70">
      <div className="mx-auto flex h-7 max-w-6xl items-center gap-4 px-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        <span className="flex items-center gap-1.5 text-accent">
          <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" />
          System Online
        </span>
        <span className="text-border-bright">/</span>
        <span>Opus 4.8</span>
        <span className="text-border-bright">/</span>
        <span className="text-zinc-400">Figure It The Fuck Out Cockpit</span>
        <span className="ml-auto tabular text-zinc-400">
          {online} <span className="text-muted">agents online</span>
        </span>
      </div>
    </div>
  );
}
