"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import { reconcileReplies } from "@/app/actions";

// Auto-reconciles the open reply queue against live Gmail when /replies opens,
// and on demand. Clears drafts Collin already answered in Gmail so the queue
// reflects reality — "communication has been made" — instead of nagging him.
export function ReplyReconciler() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const ran = useRef(false);

  async function run() {
    setBusy(true);
    try {
      const r = await reconcileReplies();
      if (r.error) setStatus(r.error);
      else if (r.cleared)
        setStatus(
          `Cleared ${r.cleared} you'd already replied to in Gmail${
            r.followups ? ` · ${r.followups} have a new message` : ""
          }`
        );
      else if (r.followups)
        setStatus(`In sync · ${r.followups} thread${r.followups === 1 ? "" : "s"} has a new message`);
      else setStatus(`In sync with Gmail · ${r.checked} thread${r.checked === 1 ? "" : "s"} checked`);
    } catch {
      setStatus("Couldn't reach Gmail");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-text disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
        {busy ? "Checking Gmail…" : "Check Gmail"}
      </button>
      {status && (
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
          {!busy && status.startsWith("Cleared") && (
            <Check size={12} className="text-emerald-400" />
          )}
          {status}
        </span>
      )}
    </div>
  );
}
