"use client";

import { useState, useTransition } from "react";
import {
  Mail,
  Check,
  X,
  Send,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import type { EmailDraft } from "@/lib/types";
import { approveReply, dismissReply } from "@/app/actions";
import { useCanWrite } from "./role-context";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ReplyCard({
  draft,
  onResolved,
}: {
  draft: EmailDraft;
  onResolved?: (id: string) => void;
}) {
  const canWrite = useCanWrite();
  const [pending, start] = useTransition();
  const [showOriginal, setShowOriginal] = useState(false);
  const [compare, setCompare] = useState(false);
  const [done, setDone] = useState<null | "approved" | "dismissed">(null);
  const [error, setError] = useState<string | null>(null);

  const variants = draft.variants ?? [];
  // First Sue-approved option is the default selection; held options stay
  // visible (muted, with Sue's note) but aren't selectable.
  const firstApproved = variants.findIndex((v) => v.verdict === "approve");
  const [selected, setSelected] = useState(firstApproved < 0 ? 0 : firstApproved);
  // Per-variant editable bodies, seeded from the drafts.
  const [bodies, setBodies] = useState<string[]>(variants.map((v) => v.body));

  const isDecision = draft.reply_kind === "decision" && variants.length > 1;
  const current = variants[selected];
  const isSensitive = draft.sensitivity === "sensitive";
  // Collin is the final gate, so he can approve any option (incl. Sue-held) once
  // there's a body. Held options just carry a visible caution.
  const canApprove = canWrite && !!bodies[selected]?.trim();
  const currentHeld = current?.verdict === "hold";

  function setBody(i: number, val: string) {
    setBodies((b) => b.map((x, j) => (j === i ? val : x)));
  }

  function onApprove() {
    setError(null);
    start(async () => {
      try {
        await approveReply(draft.id, selected, bodies[selected]);
        setDone("approved");
        onResolved?.(draft.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to stage Gmail draft.");
      }
    });
  }

  function onDismiss() {
    setError(null);
    start(async () => {
      try {
        await dismissReply(draft.id);
        setDone("dismissed");
        onResolved?.(draft.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to dismiss.");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-panel/60 p-4 text-sm text-muted">
        {done === "approved" ? (
          <span className="inline-flex items-center gap-2 text-emerald-300">
            <Check size={14} /> Gmail draft staged for {draft.person_name} — send
            it from Gmail when ready.
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <X size={14} /> Dismissed reply to {draft.person_name}.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="ticked rounded-lg border border-border bg-panel p-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={14} className="text-muted" />
        <span className="text-sm font-semibold text-text">{draft.person_name}</span>
        <span className="font-mono text-[11px] text-muted">{draft.person_email}</span>
        <span
          className={`ml-auto inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            isDecision
              ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
              : "text-cyan-300 border-cyan-500/30 bg-cyan-500/10"
          }`}
        >
          {isDecision ? `${variants.length} options` : "reply"}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span className="truncate">{draft.subject || "(no subject)"}</span>
        {draft.created_at && (
          <>
            <span className="text-border-bright">/</span>
            <span>{timeAgo(draft.created_at)}</span>
          </>
        )}
      </div>

      {/* sensitive caution */}
      {isSensitive && (
        <div className="mt-3 flex items-start gap-2 rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold uppercase tracking-wider">Sensitive</span>
            {draft.excluded_reason ? ` — ${draft.excluded_reason}` : ""}. Read it
            closely before approving; the draft avoids confirming numbers, terms,
            or wire details on purpose.
          </span>
        </div>
      )}

      {/* original email context (collapsible) */}
      {draft.original_snippet && (
        <div className="mt-3">
          <button
            onClick={() => setShowOriginal((s) => !s)}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
          >
            {showOriginal ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            What they wrote
          </button>
          {showOriginal && (
            <p className="mt-2 whitespace-pre-wrap rounded border border-border bg-panel-2 p-3 text-xs leading-relaxed text-zinc-400">
              {draft.original_snippet}
            </p>
          )}
        </div>
      )}

      {/* option selector (decision threads) */}
      {isDecision && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {variants.map((v, i) => {
              const held = v.verdict === "hold";
              const active = i === selected;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  title={held ? v.note ?? "Sue flagged this option" : undefined}
                  className={`rounded border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : held
                        ? "border-amber-500/40 bg-amber-500/5 text-amber-300/80 hover:border-amber-400"
                        : "border-border-bright text-zinc-300 hover:border-accent hover:text-text"
                  }`}
                >
                  {v.label}
                  {held && <span className="ml-1 normal-case opacity-70">⚠</span>}
                </button>
              );
            })}
            <button
              onClick={() => setCompare((c) => !c)}
              className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent"
            >
              {compare ? "Hide compare" : "⇄ Compare"}
            </button>
          </div>

          {/* side-by-side: every option at once, with Sue's verdict, pick one */}
          {compare && (
            <div className="mt-3 grid gap-2.5 md:grid-cols-2">
              {variants.map((v, i) => {
                const held = v.verdict === "hold";
                return (
                  <div
                    key={i}
                    className={`flex flex-col rounded border p-3 ${
                      i === selected
                        ? "border-accent bg-accent/[0.06]"
                        : "border-border bg-panel-2"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text">{v.label}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                          held
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {held ? "Sue held" : "Sue ok"}
                      </span>
                      <button
                        onClick={() => {
                          setSelected(i);
                          setCompare(false);
                        }}
                        className="ml-auto rounded border border-border-bright px-2 py-0.5 text-[11px] text-zinc-300 hover:border-accent hover:text-accent"
                      >
                        Use this
                      </button>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                      {bodies[i]}
                    </p>
                    {held && v.note && (
                      <p className="mt-2 text-[11px] text-amber-300/90">⚠ {v.note}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* the editable reply body */}
      <div className="mt-3">
        {!isDecision && variants.length === 1 && (
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">
            Draft reply
          </div>
        )}
        <textarea
          value={bodies[selected] ?? ""}
          onChange={(e) => setBody(selected, e.target.value)}
          disabled={!canWrite}
          rows={Math.min(14, Math.max(5, (bodies[selected] ?? "").split("\n").length + 1))}
          className="w-full resize-y rounded border border-border bg-panel-2 p-3 font-sans text-sm leading-relaxed text-zinc-200 outline-none focus:border-accent disabled:opacity-60"
        />
        {currentHeld && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-300/90">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Sue flagged this option: {current.note ?? "use your judgment before sending."}
          </p>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      {/* actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={!canApprove || pending}
          onClick={onApprove}
          className="inline-flex items-center gap-1.5 rounded bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={13} />
          {pending ? "Staging…" : "Approve → Gmail draft"}
        </button>
        <button
          disabled={!canWrite || pending}
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-border-bright hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={13} /> Dismiss
        </button>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted">
          stages a draft · never auto-sends
        </span>
      </div>
    </div>
  );
}
