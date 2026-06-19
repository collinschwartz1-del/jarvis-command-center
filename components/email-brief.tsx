"use client";

import { useTransition } from "react";
import { Check, Mail } from "lucide-react";
import type { EmailBrief } from "@/lib/types";
import { toggleActionItem } from "@/app/actions";
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

export function EmailBriefCard({ brief }: { brief: EmailBrief }) {
  const [pending, start] = useTransition();
  const canWrite = useCanWrite();
  const actionItems = brief.action_items ?? [];
  const openCount = actionItems.filter((a) => !a.done).length;

  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
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
            <span className="text-accent">{openCount} open action{openCount === 1 ? "" : "s"}</span>
          </>
        )}
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

      {actionItems.length > 0 && (
        <div className="mt-4 rounded border border-border bg-panel-2 p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-accent/80">
            Action Items
          </div>
          <ul className="mt-2 space-y-1.5">
            {actionItems.map((a, i) => (
              <li key={i}>
                <button
                  disabled={pending || !canWrite}
                  onClick={() =>
                    canWrite && start(() => toggleActionItem(brief.id, i))
                  }
                  className="flex w-full items-start gap-2.5 text-left text-sm leading-snug disabled:cursor-default disabled:opacity-100"
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      a.done
                        ? "border-accent bg-accent/20 text-accent"
                        : "border-border-bright text-transparent hover:border-accent"
                    }`}
                  >
                    <Check size={11} />
                  </span>
                  <span className={a.done ? "text-muted line-through" : "text-zinc-200"}>
                    {a.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
