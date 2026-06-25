import { compactMoney } from "@/lib/format";
import type { AmOwnerBrief, AmAiSummary } from "@/lib/types";

// Collin's owner-altitude brief: the AI headline + the things HE should raise,
// grouped by lever (expenses, collections, escalations, trends, orphans).
export function OwnerBrief({ brief, ai }: { brief: AmOwnerBrief; ai: AmAiSummary | null }) {
  const Group = ({ title, items, tone }: { title: string; items: string[]; tone?: string }) =>
    items.length ? (
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">{title}</div>
        <ul className="mt-1.5 space-y-1">
          {items.map((s, i) => (
            <li key={i} className={`flex gap-2 text-sm ${tone || "text-text"}`}>
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const q = brief.questions;
  const qGroups: { title: string; items: string[]; tone?: string }[] = q
    ? [
        { title: "Open the meeting", items: q.portfolio },
        { title: "Data integrity — resolve before next week", items: q.dataIntegrity, tone: "text-amber-300" },
        { title: "Red Zone — ask on each", items: q.redZone, tone: "text-red-300" },
        { title: "Collections to press", items: q.collections },
        { title: "Expenses to verify", items: q.expenses, tone: "text-amber-300" },
      ].filter((g) => g.items.length)
    : [];

  return (
    <div className="space-y-5">
      {qGroups.length > 0 && (
        <div className="rounded-lg border border-border bg-surface/40 p-4">
          <div className="text-sm font-semibold text-text">Questions to Ask in the Meeting</div>
          <div className="mt-3 space-y-4">
            {qGroups.map((g) => (
              <Group key={g.title} title={g.title} items={g.items} tone={g.tone} />
            ))}
          </div>
        </div>
      )}

      {ai && (
        <div className="rounded-lg border border-accent/30 bg-accent/[0.06] p-4">
          <div className="text-sm font-semibold text-text">{ai.headline}</div>
          <ul className="mt-2 space-y-1.5">
            {ai.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm text-text">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Group title="Escalate / Reclassify" items={brief.propertiesToEscalate} tone="text-red-300" />
        <Group title="Status Changes" items={brief.statusChanges} />
        <Group title="Expenses to Question" items={brief.expensesToQuestion} tone="text-amber-300" />
        <Group title="Collections to Press" items={brief.collectionsToPress} />
        <Group title="Trends to Watch" items={brief.trendsToWatch} />
        {brief.orphans.length > 0 && (
          <Group title="No Meeting Home (needs a place)" items={brief.orphans} tone="text-amber-300" />
        )}
      </div>
    </div>
  );
}
