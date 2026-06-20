"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check } from "lucide-react";

// Auto-syncs text cards against iMessage when the Texts tab opens (and on demand)
// via the fast local reconcile: clears threads you've since replied to and flags
// ones they've texted back. Local-only — raw messages never leave the Mac.
export function TextsReconciler() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const ran = useRef(false);

  async function run() {
    setBusy(true);
    try {
      const r = await fetch("/api/text-intel/reconcile", { method: "POST" });
      const j = await r.json();
      if (!j.ok) {
        setStatus(j.error || "couldn't check Messages");
      } else {
        const parts: string[] = [];
        if (j.replied) parts.push(`${j.replied} you replied to`);
        if (j.newInbound)
          parts.push(`${j.newInbound} new message${j.newInbound === 1 ? "" : "s"}`);
        setStatus(
          parts.length
            ? `Synced · ${parts.join(" · ")}`
            : `In sync · ${j.reconciled ?? 0} threads checked`
        );
        if (j.changed) router.refresh();
      }
    } catch {
      setStatus("couldn't reach Messages");
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
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-text disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
        {busy ? "Checking…" : "Check Messages"}
      </button>
      {status && (
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
          {!busy && status.startsWith("Synced") && (
            <Check size={12} className="text-emerald-400" />
          )}
          {status}
        </span>
      )}
    </div>
  );
}
