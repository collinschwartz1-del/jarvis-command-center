import { getAgents } from "@/lib/queries";
import { AgentCard } from "@/components/agent-card";
import { PageHeader, SectionLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await getAgents();
  const structural = agents.filter((a) => a.kind === "structural");
  const domain = agents.filter((a) => a.kind === "domain");

  return (
    <div>
      <PageHeader
        title="AGENTS"
        subtitle="The seats of the board. Structural seats run the machine; domain seats own Collin's recurring jobs."
      />

      <section className="mb-8">
        <SectionLabel>Structural · {structural.length}</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {structural.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Domain · {domain.length}</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {domain.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>
    </div>
  );
}
