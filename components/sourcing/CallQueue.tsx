"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dispositionLead, addNote, getLeadHistory, undoLeadEvent, type Disposition } from "@/app/sourcing/actions";
import type { CallLead } from "@/lib/deal-queries";

const usd = (n: string | null) => {
  const v = n == null ? NaN : parseFloat(n);
  return isNaN(v) ? "—" : "$" + Math.round(v).toLocaleString("en-US");
};

const ACTIONS: { key: Disposition; label: string; cls: string; note?: boolean }[] = [
  { key: "interested", label: "🔥 Interested", cls: "bg-emerald-500/25 text-emerald-300 hover:bg-emerald-500/40 font-bold", note: true },
  { key: "reached", label: "Reached", cls: "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25", note: true },
  { key: "voicemail", label: "VM", cls: "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25" },
  { key: "callback", label: "Callback", cls: "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25", note: true },
  { key: "not_selling", label: "Not selling", cls: "bg-zinc-500/20 text-muted hover:bg-zinc-500/30" },
  { key: "dnc", label: "DNC", cls: "bg-red-500/15 text-red-400 hover:bg-red-500/25" },
];

type Ev = { id: number; event_type: string; channel: string | null; actor: string | null; detail: Record<string, unknown> | null; created_at: string; voided_at: string | null };

function fmtWhen(s: string) {
  try { return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return s; }
}

