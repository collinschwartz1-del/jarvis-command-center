"use client";

import { useState } from "react";
import { BUSINESSES } from "@/lib/brain-queries";

const EXAMPLES = [
  "What did Chris decide recently?",
  "Anything about insurance renewals or expirations?",
  "Summarize the latest on Brent Village",
  "What's happening with LLS loan payoffs?",
];

type Source = { id: string; subject: string | null; business: string | null; occurred_at: string | null; snippet: string | null };

export function AskBrain() {
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState("All");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [err, setErr] = useState("");

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || loading) return;
    setQ(text);
    setLoading(true);
    setErr("");
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/brain-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, business: biz }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "request failed");
      setAnswer(data.answer);
      setSources(data.sources || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={biz}
          onChange={(e) => setBiz(e.target.value)}
          className="rounded-md border border-border bg-panel-2 px-2 py-2 text-sm text-text focus:border-border-bright focus:outline-none"
        >
          <option>All</option>
          {BUSINESSES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
          placeholder="Ask your business anything…"
          className="flex-1 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-border-bright focus:outline-none"
        />
        <button
          onClick={() => ask()}
          disabled={loading}
          className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => ask(ex)}
            className="rounded-full border border-border bg-panel-2 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-border-bright hover:text-text"
          >
            {ex}
          </button>
        ))}
      </div>

      {err && <div className="mt-3 rounded border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">{err}</div>}

      {answer && (
        <div className="mt-4 rounded-md border-l-2 border-accent border-y border-r border-border bg-panel-2 p-4">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-text">{answer}</div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Sources</div>
          <div className="space-y-1">
            {sources.map((s, i) => (
              <div key={s.id} className="flex items-baseline gap-2 text-xs">
                <span className="text-accent">[{i + 1}]</span>
                <span className="text-text">{s.subject || "(no subject)"}</span>
                <span className="ml-auto whitespace-nowrap text-muted">
                  {s.business} · {s.occurred_at ? new Date(s.occurred_at).toLocaleDateString() : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
