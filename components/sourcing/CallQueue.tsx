"use client";

import { useState, useTransition } from "react";
import { dispositionLead, type Disposition } from "@/app/sourcing/actions";
import type { CallRow } from "@/lib/deal-queries";

const usd = (n: string | null) => {
  const v = n == null ? NaN : parseFloat(n);
  return isNaN(v) ? "—" : "$" + Math.round(v).toLocaleString("en-US");
};

const ACTIONS: { key: Disposition; label: string; cls: string; note?: boolean }[] = [
  { key: "reached", label: "Reached", cls: "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25", note: true },
  { key: "voicemail", label: "VM", cls: "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25" },
  { key: "callback", label: "Callback", cls: "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25", note: true },
  { key: "not_selling", label: "Not selling", cls: "bg-zinc-500/20 text-muted hover:bg-zinc-500/30" },
  { key: "dnc", label: "DNC", cls: "bg-red-500/15 text-red-400 hover:bg-red-500/25" },
];

function Row({ c }: { c: CallRow }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fire = (d: Disposition, wantNote: boolean) => {
    const notes = wantNote ? window.prompt(`Note for ${c.owner_name} (${d}):`) ?? undefined : undefined;
    if (d === "dnc" && !window.confirm(`Mark ${c.phone} as DNC? It will drop off the call queue.`)) return;
    setErr(null);
    start(async () => {
      const res = await dispositionLead({ leadId: c.lead_id, contactId: c.contact_id, disposition: d, notes });
      if (res.ok) setDone(d);
      else setErr(res.error ?? "failed");
    });
  };

  return (
    <tr className={`hover:bg-panel-2 ${done ? "opacity-50" : ""}`}>
      <td className="border-b border-border/60 px-2.5 py-2 font-medium">{c.display_address}</td>
      <td className="border-b border-border/60 px-2.5 py-2">
        {c.owner_name}
        {c.litigator && <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">litigator</span>}
      </td>
      <td className="border-b border-border/60 px-2.5 py-2">
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-mono text-accent hover:underline">{c.phone}</a>
        {c.phone_label && <span className="text-muted"> · {c.phone_label}</span>}
      </td>
      <td className="border-b border-border/60 px-2.5 py-2">{c.score ?? "—"}</td>
      <td className="border-b border-border/60 px-2.5 py-2 font-semibold text-emerald-400">{usd(c.equity_capture)}</td>
      <td className="border-b border-border/60 px-2.5 py-2">
        {done ? (
          <span className="text-[11px] text-muted">logged: {done.replace("_", " ")}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                disabled={pending}
                onClick={() => fire(a.key, !!a.note)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${a.cls}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {err && <div className="mt-1 text-[10px] text-red-400">{err}</div>}
      </td>
    </tr>
  );
}

export function CallQueue({ rows }: { rows: CallRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            {["Address", "Owner", "Phone", "Score", "Equity", "Disposition"].map((h) => (
              <th key={h} className="border-b border-border px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Row key={c.contact_id} c={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
