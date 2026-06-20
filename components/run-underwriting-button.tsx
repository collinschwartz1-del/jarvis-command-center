"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCw, Loader2, FileText } from "lucide-react";

// Runs (or re-runs) the LW multifamily screen. Calls /api/analyze with the row
// id so the existing row is UPDATED in place — no autonomous spend, only on a
// human click. The LW screen uses Opus + live web search (~30-90s), so we stream
// a busy state. An optional docs field lets you screen on real numbers (T-12,
// rent roll, OM) instead of header data alone, and `rerun` swaps the label so a
// finished analysis can be re-screened after assumptions change or docs arrive.
export function RunUnderwritingButton({
  id,
  dealName,
  address,
  source,
  rerun = false,
}: {
  id: string;
  dealName: string;
  address: string | null;
  source: string | null;
  rerun?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [docText, setDocText] = useState("");

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          dealName,
          address,
          source,
          assetType: "multifamily",
          docText: docText.trim() || undefined,
        }),
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Running LW screen…
            </>
          ) : rerun ? (
            <>
              <RotateCw size={14} /> Re-run screen
            </>
          ) : (
            <>
              <Play size={14} /> Run underwriting
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowDocs((v) => !v)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          <FileText size={12} /> {showDocs ? "Hide docs" : "Add docs"}
        </button>
      </div>

      {showDocs && (
        <textarea
          value={docText}
          onChange={(e) => setDocText(e.target.value)}
          disabled={busy}
          rows={5}
          placeholder="Paste T-12, rent roll, or OM text here to screen on real numbers instead of header data…"
          className="w-full rounded border border-border bg-panel-2 px-2.5 py-2 text-xs text-text outline-none placeholder:text-muted focus:border-accent/50 disabled:opacity-50"
        />
      )}

      {busy && (
        <span className="font-mono text-[10px] text-muted">
          Opus + live web search — can take 30–90s. Don&apos;t close this tab.
        </span>
      )}
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
}
