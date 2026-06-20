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
        Approving (or dismissing) here updates the command center{" "}
        <span className="text-zinc-300">and writes the decision back to the
        source Jarvis card file</span>, so{" "}
        <span className="font-mono text-zinc-300">/pickup</span> sees it on the
        next pass.
      </p>

      {cards.length ? (
        <ProjectsBoard cards={cards} />
      ) : (
        <Empty>No cards staged yet.</Empty>
      )}
    </div>
  );
}
