import { getAmSnapshot } from "@/lib/queries";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { ClassificationBoard } from "@/components/am/ClassificationBoard";
import { OwnerBrief } from "@/components/am/OwnerBrief";
import { Agendas } from "@/components/am/Agendas";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetMgmtPage() {
  const snap = await getAmSnapshot();
  const raw = snap?.raw;

  return (
    <div className="space-y-8">
      <PageHeader
        title="ASSET MANAGEMENT"
        subtitle={
          snap
            ? `LeavenWealth Asset Management OS — ${snap.red_count} Red Zone · ${snap.nonstab_count} Non-Stabilized · ${snap.stab_count} Stabilized. Synced ${timeAgo(snap.captured_at)}.`
            : "Run the sync to classify the portfolio and build agendas."
        }
      />

      {raw ? (
        <>
          <section>
            <SectionLabel>Owner's Brief · What to Raise This Week</SectionLabel>
            <OwnerBrief brief={raw.ownerBrief} ai={raw.ai} />
          </section>

          <section>
            <SectionLabel>Portfolio Classification</SectionLabel>
            <ClassificationBoard cls={raw.classification} changes={raw.changes} />
          </section>

          <section>
            <SectionLabel>Meeting Agendas</SectionLabel>
            <Agendas agendas={raw.agendas} />
          </section>
        </>
      ) : (
        <Empty>
          No asset-management snapshot yet. Run{" "}
          <span className="font-mono text-accent">npm run pgo-sync</span> to classify the
          portfolio.
        </Empty>
      )}
    </div>
  );
}
