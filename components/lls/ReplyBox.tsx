"use client";

import { useState, useTransition } from "react";
import { Send, Check, AlertCircle } from "lucide-react";
import { replyToLlsEmail } from "@/app/lending/actions";

// Compose a reply → saves a Gmail DRAFT on the thread (Collin sends from Gmail),
// optionally mirrors it into the matched loan's Lendr comments.
export function ReplyBox({
  messageId,
  hasLoan,
  gmailReady = true,
}: {
  messageId: string;
  hasLoan: boolean;
  gmailReady?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [alsoComment, setAlsoComment] = useState(hasLoan);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<
    null | { ok: boolean; comment: boolean; error?: string }
  >(null);

  // Pre-flight: replying drafts via Gmail (compose scope). If the Gmail creds
  // aren't set, say so up front instead of failing after the user composes.
  if (!gmailReady) {
    return (
      <div
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-border bg-panel-2 px-2.5 py-1 font-mono text-[11px] text-muted"
        title="Set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN to enable reply drafting"
      >
        <AlertCircle size={11} /> Reply needs Gmail — not configured
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-border-bright px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Send size={11} /> Reply
      </button>
    );
  }

  if (result?.ok) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
        <Check size={13} />
        Draft saved to the Gmail thread{result.comment ? " · posted to Lendr loan" : ""}.
        Open Gmail to review and send.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-border bg-panel-2 p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Write your reply… (saved as a Gmail draft — nothing sends automatically)"
        className="w-full resize-y rounded border border-border bg-bg/60 p-2.5 text-sm text-zinc-200 outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {hasLoan && (
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
            <input
              type="checkbox"
              checked={alsoComment}
              onChange={(e) => setAlsoComment(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            also post to Lendr loan
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={pending}
            className="rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            disabled={pending || !body.trim()}
            onClick={() =>
              start(async () => {
                const r = await replyToLlsEmail(messageId, body, alsoComment);
                setResult(r);
              })
            }
            className="inline-flex items-center gap-1.5 rounded border border-accent/50 bg-accent/15 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            <Send size={11} /> {pending ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
      {result && !result.ok && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">
          <AlertCircle size={13} /> {result.error || "Could not save draft."}
        </div>
      )}
    </div>
  );
}
