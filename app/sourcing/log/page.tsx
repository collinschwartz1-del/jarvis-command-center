import Link from "next/link";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import {
  getCallLog,
  getLeadsByLatestOutcome,
  type CallLogEvent,
  type LatestOutreach,
} from "@/lib/deal-queries";
import { dealConfigured } from "@/lib/supabase-deal";

export const dynamic = "force-dynamic";

// Central time — the calling desk works Omaha hours.
function when(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Strip the email domain so the feed reads "collin" not the full address.
const who = (actor: string) => (actor || "—").split("@")[0];

const OUTCOME_STYLE: Record<string, { label: string; cls: string }> = {
  interested: { label: "🔥 Interested", cls: "bg-emerald-500/20 text-emerald-300" },
  reached: { label: "Reached", cls: "bg-emerald-500/12 text-emerald-400" },
  voicemail: { label: "Voicemail", cls: "bg-sky-500/15 text-sky-400" },
  callback: { label: "Callback", cls: "bg-amber-500/15 text-amber-400" },
  not_selling: { label: "Not selling", cls: "bg-zinc-500/20 text-muted" },
  dnc: { label: "DNC", cls: "bg-red-500/15 text-red-400" },
};

function OutcomeBadge({ event }: { event: CallLogEvent }) {
  if (event.event_type === "note") {
    return <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-violet-300">Note</span>;
  }
  const s = (event.outcome && OUTCOME_STYLE[event.outcome]) || { label: event.outcome ?? "—", cls: "bg-zinc-500/20 text-muted" };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-b border-border/60 px-2.5 py-2 align-top ${className}`}>{children}</td>;
}

// A pinned action list (Hot / Callbacks) — what to do next, owner + note + who.
function ActionTable({ rows, emptyText }: { rows: LatestOutreach[]; emptyText: string }) {
  if (!rows.length) return <Empty>{emptyText}</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr><Th>Property</Th><Th>Owner</Th><Th>Score</Th><Th>Note</Th><Th>By</Th><Th>When</Th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lead_id} className="hover:bg-panel-2">
              <Td className="font-medium">{r.display_address}</Td>
              <Td>{r.owner_name ?? "—"}</Td>
              <Td>{r.score ?? "—"}</Td>
              <Td className="max-w-[360px] text-muted">{r.note || <span className="text-zinc-600">—</span>}</Td>
              <Td className="font-mono text-[11px] text-muted">{who(r.actor)}</Td>
              <Td className="whitespace-nowrap font-mono text-[11px] text-muted">{when(r.created_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CallLogPage() {
  if (!dealConfigured()) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-8">
        <PageHeader title="CALL LOG" subtitle="Rolled-up call activity across the queue." />
        <Empty>Spine not connected. Add the deal-command-center keys to .env.local.</Empty>
      </main>
    );
  }

  const [hot, callbacks, log] = await Promise.all([
    getLeadsByLatestOutcome("interested"),
    getLeadsByLatestOutcome("callback"),
    getCallLog(200),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <PageHeader
        title="CALL LOG"
        subtitle="Every call, disposition, and note across the queue — rolled up. Hot leads and callbacks are pinned on top."
      />

      <div className="mb-6">
        <Link href="/sourcing" className="font-mono text-[12px] text-accent hover:underline">← back to call queue</Link>
      </div>

      {/* Hot — leads whose CURRENT state is Interested */}
      <section className="mb-8">
        <SectionLabel>🔥 Hot · Interested — {hot.length}</SectionLabel>
        <div className="mt-3">
          <ActionTable rows={hot} emptyText="No interested leads logged yet. They appear here the moment someone hits 🔥 Interested." />
        </div>
      </section>

      {/* Callbacks due */}
      <section className="mb-8">
        <SectionLabel>📞 Callbacks due — {callbacks.length}</SectionLabel>
        <div className="mt-3">
          <ActionTable rows={callbacks} emptyText="No callbacks scheduled. They land here when a call is marked Callback." />
        </div>
      </section>

      {/* Full activity feed */}
      <section className="mb-8">
        <SectionLabel>Activity — all calls &amp; notes ({log.length})</SectionLabel>
        <div className="mt-3">
          {log.length === 0 ? (
            <Empty>No call activity logged yet. Dispositions and notes from the call queue show up here.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-panel">
              <table className="w-full text-[13px]">
                <thead>
                  <tr><Th>When</Th><Th>Property</Th><Th>Owner</Th><Th>Action</Th><Th>Note</Th><Th>By</Th></tr>
                </thead>
                <tbody>
                  {log.map((e) => (
                    <tr key={e.id} className="hover:bg-panel-2">
                      <Td className="whitespace-nowrap font-mono text-[11px] text-muted">{when(e.created_at)}</Td>
                      <Td className="font-medium">{e.display_address}</Td>
                      <Td>{e.owner_name ?? "—"}</Td>
                      <Td><OutcomeBadge event={e} /></Td>
                      <Td className="max-w-[360px] text-muted">{e.note || <span className="text-zinc-600">—</span>}</Td>
                      <Td className="font-mono text-[11px] text-muted">{who(e.actor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
