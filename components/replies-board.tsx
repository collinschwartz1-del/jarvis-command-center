"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, X, Send, Zap } from "lucide-react";
import type { EmailDraft } from "@/lib/types";
import { approveReply } from "@/app/actions";
import { useCanWrite } from "./role-context";
import { ReplyCard } from "./reply-card";

type Filter = "all" | "routine" | "decision" | "sensitive";

// The chosen default for a draft = Sue's first approved variant (fallback first).
function defaultPick(d: EmailDraft): { index: number; body: string } {
  const vs = d.variants ?? [];
  let idx = vs.findIndex((v) => v.verdict === "approve");
  if (idx < 0) idx = 0;
  return { index: idx, body: vs[idx]?.body ?? d.draft_body ?? "" };
}

// Batchable = has a ready, non-empty default body AND isn't sensitive (sensitive
// threads must be opened and read — never bulk-staged).
function isBatchable(d: EmailDraft): boolean {
  return d.sensitivity !== "sensitive" && !!defaultPick(d).body.trim();
}
// The safe one-click set: routine single replies Sue already cleared.
function isQuickSafe(d: EmailDraft): boolean {
  return isBatchable(d) && d.reply_kind !== "decision";
}

function matches(d: EmailDraft, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "sensitive") return d.sensitivity === "sensitive";
  if (f === "decision") return d.reply_kind === "decision";
  return d.reply_kind !== "decision" && d.sensitivity !== "sensitive"; // routine
}

export function RepliesBoard({ drafts }: { drafts: EmailDraft[] }) {
  const canWrite = useCanWrite();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const live = useMemo(
    () => drafts.filter((d) => !resolved.has(d.id)),
    [drafts, resolved]
  );
  const visible = live.filter((d) => matches(d, filter));

  const counts = {
    all: live.length,
    routine: live.filter((d) => matches(d, "routine")).length,
    decision: live.filter((d) => matches(d, "decision")).length,
    sensitive: live.filter((d) => matches(d, "sensitive")).length,
  };

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAllSafe() {
    setSelected(new Set(visible.filter(isQuickSafe).map((d) => d.id)));
  }

  function markResolved(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    setResolved((p) => new Set(p).add(id));
  }

  // Batch approve: stage a Gmail draft for each selected (non-sensitive) thread
  // using its default option. Sequential so we don't hammer the Gmail API.
  function approveSelected() {
    const ids = [...selected].filter((id) => {
      const d = live.find((x) => x.id === id);
      return d && isBatchable(d);
    });
    if (!ids.length) return;
    setMsg(null);
    start(async () => {
      let ok = 0;
      const fail: string[] = [];
      for (const id of ids) {
        const d = live.find((x) => x.id === id)!;
        const { index, body } = defaultPick(d);
        try {
          await approveReply(id, index, body);
          markResolved(id);
          ok++;
        } catch {
          fail.push(d.person_name);
        }
      }
      setMsg(
        `Staged ${ok} Gmail draft${ok === 1 ? "" : "s"}${
          fail.length ? ` · ${fail.length} failed (${fail.join(", ")})` : ""
        }. Send them from Gmail when ready.`
      );
    });
  }

  const selectedBatchable = [...selected].filter((id) => {
    const d = live.find((x) => x.id === id);
    return d && isBatchable(d);
  }).length;

  const chip = (key: Filter, label: string, n: number) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
        filter === key
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-border bg-panel-2 text-muted hover:text-text"
      }`}
    >
      {label} {n}
    </button>
  );

  return (
    <div>
      {/* filter + bulk-select controls */}
      <div className="flex flex-wrap items-center gap-2">
        {chip("all", "All", counts.all)}
        {chip("routine", "Routine", counts.routine)}
        {chip("decision", "Decisions", counts.decision)}
        {chip("sensitive", "Sensitive", counts.sensitive)}
        {canWrite && visible.some(isQuickSafe) && (
          <button
            onClick={selectAllSafe}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-text"
          >
            <Zap size={12} /> Select all routine
          </button>
        )}
      </div>

      {/* batch action bar — appears when something is selected */}
      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/[0.06] px-4 py-2.5">
          <span className="font-mono text-xs text-accent">
            {selected.size} selected
            {selectedBatchable !== selected.size &&
              ` (${selectedBatchable} stageable)`}
          </span>
          <button
            disabled={!canWrite || pending || selectedBatchable === 0}
            onClick={approveSelected}
            className="inline-flex items-center gap-1.5 rounded bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={13} />
            {pending ? "Staging…" : `Approve ${selectedBatchable} → Gmail drafts`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-text"
          >
            <X size={12} /> Clear
          </button>
        </div>
      )}

      {msg && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-2.5 text-sm text-emerald-200">
          <Check size={14} /> {msg}
        </div>
      )}

      {/* the list — each batchable card gets a select checkbox */}
      <div className="mt-4 grid gap-4">
        {visible.map((d) => {
          const selectable = isBatchable(d);
          return (
            <div key={d.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                disabled={!canWrite || !selectable}
                title={
                  selectable
                    ? "Select for batch approve"
                    : "Open and review — not batch-stageable"
                }
                className="mt-5 h-4 w-4 shrink-0 accent-[var(--accent,#6ee7b7)] disabled:opacity-30"
              />
              <div className="min-w-0 flex-1">
                <ReplyCard draft={d} onResolved={markResolved} />
              </div>
            </div>
          );
        })}
        {!visible.length && (
          <p className="rounded-lg border border-border bg-panel px-4 py-6 text-sm text-muted">
            Nothing in this view.
          </p>
        )}
      </div>
    </div>
  );
}
