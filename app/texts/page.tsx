import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { getTextIntel, CATEGORY_META, type IntelCard as Card } from "@/lib/textIntel";
import { IntelCard } from "@/components/text-intel/IntelCard";
import { ClassifyButton } from "@/components/text-intel/ClassifyButton";
import { TextsReconciler } from "@/components/text-intel/TextsReconciler";

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

  // Replied-today items get their own muted lane (confirm-then-fade); everything
  // else is live. New-inbound items (they texted back — your move) float up.
  const repliedToday = cards.filter((c) => c.replied);
  const active = cards.filter(
    (c) => c.is_business && c.category !== "none" && !c.replied
  );

  // Top actions: new inbound, owed reply, or high priority — newest first.
  const top = active
    .filter((c) => c.newInbound || c.owed_reply || c.priority === "high")
    .sort(
      (a, b) =>
        Number(!!b.newInbound) - Number(!!a.newInbound) ||
        Number(!!b.owed_reply) - Number(!!a.owed_reply) ||
        b.lastTs - a.lastTs
    )
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

      <div className="flex flex-wrap items-center gap-3">
        <ClassifyButton />
        <TextsReconciler />
      </div>

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

      {repliedToday.length > 0 && (
        <section>
          <SectionLabel>✓ Replied today · {repliedToday.length}</SectionLabel>
          <div className="grid gap-2 lg:grid-cols-2">
            {repliedToday.map((c) => (
              <div
                key={`replied-${c.thread}`}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-panel/50 px-3.5 py-2.5"
              >
                <span className="text-emerald-400">✓</span>
                <span className="flex-1 truncate text-sm text-muted">
                  <span className="text-zinc-300">{c.contact}</span> — {c.summary}
                </span>
                {c.repliedAt && (
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    replied {c.repliedAt.slice(11, 16)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            cleared from your queue · fades on tomorrow&rsquo;s run
          </p>
        </section>
      )}
    </div>
  );
}
