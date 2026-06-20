import ReactMarkdown from "react-markdown";
import {
  getTodayMetric,
  getLatestBriefing,
  getActivity,
} from "@/lib/queries";
import { getActionQueue } from "@/lib/action-queue";
import { MetricTile } from "@/components/metric-tile";
import { ActivityFeed } from "@/components/activity-feed";
import { ActionQueueBoard } from "@/components/action-queue-client";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CorePage() {
  const [metric, briefing, activity, queue] = await Promise.all([
    getTodayMetric(),
    getLatestBriefing(),
    getActivity(),
    getActionQueue(),
  ]);

  return (
    <div>
      <PageHeader
        title="CORE"
        subtitle="What needs you right now — ranked across every desk."
      />

      {/* THE SPINE: one ranked, cross-domain queue — filter + resolve in place. */}
      <section>
        <SectionLabel>⚡ Needs You · {queue.length}</SectionLabel>
        <div className="mt-3">
          {queue.length ? (
            <ActionQueueBoard items={queue} />
          ) : (
            <Empty>Inbox zero across every desk. Nothing is waiting on you.</Empty>
          )}
        </div>
      </section>

      {/* Reference below the fold: metrics, brief, activity. */}
      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Wake" value={metric?.wakes ?? 0} sub="board passes" />
        <MetricTile label="Workflows" value={metric?.workflows ?? 0} sub="cards in play" />
        <MetricTile label="Spend" value={`$${metric?.spend_usd ?? 0}`} sub="today" />
        <MetricTile label="Agents" value={`${metric?.agents_online ?? 0}`} sub="online" />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        {/* briefing */}
        <section className="lg:col-span-2">
          <SectionLabel>Today's Brief</SectionLabel>
          <details className="ticked group overflow-hidden rounded-lg border border-border bg-panel">
            <summary className="cursor-pointer list-none border-l-2 border-accent/70 p-4 text-sm text-muted transition-colors hover:text-text">
              {briefing
                ? "Read today's brief →"
                : "No briefing yet. Run a board pass."}
            </summary>
            {briefing && (
              <div className="border-l-2 border-accent/70 px-5 pb-5">
                <article className="max-w-none text-sm leading-relaxed text-zinc-300 [&_h1]:mb-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:tracking-wide [&_h1]:text-text [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:font-mono [&_h2]:text-[11px] [&_h2]:uppercase [&_h2]:tracking-[0.18em] [&_h2]:text-accent [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_strong]:text-zinc-100 [&_ul]:ml-5 [&_ul]:list-disc">
                  <ReactMarkdown>{briefing.content}</ReactMarkdown>
                </article>
              </div>
            )}
          </details>
        </section>

        {/* right rail */}
        <div className="space-y-8">
          <section>
            <SectionLabel>What Changed</SectionLabel>
            <div className="ticked rounded-lg border border-border bg-panel px-4 py-1">
              <ActivityFeed items={activity} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
