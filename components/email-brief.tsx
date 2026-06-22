"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Mail, FilePlus2, X, Layers, MessageSquareReply } from "lucide-react";
import type { EmailBrief } from "@/lib/types";
import {
  captureActionItem,
  dismissActionItem,
  combineIntoProject,
} from "@/app/actions";
import { useCanWrite } from "./role-context";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const MAILBOX: Record<string, string> = {
  gmail: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  outlook: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  both: "text-amber-300 border-amber-500/30 bg-amber-500/10",
};

export function EmailBriefCard({
  brief,
  compact = false,
}: {
  brief: EmailBrief;
  compact?: boolean;
}) {
  const canWrite = useCanWrite();
  const [pending, start] = useTransition();
  const items = brief.action_items ?? [];

  // FYI / awareness rows render as a single quiet line — readable at a glance,
  // no action surface. Collin scans these, he doesn't work them.
  if (compact) {
    return (
      <div className="flex items-baseline gap-2.5 rounded border border-border bg-panel px-3 py-2">
        <Mail size={12} className="shrink-0 translate-y-0.5 text-muted" />
        <span className="shrink-0 text-sm font-medium text-zinc-300">
          {brief.person_name}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">
          {brief.summary}
        </span>
        {brief.latest_at && (
          <span className="shrink-0 font-mono text-[10px] text-border-bright">
            {timeAgo(brief.latest_at)}
          </span>
        )}
        <Link
          href="/replies"
          className="shrink-0 text-muted transition-colors hover:text-accent"
          title="Reply"
        >
          <MessageSquareReply size={12} />
        </Link>
      </div>
    );
  }

  // indexes handled this session (optimistic) + a multi-select set for bundling
  const [resolved, setResolved] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");

  const handled = (i: number) => items[i].done || resolved.has(i);
  const openCount = items.filter((_, i) => !handled(i)).length;

  function run(indexes: number[], fn: () => Promise<unknown>) {
    setResolved((p) => {
      const n = new Set(p);
      indexes.forEach((i) => n.add(i));
      return n;
    });
    setSelected(new Set());
    start(async () => {
      try {
        await fn();
      } catch {
        setResolved((p) => {
          const n = new Set(p);
          indexes.forEach((i) => n.delete(i));
          return n;
        });
      }
    });
  }

  function toggleSel(i: number) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={14} className="text-muted" />
        <span className="text-sm font-semibold text-text">{brief.person_name}</span>
        <span className="font-mono text-[11px] text-muted">{brief.person_email}</span>
        <span
          className={`ml-auto inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            MAILBOX[brief.mailbox] ?? MAILBOX.gmail
          }`}
        >
          {brief.mailbox}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>
          {brief.thread_count} thread{brief.thread_count === 1 ? "" : "s"}
        </span>
        {brief.latest_at && (
          <>
            <span className="text-border-bright">/</span>
            <span>{timeAgo(brief.latest_at)}</span>
          </>
        )}
        {openCount > 0 && (
          <>
            <span className="text-border-bright">/</span>
            <span className="text-accent">
              {openCount} open action{openCount === 1 ? "" : "s"}
            </span>
          </>
        )}
        <Link
          href="/replies"
          className="ml-auto inline-flex items-center gap-1 text-muted transition-colors hover:text-accent"
        >
          <MessageSquareReply size={11} /> Reply
        </Link>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{brief.summary}</p>

      {brief.takeaways.length > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Takeaways
          </div>
          <ul className="mt-1.5 space-y-1">
            {brief.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-300">
                <span className="text-accent">▸</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel-2 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-accent/80">
              Action Items
            </span>
            {selected.size > 1 && (
              <span className="font-mono text-[10px] text-muted">
                {selected.size} selected
              </span>
            )}
          </div>

          <ul className="mt-2 space-y-1.5">
            {items.map((a, i) =>
              handled(i) ? (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm leading-snug text-muted line-through"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border-bright" />
                  {a.text}
                </li>
              ) : (
                <li key={i} className="group flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    disabled={!canWrite}
                    onChange={() => toggleSel(i)}
                    title="Select to combine into a project"
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--accent,#6ee7b7)] disabled:opacity-30"
                  />
                  <span className="flex-1 text-sm leading-snug text-zinc-200">
                    {a.text}
                  </span>
                  {canWrite && (
                    <span className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => run([i], () => captureActionItem(brief.id, i))}
                        disabled={pending}
                        title="Capture as a tracked card"
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
                      >
                        <FilePlus2 size={11} /> Card
                      </button>
                      <button
                        onClick={() => run([i], () => dismissActionItem(brief.id, i))}
                        disabled={pending}
                        title="Clear without a card"
                        className="rounded border border-border px-1.5 py-0.5 text-muted transition-colors hover:bg-panel hover:text-text"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  )}
                </li>
              )
            )}
          </ul>

          {/* combine bar — appears when 2+ items selected */}
          {selected.size > 1 && canWrite && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${brief.person_name} project name…`}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 text-xs text-text outline-none placeholder:text-muted focus:border-accent/50"
              />
              <button
                disabled={pending}
                onClick={() =>
                  run([...selected], () =>
                    combineIntoProject(brief.id, [...selected], title)
                  )
                }
                className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-2.5 py-1 font-mono text-[11px] text-accent transition-colors hover:bg-accent/25"
              >
                <Layers size={12} /> Combine {selected.size} → project
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
