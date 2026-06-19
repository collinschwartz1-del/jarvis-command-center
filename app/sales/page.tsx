import { getDeals, getDealAnalyses } from "@/lib/queries";
import { DealRow } from "@/components/deal-row";
import { AnalysisCard } from "@/components/analysis-card";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const [deals, analyses] = await Promise.all([getDeals(), getDealAnalyses()]);

  return (
    <div>
      <PageHeader
        title="SALES"
        subtitle="The pipeline, plus underwriting — deal emails screened against the LW buy box (multifamily) or routed to Flip Tracker (flips)."
      />

      <section className="mb-10">
        <SectionLabel>Pipeline · {deals.length}</SectionLabel>
        {deals.length ? (
          <div className="space-y-3">
            {deals.map((d) => (
              <DealRow key={d.id} deal={d} />
            ))}
          </div>
        ) : (
          <Empty>No deals in the pipeline yet.</Empty>
        )}
      </section>

      <section>
        <SectionLabel>Underwriting Analyses · {analyses.length}</SectionLabel>
        {analyses.length ? (
          <div className="grid gap-4">
            {analyses.map((a) => (
              <AnalysisCard key={a.id} a={a} href={`/sales/${a.id}`} />
            ))}
          </div>
        ) : (
          <Empty>
            No analyses yet. Deal emails with a T-12, rent roll, or OM get run
            through the LW underwriting skill; flips route to Flip Tracker.
          </Empty>
        )}
      </section>
    </div>
  );
}
