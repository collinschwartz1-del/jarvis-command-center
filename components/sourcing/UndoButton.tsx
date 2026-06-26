"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoLeadEvent } from "@/app/sourcing/actions";

// Void a single logged entry from the Call Log feed. The entry is kept in the
// history (struck through) and its effect is reversed (status re-derived, DNC
// un-flagged). Already-voided rows show a static label instead of the button.
export function UndoButton({ eventId, label, voided }: { eventId: number; label: string; voided?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (voided) {
    return <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">voided</span>;
  }
  const click = () => {
    if (!window.confirm(`Void this "${label}" entry? It stays in the history (struck through) but its effect is reversed.`)) return;
    start(async () => {
      const res = await undoLeadEvent(eventId);
      if (res.ok) router.refresh();
      else window.alert(res.error ?? "void failed");
    });
  };
  return (
    <button onClick={click} disabled={pending} title="Void this entry (kept in history, effect reversed)"
      className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 transition hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40">
      {pending ? "…" : "void"}
    </button>
  );
}
