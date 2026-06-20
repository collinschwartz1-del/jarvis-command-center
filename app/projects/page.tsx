import { getCards } from "@/lib/queries";
import { ProjectsBoard } from "@/components/projects-board";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const cards = await getCards();

  return (
    <div>
      <PageHeader
        title="PROJECTS"
        subtitle="Every move is a card — a tier, a why, and (when done) a result. Approve to commit it."
      />

      <p className="mb-6 rounded-lg border border-border bg-panel-2 px-4 py-2.5 text-xs text-muted">
        Approving here updates the command center. Syncing decisions back to the
        Jarvis files (so <span className="font-mono text-zinc-300">/pickup</span>{" "}
        executes them) is the Phase 4 runner.
      </p>

      {cards.length ? (
        <ProjectsBoard cards={cards} />
      ) : (
        <Empty>No cards staged yet.</Empty>
      )}
    </div>
  );
}