function Row({ c }: { c: CallLead }) {
  const router = useRouter();
  const primary = c.phones[0];
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, startNote] = useTransition();
  const [undoing, startUndo] = useTransition();

  const loadHistory = () => {
    setOpen((v) => !v);
    if (events === null) getLeadHistory(c.lead_id).then((r) => setEvents((r.events as Ev[]) ?? []));
  };

  const fire = (d: Disposition, wantNote: boolean) => {
    const notes = wantNote ? window.prompt(`Note for ${c.owner_name} (${d.replace("_", " ")}):`) ?? undefined : undefined;
    if (d === "dnc" && !window.confirm(`Mark ${c.owner_name} as DNC? All ${c.phones.length} number${c.phones.length === 1 ? "" : "s"} drop off the call queue.`)) return;
    setErr(null);
    start(async () => {
      const res = await dispositionLead({ leadId: c.lead_id, contactIds: c.phones.map((p) => p.contact_id), disposition: d, notes });
      if (res.ok) { setDone(d); if (open) getLeadHistory(c.lead_id).then((r) => setEvents((r.events as Ev[]) ?? [])); }
      else setErr(res.error ?? "failed");
    });
  };

  const saveNote = () => {
    if (!noteDraft.trim()) return;
    startNote(async () => {
      const res = await addNote(c.lead_id, noteDraft);
      if (res.ok) { setNoteDraft(""); getLeadHistory(c.lead_id).then((r) => setEvents((r.events as Ev[]) ?? [])); }
      else setErr(res.error ?? "note failed");
    });
  };

  // Reverse a mis-clicked disposition or note: VOID the entry (kept in history,
  // struck through), repair status (and un-DNC), then refresh the row + history.
  const undo = (ev: Ev) => {
    const label = (ev.detail?.outcome as string) || ev.event_type;
    if (!window.confirm(`Void this "${label.replace("_", " ")}" entry? It stays in the history (struck through) but its effect is reversed.`)) return;
    setErr(null);
    startUndo(async () => {
      const res = await undoLeadEvent(ev.id);
      if (res.ok) {
        setEvents((evs) => (evs ?? []).map((e) => (e.id === ev.id ? { ...e, voided_at: new Date().toISOString() } : e)));
        setDone(null);
        router.refresh();
      } else setErr(res.error ?? "void failed");
    });
  };

  const td = "border-b border-border/60 px-2.5 py-2 align-middle";
  return (
    <>
      <tr className={`hover:bg-panel-2 ${done ? "opacity-60" : ""}`}>
        <td className={td}>
          <button onClick={loadHistory} title="Notes & history" className="text-muted hover:text-accent">{open ? "▾" : "▸"}</button>
        </td>
        <td className={`${td} font-medium`}>{c.display_address}</td>
        <td className={td}>{c.owner_name}{c.litigator && <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">litigator</span>}</td>
        <td className={td}>
          {/* Every number on the property, best (mobile) first — work down the
              list if one doesn't answer. Primary is highlighted. */}
          <div className="space-y-0.5">
            {c.phones.length === 0 && <span className="text-muted">—</span>}
            {c.phones.map((p, i) => (
              <div key={p.contact_id} className="flex items-baseline gap-1.5">
                <a
                  href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                  className={`font-mono hover:underline ${i === 0 ? "text-accent" : "text-zinc-400"}`}
                >
                  {p.phone}
                </a>
                {p.phone_label && <span className="text-[11px] text-muted">{p.phone_label}</span>}
              </div>
            ))}
            {(primary?.email ?? c.phones.find((p) => p.email)?.email) && (
              <div className="text-[11px] text-muted">
                <a href={`mailto:${primary?.email ?? c.phones.find((p) => p.email)?.email}`} className="hover:underline">
                  {primary?.email ?? c.phones.find((p) => p.email)?.email}
                </a>
              </div>
            )}
          </div>
        </td>
        <td className={td}>{c.score ?? "—"}</td>
        <td className={`${td} font-semibold text-emerald-400`}>{usd(c.equity_capture)}</td>
        <td className={`${td} text-muted`}>{usd(c.est_market_value)}</td>
        <td className={td}>
          <div className="flex flex-wrap gap-1">
            {ACTIONS.map((a) => (
              <button key={a.key} disabled={pending} onClick={() => fire(a.key, !!a.note)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${a.cls}`}>
                {a.label}
              </button>
            ))}
          </div>
          {done && <span className="mt-1 block text-[10px] text-muted">logged: {done.replace("_", " ")}</span>}
          {err && <div className="mt-1 text-[10px] text-red-400">{err}</div>}
        </td>
      </tr>
      {open && (
        <tr className="bg-panel/40">
          <td></td>
          <td colSpan={7} className="border-b border-border/60 px-2.5 py-3">
            <div className="mb-2 flex gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveNote()}
                placeholder="Add a note / commentary on this lead…"
                className="flex-1 rounded border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-accent" />
              <button onClick={saveNote} disabled={savingNote || !noteDraft.trim()}
                className="rounded bg-accent/20 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/30 disabled:opacity-40">Save note</button>
            </div>
            {events === null ? (
              <div className="text-[12px] text-muted">loading history…</div>
            ) : events.length === 0 ? (
              <div className="text-[12px] text-muted">No activity yet. Log a call or add a note.</div>
            ) : (
              <ul className="space-y-1">
                {events.map((ev) => {
                  const note = (ev.detail?.note as string) || (ev.detail?.notes as string) || "";
                  const outcome = (ev.detail?.outcome as string) || ev.event_type;
                  const voided = !!ev.voided_at;
                  return (
                    <li key={ev.id} className={`group flex items-baseline gap-1.5 text-[12px] ${voided ? "text-zinc-600 line-through" : "text-muted"}`}>
                      <span className="text-zinc-500">{fmtWhen(ev.created_at)}</span>
                      {" · "}<span className={`font-semibold ${voided ? "" : "text-zinc-300"}`}>{outcome.replace("_", " ")}</span>
                      {ev.actor && <span className="text-zinc-500"> · {ev.actor}</span>}
                      {note && <span className={voided ? "" : "text-text"}> — {note}</span>}
                      {voided ? (
                        <span className="ml-1 rounded bg-zinc-700/40 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 no-underline">voided</span>
                      ) : (
                        <button onClick={() => undo(ev)} disabled={undoing} title="Void this entry (kept in history, effect reversed)"
                          className="ml-1 rounded px-1.5 text-[11px] font-semibold text-zinc-600 opacity-0 transition hover:bg-red-500/15 hover:text-red-400 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40">
                          void
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function CallQueue({ rows }: { rows: CallLead[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            {["", "Address", "Owner", "Phone", "Score", "Equity", "Est value", "Disposition"].map((h, i) => (
              <th key={i} className="border-b border-border px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* One row per property — lead_id is unique now (phones are nested). */}
          {rows.map((c) => (<Row key={c.lead_id} c={c} />))}
        </tbody>
      </table>
    </div>
  );
}
