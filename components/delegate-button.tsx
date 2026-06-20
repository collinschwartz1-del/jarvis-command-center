"use client";

import { useState } from "react";
import { delegate, type DelegateDomain } from "@/app/actions";

// Who Collin hands work to. Sue = review/ops seat, Karen = EA/viewer.
const ASSIGNEES = ["Sue", "Karen"];

// Inline delegate control for an action-queue row. On hand-off it calls the
// delegate server action via the parent's optimistic-resolve helper, so the row
// disappears from Collin's queue and lands in /bridge as someone else's ball.
export function DelegateButton({
  domain,
  refId,
  title,
  onHandOff,
}: {
  domain: DelegateDomain;
  refId: string;
  title: string;
  onHandOff: (fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState(ASSIGNEES[0]);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-text"
      >
        ⤳ Delegate
      </button>
    );
  }

  return (
    <div className="mt-1 w-full rounded border border-accent/30 bg-accent/[0.05] p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Hand to
        </span>
        {ASSIGNEES.map((a) => (
          <button
            key={a}
            onClick={() => setAssignee(a)}
            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              assignee === a
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {a}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          className="ml-auto font-mono text-[11px] text-muted hover:text-text"
        >
          ✕
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        className="mt-2 w-full rounded border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none placeholder:text-muted focus:border-accent/50"
      />
      <button
        onClick={() => {
          onHandOff(() => delegate({ domain, refId, title, assignee, note }));
          setOpen(false);
        }}
        className="mt-2 w-full rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
      >
        Hand off to {assignee} →
      </button>
    </div>
  );
}
