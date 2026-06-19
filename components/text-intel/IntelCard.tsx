"use client";

import { useState } from "react";
import { Copy, Check, Archive, Send } from "lucide-react";
import type { IntelCard as Card } from "@/lib/textIntel";
import { useCanWrite } from "../role-context";

const PRI: Record<Card["priority"], string> = {
  high: "border-red-500/40 bg-red-500/5",
  medium: "border-amber-500/30 bg-amber-500/5",
  low: "border-border bg-panel/50",
};
const PRI_DOT: Record<Card["priority"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-muted",
};

export function IntelCard({ card }: { card: Card }) {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const canWrite = useCanWrite();

  async function feedback(action: "approve" | "dismiss") {
    if (!canWrite) return; // read-only viewers don't write feedback
    try {
      await fetch("/api/text-intel/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread: card.thread,
          category: card.category,
          priority: card.priority,
          action,
        }),
      });
    } catch {}
    if (action === "dismiss") setDismissed(true);
  }

  function copyReply() {
    navigator.clipboard.writeText(card.suggested_reply);
    setCopied(true);
    feedback("approve");
    setTimeout(() => setCopied(false), 1500);
  }

  if (dismissed) return null;

  return (
    <div className={`rounded-lg border p-4 ${PRI[card.priority]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${PRI_DOT[card.priority]}`} />
          <span className="font-mono text-sm font-semibold text-text">
            {card.contact}
          </span>
          {card.isGroup && (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted">
              group
            </span>
          )}
          {card.owed_reply && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
              waiting on you
            </span>
          )}
        </div>
        {canWrite && (
          <button
            onClick={() => feedback("dismiss")}
            title="Dismiss"
            className="text-muted transition-colors hover:text-text"
          >
            <Archive size={14} />
          </button>
        )}
      </div>

      <p className="mt-2 text-sm text-text">{card.summary}</p>

      {card.suggested_action && (
        <p className="mt-1.5 text-sm text-muted">
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            Action ·{" "}
          </span>
          {card.suggested_action}
        </p>
      )}

      {card.owed_reply && card.suggested_reply && (
        <div className="mt-3 rounded border border-border bg-bg/50 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Draft reply
            </span>
            <button
              onClick={copyReply}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-text"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "copied" : "copy"}
            </button>
          </div>
          <p className="mt-1 text-sm text-text/90">{card.suggested_reply}</p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-muted">
        {card.entities?.length > 0 && (
          <span className="truncate">{card.entities.slice(0, 4).join(" · ")}</span>
        )}
        <span className="ml-auto whitespace-nowrap">
          {card.msgCount} msgs
          {card.lastIso ? ` · ${card.lastIso.slice(0, 10)}` : ""}
          {card.lastFromMe ? " · you sent last" : ""}
        </span>
      </div>
    </div>
  );
}
