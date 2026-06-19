"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

// 1-click promotion of a flagged deal stub into a full LW underwriting analysis.
// Calls /api/analyze with the row id so the existing row is updated in place
// (no autonomous spend — only runs when a human clicks). The LW screen uses
// Opus + live web search and can take ~30-90s, so we stream a busy state.
export function RunUnderwritingButton({
  id,
  dealName,
  address,
  source,
}: {
  id: string;
  dealName: string;
  address: string | null;
  source: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dealName, address, source, assetType: "multifamily" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Underwriting failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex w-fit items-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Running LW screen…
          </>
        ) : (
          <>
            <Play size={14} /> Run underwriting
          </>
        )}
      </button>
      {busy && (
        <span className="font-mono text-[10px] text-muted">
          Opus + live web search — can take 30–90s. Don&apos;t close this tab.
        </span>
      )}
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
}
