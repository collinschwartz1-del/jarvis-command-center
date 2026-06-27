import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { getBrainStats, getRecentDecisions, getActionQueue } from "@/lib/brain-queries";
import { AskBrain } from "./ask-brain";
import { ActionQueue } from "./action-queue";

export const dynamic = "force-dynamic";

const BIZ_COLOR: Record<string, string> = {
  LeavenWealth: "text-amber-300",
  "Liquid Lending": "text-emerald-300",
  "Acreage Brothers": "text-sky-300",
  "Titan Mastermind": "text-violet-300",
  "MASC Investments": "text-rose-300",
  Other: "text-muted",
};

export default async function BusinessBrainPage() {
  const [stats, decisions, queue] = await Promise.all([getBrainStats(), getRecentDecisions(14), getActionQueue()]);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");

  return (
    <div className="space-y-8">
      <PageHeader
        title="BUSINESS BRAIN"
        subtitle={`${stats.total.toLocaleString()} business emails ingested across all companies (${fmt(stats.earliest)} – ${fmt(
          stats.latest
        )}). ${stats.principalCount.toLocaleString()} carry deep-extracted principal reasoning. Ask it anything — answers come straight from your own record.`}
      />

      <section>
        <SectionLabel>Action Queue · AI Operators Propose — You Decide ({queue.length})</SectionLabel>
        <ActionQueue items={queue} />
      </section>

      <section>
        <SectionLabel>Ask the Brain</SectionLabel>
        <AskBrain />
      </section>

      <section>
        <SectionLabel>By Company</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.byBusiness.map((b) => (
            <div key={b.business} className="tile rounded-lg border border-border bg-panel p-3">
              <div className={`font-mono text-2xl font-semibold ${BIZ_COLOR[b.business] ?? "text-text"}`}>{b.count.toLocaleString()}</div>
              <div className="mt-0.5 text-xs text-muted">{b.business}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Decisions Captured from Principal Mail (Chris / Collin)</SectionLabel>
        {decisions.length ? (
          <div className="space-y-1.5">
            {decisions.map((d, i) => (
              <div key={i} className="flex items-baseline gap-3 rounded-md border border-border bg-panel px-3 py-2">
                <span className="text-accent">▸</span>
                <span className="flex-1 text-sm text-text">{d.decision}</span>
                <span className="whitespace-nowrap text-[11px] text-muted">
                  {d.business} · {d.occurred_at ? new Date(d.occurred_at).toLocaleDateString() : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No principal decisions extracted yet.</Empty>
        )}
      </section>
    </div>
  );
}
