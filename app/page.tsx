import ReactMarkdown from "react-markdown";
import {
  getTodayMetric,
  getLatestBriefing,
  getCards,
  getActivity,
} from "@/lib/queries";
import { MetricTile } from "@/components/metric-tile";
import { ActivityFeed } from "@/components/activity-feed";
import { TierBadge } from "@/components/badges";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CorePage() {
  const [metric, briefing, cards, activity] = await Promise.all([
    getTodayMetric(),
    getLatestBriefing(),
    getCards(),
    getActivity(),
  ]);

  const needsDecision = cards.filter(
    (c) => c.status === "pending" && c.tier === "3"
  );

  return (
    <div>
      <PageHeader
        title="CORE"
        subtitle="The daily picture — what moved, what needs you, what's next."
      />

      {/* metric tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Wake" value={metric?.wakes ?? 0} sub="board passes" />
        <MetricTile label="Workflows" value={metric?.workflows ?? 0} sub="cards in play" />
        <MetricTile label="Spend" value={`$${metric?.spend_usd ?? 0}`} sub="today" />
        <MetricTile label="Agents" value={`${metric?.agents_online ?? 0}`} sub="online" />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        {/* briefing */}
        <section className="lg:col-span-2">
          <SectionLabel>Today's Brief</SectionLabel>
          <div className="ticked overflow-hidden rounded-lg border border-border bg-panel">
            <div className="border-l-2 border-accent/70 p-5">
              {briefing ? (
                <article className="max-w-none text-sm leading-relaxed text-zinc-300 [&_h1]:mb-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:tracking-wide [&_h1]:text-text [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:font-mono [&_h2]:text-[11px] [&_h2]:uppercase [&_h2]:tracking-[0.18em] [&_h2]:text-accent [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_strong]:text-zinc-100 [&_ul]:ml-5 [&_ul]:list-disc">
                  <ReactMarkdown>{briefing.content}</ReactMarkdown>
                </article>
              ) : (
                <Empty>No briefing yet. Run a board pass.</Empty>
              )}
            </div>
          </div>
        </section>

        {/* right rail */}
        <div className="space-y-8">
          <section>
            <SectionLabel>Needs Your Decision</SectionLabel>
            {needsDecision.length ? (
              <div className="space-y-3">
                {needsDecision.map((c) => (
                  <Link
                    key={c.id}
                    href="/projects"
                    className="ticked block rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3.5 transition-colors hover:border-rose-500/50 hover:bg-rose-500/10"
                  >
                    <TierBadge tier={c.tier} />
                    <p className="mt-2 text-sm font-medium leading-snug text-text">
                      {c.title}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>Nothing waiting on a tier-3 decision.</Empty>
            )}
          </section>

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
