"use client";

import { useState, useTransition } from "react";
import { updateContactNotes } from "@/app/contacts/actions";

// Inline-editable relationship note for a contact row. Read-only display for
// viewers; owners get a click-to-edit textarea (⌘/Ctrl+Enter saves, Esc cancels).
export function NoteCell({
  id,
  initial,
  editable,
}: {
  id: string;
  initial: string | null;
  editable: boolean;
}) {
  const [notes, setNotes] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!editable) return <span className="text-muted">{notes || "—"}</span>;

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(notes); setEditing(true); setErr(null); }}
        className="group flex w-full items-start gap-1 text-left"
        title="Edit note"
      >
        <span className={notes ? "text-text" : "italic text-muted/50"}>{notes || "add note…"}</span>
        <span className="text-[10px] text-accent opacity-0 transition-opacity group-hover:opacity-100">✎</span>
      </button>
    );
  }

  const save = () =>
    start(async () => {
      const res = await updateContactNotes(id, draft);
      if (res.ok) { setNotes(draft.trim()); setEditing(false); setErr(null); }
      else setErr(res.error ?? "failed");
    });

  return (
    <div className="flex min-w-[200px] flex-col gap-1">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") { setEditing(false); setErr(null); }
        }}
        placeholder="Relationship note…"
        className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          {pending ? "saving…" : "save"}
        </button>
        <button
          onClick={() => { setEditing(false); setErr(null); }}
          className="text-[11px] text-muted hover:text-text"
        >
          cancel
        </button>
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
    </div>
  );
}
