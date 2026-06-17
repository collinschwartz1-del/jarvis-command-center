import { getCards } from "@/lib/queries";
import { CardItem } from "@/components/card-item";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import type { CardStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROUPS: { status: CardStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "review", label: "In Review" },
  { status: "done", label: "Done" },
  { status: "dismissed", label: "Dismissed" },
];

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

      <div className="space-y-8">
        {GROUPS.map((g) => {
          const group = cards.filter((c) => c.status === g.status);
          if (!group.length) return null;
          return (
            <section key={g.status}>
              <SectionLabel>
                {g.label} · {group.length}
              </SectionLabel>
              <div className="grid gap-3 md:grid-cols-2">
                {group.map((c) => (
                  <CardItem key={c.id} card={c} />
                ))}
              </div>
            </section>
          );
        })}
        {!cards.length && <Empty>No cards staged yet.</Empty>}
      </div>
    </div>
  );
}
