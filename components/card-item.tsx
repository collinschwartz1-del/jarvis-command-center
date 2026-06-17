"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import type { Card } from "@/lib/types";
import { TierBadge, StatusBadge } from "./badges";
import { approveCard, dismissCard } from "@/app/actions";

export function CardItem({ card }: { card: Card }) {
  const [pending, start] = useTransition();
  const actionable = card.status === "pending";

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={card.tier} />
        <StatusBadge status={card.status} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          {card.seat}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted">{card.id}</span>
      </div>

      <h3 className="mt-3 text-sm font-medium leading-snug text-text">
        {card.title}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-muted">{card.why}</p>

      {card.result && (
        <div className="mt-3 rounded border border-border bg-panel-2 p-2.5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/80">
            result
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">{card.result}</p>
        </div>
      )}

      {actionable && (
        <div className="mt-4 flex gap-2">
          <button
            disabled={pending}
            onClick={() => start(() => approveCard(card.id))}
            className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Check size={13} /> Approve
          </button>
          <button
            disabled={pending}
            onClick={() => start(() => dismissCard(card.id))}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-panel-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text disabled:opacity-50"
          >
            <X size={13} /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
