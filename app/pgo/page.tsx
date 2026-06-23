import { getPgoSnapshot, getPgoProperties, getPgoReports } from "@/lib/queries";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { StatTiles } from "@/components/pgo/StatTiles";
import { NoiTrend } from "@/components/pgo/NoiTrend";
import { Aging } from "@/components/pgo/Aging";
import { PropertyTable } from "@/components/pgo/PropertyTable";
import { Reports } from "@/components/pgo/Reports";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PgoPage() {
  const [snap, properties, reports] = await Promise.all([
    getPgoSnapshot(),
    getPgoProperties(),
    getPgoReports(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="PGO · PROPERTY MGMT"
        subtitle={
          snap
            ? `Point Guard Omaha — live from Buildium (BigQuery). Financials ${snap.period} · synced ${timeAgo(
                snap.captured_at
              )}.`
            : "Point Guard Omaha — run the PGO sync to populate this dashboard."
        }
      />

      {snap ? (
        <>
          {/* 1 — portfolio stats */}
          <StatTiles snap={snap} />

          {/* 2 — NOI trend + A/R aging */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <SectionLabel>Operating NOI · Last 6 Months</SectionLabel>
              <NoiTrend trend={snap.raw?.trend ?? []} />
            </div>
            <div>
              <SectionLabel>Delinquent A/R Aging</SectionLabel>
              <Aging snap={snap} />
            </div>
          </section>

          {/* 3 — per-property rollup */}
          <section>
            <SectionLabel>Properties · {properties.length}</SectionLabel>
            {properties.length ? (
              <PropertyTable properties={properties} />
            ) : (
              <Empty>No property rows cached yet.</Empty>
            )}
          </section>

          {/* 4 — recurring charges (rent roll) — pending base-table grant from John */}
          <section>
            <SectionLabel>Recurring Charges · Rent Roll</SectionLabel>
            {snap.raw?.recurring_charges_available ? (
              <Empty>Recurring charges available — wire the rent-roll view in.</Empty>
            ) : (
              <Empty>
                Pending data access. The recurring_charges_schedule view needs its base
                table authorized to pgo_shared (one grant from John) — this section fills
                in automatically once that lands.
              </Empty>
            )}
          </section>

          {/* 5 — weekly report archive */}
          <section>
            <SectionLabel>Weekly Reports</SectionLabel>
            <Reports reports={reports} />
          </section>
        </>
      ) : (
        <Empty>
          No PGO snapshot yet. Run{" "}
          <span className="font-mono text-accent">npm run pgo-sync</span> to pull from
          BigQuery.
        </Empty>
      )}
    </div>
  );
}
