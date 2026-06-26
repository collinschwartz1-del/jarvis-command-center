import Link from "next/link";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { NoteCell } from "@/components/contacts/NoteCell";
import { currentRole } from "@/lib/auth";
import {
  getContacts,
  getContactCounts,
  getContactStats,
  dedupe,
  sourceMeta,
  CONTACT_SOURCES,
  type Contact,
  type ConsentStatus,
} from "@/lib/contacts";

export const dynamic = "force-dynamic";

function displayName(c: { first_name: string | null; last_name: string | null; full_name: string | null; email: string | null }) {
  const fromParts = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return c.full_name || fromParts || c.email || "—";
}

function ConsentBadge({ status }: { status: ConsentStatus }) {
  const map: Record<ConsentStatus, { label: string; cls: string }> = {
    opt_in: { label: "opt-in", cls: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" },
    unknown: { label: "unknown", cls: "text-muted border-border bg-panel-2" },
    do_not_bulk: { label: "do-not-bulk", cls: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
  };
  const m = map[status] ?? map.unknown;
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function Tab({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors ${
        active ? "text-accent" : "text-muted hover:bg-panel-2 hover:text-text"
      }`}
    >
      {label}
      {count != null && (
        <span className="rounded-full bg-panel-2 px-1.5 py-px font-mono text-[10px] text-muted">{count}</span>
      )}
      {active && <span className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
    </Link>
  );
}

function ContactTable({ rows, showSources, editable }: { rows: (Contact & { sources?: string[] })[]; showSources?: boolean; editable: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">Purpose</th>
            <th className="px-3 py-2">{showSources ? "Sources" : "Source"}</th>
            <th className="px-3 py-2">Consent</th>
            <th className="px-3 py-2">Owner</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-panel-2/40">
              <td className="px-3 py-2 text-text">{displayName(c)}</td>
              <td className="px-3 py-2 text-muted">{c.email || "—"}</td>
              <td className="px-3 py-2 text-muted">{c.phone || "—"}</td>
              <td className="px-3 py-2 text-muted">{c.purpose || "—"}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted">
                {showSources && c.sources
                  ? c.sources.map((s) => sourceMeta(s)?.label ?? s).join(", ")
                  : sourceMeta(c.source)?.label ?? c.source}
              </td>
              <td className="px-3 py-2"><ConsentBadge status={c.consent_status} /></td>
              <td className="px-3 py-2 text-muted">{c.owner || "—"}</td>
              <td className="max-w-[280px] px-3 py-2 text-[13px]">
                <NoteCell id={c.id} initial={c.notes} editable={editable} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const [counts, stats, role] = await Promise.all([getContactCounts(), getContactStats(), currentRole()]);
  const editable = role === "owner";
  const total = stats.total;
  const active = source && sourceMeta(source) ? source : null;
  const meta = active ? sourceMeta(active) : null;

  const rows = await getContacts(active ?? undefined);
  const merged = active ? null : dedupe(rows);
  // The master view dedupes a bounded page; its true size is stats.distinct_people.
  const masterCount = stats.distinct_people;
  const sourceTruncated = active ? (counts[active] ?? 0) > rows.length : false;
  const masterTruncated = !active && masterCount > (merged?.length ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CONTACTS"
        subtitle={
          total > 0
            ? `Collin's World CRM — ${total.toLocaleString()} contacts (${masterCount.toLocaleString()} distinct people) across ${stats.sources} sources. One master, tabbed by where each came from.`
            : "Collin's World CRM — unified contact master. Tabs below are the source pools; importers land here in Phase 2."
        }
      />

      {/* Source tabs */}
      <nav className="flex items-center gap-0.5 overflow-x-auto border-b border-border pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tab href="/contacts" label="All People" count={masterCount} active={!active} />
        <span className="mx-1 h-4 w-px bg-border" />
        {CONTACT_SOURCES.map((s) => (
          <Tab key={s.key} href={`/contacts?source=${s.key}`} label={s.label} count={counts[s.key] ?? 0} active={active === s.key} />
        ))}
      </nav>

      {/* Active tab description + (Phase 2) refresh control */}
      <div className="flex items-center justify-between gap-4">
        <SectionLabel>
          {active ? meta?.label : "All People"}
          {meta && "blurb" in meta ? ` · ${meta.blurb}` : " · deduped identities across every source"}
        </SectionLabel>
        {active && (
          <span
            title={`Refresh on demand — ask Sue, or run: npm run contacts-import ${active}`}
            className="rounded border border-border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted"
          >
            ↻ refresh: ask Sue
          </span>
        )}
      </div>

      {/* Consent / capture warnings for cold + capture-only pools */}
      {meta && "cold" in meta && meta.cold && (
        <p className="rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-300/90">
          ⚠ Cold list — not opt-in. Imports land flagged <span className="font-mono">do-not-bulk</span>. Do not mass-email from this tab.
        </p>
      )}
      {meta && "captureOnly" in meta && meta.captureOnly && (
        <p className="rounded border border-border bg-panel/50 px-3 py-2 text-xs text-muted">
          Facebook blocks member export — this pool can&apos;t be imported. It fills over time via event opt-ins.
        </p>
      )}

      {/* Honest render-limit note (full counts are always correct above) */}
      {(sourceTruncated || masterTruncated) && (
        <p className="text-xs text-muted">
          Showing the most recent {(active ? rows.length : merged?.length ?? 0).toLocaleString()} of{" "}
          {(active ? counts[active] ?? 0 : masterCount).toLocaleString()} — counts above are exact.
        </p>
      )}

      {/* Data */}
      {active ? (
        rows.length > 0 ? (
          <ContactTable rows={rows} editable={editable} />
        ) : (
          <Empty>
            No contacts imported into <span className="text-accent">{meta?.label}</span> yet. The Phase 2 importer
            will pull this source on demand.
          </Empty>
        )
      ) : merged && merged.length > 0 ? (
        <ContactTable rows={merged} showSources editable={editable} />
      ) : (
        <Empty>
          No contacts yet. Phase 1 is the spine — the table + source tabs are live and the schema is in place.
          Phase 2 wires the importers (Lendr, Titan, Collin&apos;s World Sheet, Gmail, …) so these tabs fill on demand.
        </Empty>
      )}
    </div>
  );
}
