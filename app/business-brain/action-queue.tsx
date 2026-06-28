"use client";

import { useState, useTransition } from "react";
import { resolveActionItem } from "./actions";
import type { ActionItem } from "@/lib/brain-queries";

const URGENCY: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-amber-500",
  low: "border-l-muted",
};
const FN_LABEL: Record<string, string> = {
  asset_management: "Asset Mgmt",
  insurance: "Insurance",
  investor_relations: "Investor Rel",
  accounting_finance: "Finance",
  legal: "Legal",
};

// Approved items you're actively working — mark Done when handled.
export function WorkingList({ items }: { items: ActionItem[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const visible = items.filter((i) => !hidden.has(i.id));
  if (!visible.length) return null;
  function done(id: string) {
    setHidden((h) => new Set(h).add(id));
    startTransition(() => resolveActionItem(id, "actioned").catch(() => setHidden((h) => { const n = new Set(h); n.delete(id); return n; })));
  }
  return (
    <div className="space-y-1.5">
      {visible.map((it) => (
        <div key={it.id} className="flex items-center gap-3 rounded-md border border-border bg-panel/60 px-3 py-2">
          <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">{FN_LABEL[it.function] ?? it.function}</span>
          <span className="flex-1 text-sm text-text">{it.title}</span>
          <button onClick={() => done(it.id)} disabled={pending} className="rounded-md border border-border bg-panel-2 px-3 py-1 text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
            Done
          </button>
        </div>
      ))}
    </div>
  );
}

export function ActionQueue({ items }: { items: ActionItem[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = items.filter((i) => !hidden.has(i.id));
  if (!visible.length) return <div className="rounded-lg border border-dashed border-border bg-panel/50 p-6 text-center text-sm text-muted">Queue clear — no open proposals.</div>;

  function act(id: string, state: "approved" | "dismissed") {
    setHidden((h) => new Set(h).add(id));
    startTransition(() => resolveActionItem(id, state).catch(() => setHidden((h) => { const n = new Set(h); n.delete(id); return n; })));
  }

  return (
    <div className="space-y-2">
      {visible.map((it) => (
        <div key={it.id} className={`flex flex-col gap-2 rounded-md border border-y-border border-r-border border-l-2 bg-panel p-3 sm:flex-row sm:items-start ${URGENCY[it.provenance?.urgency ?? "medium"] ?? "border-l-muted"}`}>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">{FN_LABEL[it.function] ?? it.function}</span>
              {it.provenance?.business && <span className="text-[11px] text-muted">{it.provenance.business}</span>}
              {it.provenance?.urgency === "high" && <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">urgent</span>}
            </div>
            <div className="mt-1 text-sm font-medium text-text">{it.title}</div>
            {it.detail && <div className="mt-0.5 text-xs leading-relaxed text-muted">{it.detail}</div>}
            {it.draft_output && (
              <details className="mt-2 group">
                <summary className="cursor-pointer text-[11px] font-medium text-accent marker:content-['']">✎ View drafted email — review before approving</summary>
                <pre className="mt-1.5 whitespace-pre-wrap rounded border border-border bg-bg/60 p-2.5 text-xs leading-relaxed text-muted">{it.draft_output}</pre>
              </details>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => act(it.id, "approved")}
              disabled={pending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => act(it.id, "dismissed")}
              disabled={pending}
              className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs text-muted hover:text-text disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
