import { getTrends } from "@/lib/trends";
import { MetricTile } from "@/components/metric-tile";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { Lightbulb } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const t = await getTrends(30);
  const maxDay = Math.max(1, ...t.perDay.map((d) => d.count));
  const maxGroup = Math.max(1, ...t.byGroup.map((g) => g.count));
  const { captured, cleared } = t.captureVsClear;

  return (
    <div>
      <PageHeader
        title="TRENDS · PATTERNS"
        subtitle="How you actually operate — what Jarvis is learning from your decisions, captures, and hand-offs over the last 30 days."
      />

      {t.totalActions === 0 ? (
        <Empty>
          No actions logged yet. As you approve, capture, delegate, and dismiss,
          Jarvis learns your patterns and surfaces them here.
        </Empty>
      ) : (
        <div className="space-y-10">
          {/* Jarvis suggests — the learning loop */}
          <section>
            <div className="ticked rounded-lg border border-accent/30 bg-accent/[0.05] p-5">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-accent">
                <Lightbulb size={14} /> Jarvis suggests
              </div>
              <ul className="mt-3 space-y-2">
                {t.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-zinc-200">
                    <span className="text-accent">→</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* headline metrics */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricTile label="Actions" value={t.totalActions} sub="last 30d" />
            <MetricTile
              label="Delegation"
              value={`${Math.round(t.delegationRate * 100)}%`}
              sub="handed off"
            />
            <MetricTile label="Captured" value={captured} sub="email → work" />
            <MetricTile label="Cleared" value={cleared} sub="email dismissed" />
          </div>

          {/* throughput — last 14 days */}
          <section>
            <SectionLabel>Throughput · last 14 days</SectionLabel>
            <div className="ticked flex items-end gap-1.5 rounded-lg border border-border bg-panel p-4">
              {t.perDay.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t bg-accent/60"
                      style={{ height: `${(d.count / maxDay) * 100}%` }}
                      title={`${d.date}: ${d.count}`}
                    />
                  </div>
                  <span className="font-mono text-[8px] text-muted">
                    {d.date.slice(8)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* where your time goes */}
          <section>
            <SectionLabel>Where your time goes</SectionLabel>
            <div className="space-y-2.5">
              {t.byGroup.map((g) => (
                <div key={g.group} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm text-zinc-300">{g.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-panel-2">
                    <div
                      className="h-full rounded bg-accent/50"
                      style={{ width: `${(g.count / maxGroup) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-muted">
                    {g.count}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-10 lg:grid-cols-2">
            {/* most demanding relationships */}
            <section>
              <SectionLabel>Most demanding · who needs you</SectionLabel>
              {t.demanding.length ? (
                <div className="space-y-2">
                  {t.demanding.map((p) => (
                    <div
                      key={p.name}
                      className="ticked flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-2.5"
                    >
                      <span className="flex-1 text-sm font-medium text-text">
                        {p.name}
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        {p.threads} thread{p.threads === 1 ? "" : "s"}
                      </span>
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[11px] text-accent">
                        {p.open} open
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No open actions on you. Inbox zero on relationships.</Empty>
              )}
            </section>

            {/* what you turn into work */}
            <section>
              <SectionLabel>What you turn into work</SectionLabel>
              {t.captureSources.length ? (
                <div className="space-y-2">
                  {t.captureSources.map((s) => (
                    <div
                      key={s.name}
                      className="ticked flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-2.5"
                    >
                      <span className="flex-1 text-sm font-medium text-text">
                        {s.name}
                      </span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                        {s.count} captured
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>
                  Capture email items into cards and Jarvis will learn which
                  relationships drive your work.
                </Empty>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
