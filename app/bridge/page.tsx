import { getHandoffs } from "@/lib/queries";
import { HandoffRow } from "@/components/handoff-row";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BridgePage() {
  const handoffs = await getHandoffs();
  const fromJarvis = handoffs.filter((h) => h.direction === "from_jarvis");
  const toJarvis = handoffs.filter((h) => h.direction === "to_jarvis");

  return (
    <div>
      <PageHeader
        title="BRIDGE"
        subtitle="The Hermes courier line between Jarvis (deal-flow + ops) and SUE (marketing + knowledge). Every handoff, both directions."
      />

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <SectionLabel>Jarvis → SUE · {fromJarvis.length}</SectionLabel>
          {fromJarvis.length ? (
            <div className="space-y-3">
              {fromJarvis.map((h) => (
                <HandoffRow key={h.id} handoff={h} />
              ))}
            </div>
          ) : (
            <Empty>No outbound handoffs.</Empty>
          )}
        </section>

        <section>
          <SectionLabel>SUE → Jarvis · {toJarvis.length}</SectionLabel>
          {toJarvis.length ? (
            <div className="space-y-3">
              {toJarvis.map((h) => (
                <HandoffRow key={h.id} handoff={h} />
              ))}
            </div>
          ) : (
            <Empty>No inbound handoffs.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}
