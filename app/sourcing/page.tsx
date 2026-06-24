import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import {
  getDailyBrief,
  getCallQueue,
  getCallQueueCount,
  getDialStats,
  getLeadsBySource,
  getLeadCountBySource,
  type BriefLead,
} from "@/lib/deal-queries";
import { dealConfigured } from "@/lib/supabase-deal";
import { CallQueue } from "@/components/sourcing/CallQueue";

export const dynamic = "force-dynamic";

const usd = (n: number | string | null | undefined) => {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v == null || isNaN(v) ? "—" : "$" + Math.round(v).toLocaleString("en-US");
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    A: "bg-emerald-500/15 text-emerald-400",
    rev: "bg-amber-500/15 text-amber-400",
    now: "bg-cyan-500/15 text-cyan-300",
    nur: "bg-zinc-500/20 text-muted",
    llc: "bg-sky-500/15 text-sky-400",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${map[tone] ?? map.nur}`}>
      {children}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-b border-border/60 px-2.5 py-2 align-middle ${className}`}>{children}</td>;
}

export default async function SourcingPage() {
  const configured = dealConfigured();
  const [brief, calls, callableTotal, dial, mfLeads, mfCount] = await Promise.all([
    getDailyBrief(),
    getCallQueue(),
    getCallQueueCount(),
    getDialStats(),
    getLeadsBySource("mf_pipeline"),
    getLeadCountBySource("mf_pipeline"),
  ]);
  const contactRate = dial.today.calls ? Math.round((dial.today.contacts / dial.today.calls) * 100) : 0;

  const off = brief
    .filter((l) => l.source === "off_market")
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const whole = brief.filter((l) => l.source === "wholesaler");
  const on = brief.filter((l) => l.source === "on_market");
  const text = brief.filter((l) => l.source === "text_intel");
  const totalEquity = off.reduce((s, l) => s + (Number(l.equity_capture) || 0), 0);
  const approachNow = off.filter((l) => l.timing === "approach_now").length;

  const owner = (l: BriefLead) =>
    l.owner_name ? (
      <span>
        {l.owner_name}
        {l.owner_entity_type === "llc" && <> <Pill tone="llc">LLC</Pill></>}
      </span>
    ) : (
      <span className="text-muted">—</span>
    );

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <PageHeader
        title="SOURCING"
        subtitle="Omaha Deal Engine · one queue, every channel · off-market, wholesaler, on-market & text-intel leads from the deal-command-center spine."
      />

      {!configured && (
        <div className="mb-6">
          <Empty>
            Spine not connected. Add <span className="font-mono text-text">DCC_SUPABASE_URL</span> and{" "}
            <span className="font-mono text-text">DCC_SUPABASE_KEY</span> to{" "}
            <span className="font-mono text-text">.env.local</span> (deal-command-center / nhsmylrypwmhhjfbddox), then reload.
          </Empty>
        </div>
      )}

      {/* stat tiles */}
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: brief.length, l: "leads in queue", c: "text-sky-400" },
          { n: usd(totalEquity), l: "off-market equity capture", c: "text-emerald-400" },
          { n: approachNow, l: 'flagged "approach now"', c: "text-amber-400" },
          { n: callableTotal, l: "callable now (DNC-clean)", c: callableTotal ? "text-emerald-400" : "text-muted" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl border border-border bg-panel p-4">
            <div className={`text-2xl font-extrabold tracking-tight ${s.c}`}>{s.n}</div>
            <div className="mt-0.5 text-xs text-muted">{s.l}</div>
          </div>
        ))}
      </div>

      {/* dialing activity — the output side: is the queue actually being worked? */}
      <section className="mb-7">
        <SectionLabel>
          Dialing activity · today (Central)
          {dial.byCaller.length > 0 && (
            <span className="font-normal text-muted">
              {" · "}
              {dial.byCaller.map((c) => `${c.actor} ${c.calls}`).join(" · ")}
            </span>
          )}
        </SectionLabel>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { n: dial.today.calls, l: "calls today", c: "text-sky-400" },
            { n: `${contactRate}%`, l: `contact rate · ${dial.today.contacts} reached`, c: dial.today.contacts ? "text-cyan-300" : "text-muted" },
            { n: dial.today.interested, l: "hot / interested", c: dial.today.interested ? "text-emerald-400" : "text-muted" },
            { n: dial.today.voicemail, l: "voicemails", c: "text-muted" },
            { n: dial.today.callback, l: "callbacks", c: dial.today.callback ? "text-amber-400" : "text-muted" },
            { n: dial.today.dnc, l: "DNC today", c: dial.today.dnc ? "text-rose-400" : "text-muted" },
          ].map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-panel p-4">
              <div className={`text-2xl font-extrabold tracking-tight ${s.c}`}>{s.n}</div>
              <div className="mt-0.5 text-xs text-muted">{s.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Last 7 days: <span className="text-text">{dial.week.calls}</span> calls ·{" "}
          <span className="text-text">{dial.week.contacts}</span> reached ·{" "}
          <span className="text-emerald-400">{dial.week.interested}</span> hot
        </p>
      </section>

      {/* call queue — the action list */}
      <section className="mb-8">
        <SectionLabel>Call queue · DNC-clean phones ready to dial{callableTotal > calls.length ? ` · showing top ${calls.length} of ${callableTotal} (highest equity first)` : ""}</SectionLabel>
        {calls.length === 0 ? (
          <Empty>
            No callable phones yet. Run the Batch 02 skip-trace in PropStream, then{" "}
            <span className="font-mono text-text">node deal-engine/ingest-skiptrace.mjs results.csv</span> — DNC-clean
            numbers surface here automatically.
          </Empty>
        ) : (
          <CallQueue rows={calls} />
        )}
      </section>

      {/* off-market */}
      <section className="mb-8">
        <SectionLabel>Acreage (SFR) · off-market Tier-A motivated sellers</SectionLabel>
        {off.length === 0 ? (
          <Empty>No off-market leads in the queue.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>Address</Th><Th>Tier</Th><Th>Conf</Th><Th>Score</Th><Th>Equity capture</Th>
                  <Th>Acq (mid)</Th><Th>Timing</Th><Th>Owner</Th>
                </tr>
              </thead>
              <tbody>
                {off.map((l) => (
                  <tr key={l.lead_id} className="hover:bg-panel-2">
                    <Td className="font-medium">{l.display_address}</Td>
                    <Td><Pill tone="A">{l.rank_label}</Pill></Td>
                    <Td>{l.confidence ?? "—"}</Td>
                    <Td>{l.score ?? "—"}</Td>
                    <Td className="font-semibold text-emerald-400">{usd(l.equity_capture)}</Td>
                    <Td className="text-muted">{usd(l.acq_mid)}</Td>
                    <Td><Pill tone={l.timing === "approach_now" ? "now" : "nur"}>{l.timing === "approach_now" ? "approach now" : "nurture"}</Pill></Td>
                    <Td>{owner(l)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* multifamily track — off-market apartment targets (were hidden until now) */}
      <section className="mb-8">
        <SectionLabel>
          Multifamily · off-market apartment targets
          {mfCount > mfLeads.length ? ` · showing top ${mfLeads.length} of ${mfCount} by score` : ` · ${mfCount}`}
        </SectionLabel>
        {mfLeads.length === 0 ? (
          <Empty>No multifamily leads in the spine.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full text-[13px]">
              <thead>
                <tr><Th>Address</Th><Th>Type</Th><Th>Building SF</Th><Th>Condition / yr</Th><Th>Owner</Th><Th>Priority</Th></tr>
              </thead>
              <tbody>
                {mfLeads.map((l) => {
                  const p = (l.payload ?? {}) as Record<string, unknown>;
                  const sf = p.building_sf ? Number(p.building_sf).toLocaleString("en-US") : "—";
                  const absentee = p.owner_absentee === true;
                  const condYr = [p.condition, p.year_built].filter(Boolean).join(" · ") || "—";
                  return (
                    <tr key={l.lead_id} className="hover:bg-panel-2">
                      <Td className="font-medium">{l.display_address}</Td>
                      <Td className="text-muted">{String(p.building_desc ?? p.building_type ?? "—")}</Td>
                      <Td>{sf}</Td>
                      <Td className="text-muted">{condYr}</Td>
                      <Td>
                        {String(p.owner_name ?? l.owner_name ?? "—")}
                        {absentee && <> <Pill tone="now">absentee</Pill></>}
                      </Td>
                      <Td className="font-semibold text-amber-400">{String(p.priority_score ?? l.score ?? "—")}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* wholesaler */}
      {whole.length > 0 && (
        <section className="mb-8">
          <SectionLabel>Wholesaler · inbound deals</SectionLabel>
          <div className="overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full text-[13px]">
              <thead>
                <tr><Th>Address</Th><Th>Gate</Th><Th>Conf</Th><Th>Units</Th><Th>Contact</Th><Th>Next action</Th></tr>
              </thead>
              <tbody>
                {whole.map((l) => {
                  const pl = (l.payload ?? {}) as Record<string, unknown>;
                  const contact = [pl.contact_name, pl.contact_phone].filter(Boolean).join(" · ") || "—";
                  return (
                    <tr key={l.lead_id} className="hover:bg-panel-2">
                      <Td className="font-medium">{l.display_address}</Td>
                      <Td><Pill tone="rev">{l.gate ?? "REVIEW"}</Pill></Td>
                      <Td>{l.confidence ?? "—"}</Td>
                      <Td>{(pl.units as number) ?? "—"}</Td>
                      <Td>{String(contact)}</Td>
                      <Td className="text-muted">{String(pl.next_action ?? l.summary ?? "—")}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* on-market + text-intel review */}
      {(on.length > 0 || text.length > 0) && (
        <section className="mb-8">
          <SectionLabel>Review queue · on-market & text-intel</SectionLabel>
          <div className="overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full text-[13px]">
              <thead>
                <tr><Th>Address</Th><Th>Source</Th><Th>Gate</Th><Th>Conf</Th><Th>Ask</Th><Th>ARV</Th><Th>Why</Th></tr>
              </thead>
              <tbody>
                {[...on, ...text].map((l) => (
                  <tr key={l.lead_id} className="hover:bg-panel-2">
                    <Td className="font-medium">{l.display_address}</Td>
                    <Td className="text-muted">{l.source}</Td>
                    <Td><Pill tone="rev">{l.gate ?? "REVIEW"}</Pill></Td>
                    <Td>{l.confidence ?? "—"}</Td>
                    <Td>{usd(l.ask)}</Td>
                    <Td>{l.arv ? usd(l.arv) : <span className="text-muted">unverified</span>}</Td>
                    <Td className="text-muted">{l.reason ?? l.summary ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
