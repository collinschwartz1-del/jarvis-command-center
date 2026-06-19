"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "starting" | "running" | "done" | "error";

const RANGES = [1, 3, 7, 30] as const;

// Triggers the local pipeline and polls until it finishes, then refreshes the
// tab. Everything it touches stays on this Mac — the route refuses to run in
// the cloud, so this control is effectively a no-op on the deployed Jarvis.
export function ClassifyButton() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [days, setDays] = useState<number>(3);
  const [msg, setMsg] = useState<string>("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  function startPolling() {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const r = await fetch("/api/text-intel/classify", { cache: "no-store" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "status check failed");
        if (!j.running) {
          if (poll.current) clearInterval(poll.current);
          setStatus("done");
          setMsg("Updated — refreshing…");
          router.refresh();
          setTimeout(() => setStatus("idle"), 2500);
        }
      } catch (e) {
        if (poll.current) clearInterval(poll.current);
        setStatus("error");
        setMsg(String(e));
      }
    }, 3000);
  }

  async function run() {
    setStatus("starting");
    setMsg("");
    try {
      const r = await fetch("/api/text-intel/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed to start");
      setStatus("running");
      setMsg(
        j.started === false
          ? "A run is already in progress…"
          : `Mining + classifying last ${days}d locally via Ollama…`,
      );
      startPolling();
    } catch (e) {
      setStatus("error");
      setMsg(String(e));
    }
  }

  const busy = status === "starting" || status === "running";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded border border-border bg-panel-2 p-0.5">
        {RANGES.map((d) => (
          <button
            key={d}
            disabled={busy}
            onClick={() => setDays(d)}
            className={`rounded px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
              days === d ? "bg-accent/20 text-accent" : "text-muted hover:text-text"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded border border-accent/40 bg-accent/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent" />
            Classifying…
          </>
        ) : (
          <>⟳ Classify Now</>
        )}
      </button>
      {msg && (
        <span
          className={`font-mono text-[11px] ${
            status === "error" ? "text-red-400" : "text-muted"
          }`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
