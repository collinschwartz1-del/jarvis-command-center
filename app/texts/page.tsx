import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { getTextIntel, CATEGORY_META, type IntelCard as Card } from "@/lib/textIntel";
import { IntelCard } from "@/components/text-intel/IntelCard";
import { ClassifyButton } from "@/components/text-intel/ClassifyButton";

export const dynamic = "force-dynamic";

export default function TextsPage() {
  const { cards, generatedAt, available } = getTextIntel();

  if (!available) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="TEXTS · INTEL"
          subtitle="Business intelligence mined locally from your iMessage history. Raw texts never leave your Mac."
        />
        <ClassifyButton />
        <Empty>
          No intel yet. Run the local pipeline in{" "}
          <span className="font-mono text-accent">~/Documents/my-ai-team/text-intel</span>:{" "}
          <span className="font-mono text-accent">
            npm run extract &amp;&amp; npm run filter &amp;&amp; npm run classify &amp;&amp; npm run digest
          </span>
          . This tab reads the local vault, so it only shows when run on your Mac.
        </Empty>
      </div>
    );
  }

  const active = cards.filter((c) => c.is_business && c.category !== "none");

  // Top actions: high priority OR owed reply, most recent first.
  const top = active
    .filter((c) => c.priority === "high" || c.owed_reply)
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, 7);

  const cats = Object.keys(CATEGORY_META) as Card["category"][];
  const byCat = cats
    .map((cat) => ({
      cat,
      meta: CATEGORY_META[cat],
      items: active
        .filter((c) => c.category === cat)
        .sort((a, b) => {
          const p = { high: 0, medium: 1, low: 2 };
          return p[a.priority] - p[b.priority] || b.lastTs - a.lastTs;
        }),
    }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.meta.order - b.meta.order);

  const highCount = active.filter((c) => c.priority === "high").length;
  const owedCount = active.filter((c) => c.owed_reply).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="TEXTS · INTEL"
        subtitle={`${active.length} business signals · ${highCount} high priority · ${owedCount} awaiting your reply${
          generatedAt ? ` · updated ${generatedAt.slice(0, 16).replace("T", " ")}` : ""
        }. Mined locally — raw texts never leave your Mac.`}
      />

      <ClassifyButton />

      {top.length > 0 && (
        <section>
          <SectionLabel>⭐ Top Actions</SectionLabel>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {top.map((c) => (
              <IntelCard key={`top-${c.thread}`} card={c} />
            ))}
          </div>
        </section>
      )}

      {byCat.map((g) => (
        <section key={g.cat}>
          <SectionLabel>
            {g.meta.icon} {g.meta.label} · {g.items.length}
          </SectionLabel>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {g.items.map((c) => (
              <IntelCard key={`${g.cat}-${c.thread}`} card={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
