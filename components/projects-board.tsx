"use client";

import { useState } from "react";
import type { Card, CardStatus, CardTier } from "@/lib/types";
import { CardItem } from "@/components/card-item";
import { SectionLabel } from "@/components/ui";

// Open work stays on screen; closed (done/dismissed) hides behind a toggle so the
// board reads as "what's live," not an archive.
const OPEN: { status: CardStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "review", label: "In Review" },
];
const CLOSED: { status: CardStatus; label: string }[] = [
  { status: "done", label: "Done" },
  { status: "dismissed", label: "Dismissed" },
];

type TierFilter = "all" | CardTier;

export function ProjectsBoard({ cards }: { cards: Card[] }) {
  const [tier, setTier] = useState<TierFilter>("all");
  const [showClosed, setShowClosed] = useState(false);

  const byTier = (c: Card) => tier === "all" || c.tier === tier;
  const groups = showClosed ? [...OPEN, ...CLOSED] : OPEN;
  const tiers: TierFilter[] = ["all", "3", "2", "1"];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {tiers.map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              tier === t
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-border bg-panel-2 text-muted hover:text-text"
            }`}
          >
            {t === "all" ? "All tiers" : `Tier ${t}`}{" "}
            {cards.filter((c) => t === "all" || c.tier === t).length}
          </button>
        ))}
        <button
          onClick={() => setShowClosed((v) => !v)}
          className={`ml-auto rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
            showClosed
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-border bg-panel-2 text-muted hover:text-text"
          }`}
        >
          {showClosed ? "✓ " : ""}Show closed
        </button>
      </div>

      <div className="space-y-8">
        {groups.map((g) => {
          const group = cards.filter((c) => c.status === g.status && byTier(c));
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
      </div>
    </div>
  );
}
