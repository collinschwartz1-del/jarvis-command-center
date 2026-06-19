import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Hammer, ExternalLink } from "lucide-react";
import { getDealAnalysis } from "@/lib/queries";
import { AnalysisCard } from "@/components/analysis-card";
import { RunUnderwritingButton } from "@/components/run-underwriting-button";
import { SectionLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

function money(n: number | null) {
  return n == null ? "—" : `$${n.toLocaleString()}`;
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const a = await getDealAnalysis(id);
  if (!a) notFound();

  const isFlip = a.asset_type === "flip" || a.routed_to === "flip-tracker";
  // A flagged-but-not-yet-underwritten multifamily stub: no score yet, not a flip.
  const isStub = !isFlip && a.fit_score == null;
  const flipTrackerUrl = process.env.NEXT_PUBLIC_FLIP_TRACKER_URL;

  return (
    <div>
      <Link
        href="/sales"
        className="mb-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-text"
      >
        <ArrowLeft size={13} /> Back to Sales
      </Link>

      {/* The full analysis output */}
      <AnalysisCard a={a} />

      {/* Actions / full-access */}
      {(isStub || isFlip) && (
        <div className="mt-6">
          <SectionLabel>Full access</SectionLabel>
          <div className="rounded-lg border border-border bg-panel p-5">
            {isStub && (
              <>
                <p className="mb-3 text-sm text-muted">
                  This deal was flagged from email but hasn&apos;t been
                  underwritten yet. Run the LW multifamily screen to generate the
                  fit score, fit table, red flags, and broker questions — written
                  back to this same page.
                </p>
                <RunUnderwritingButton
                  id={a.id}
                  dealName={a.deal_name}
                  address={a.address}
                  source={a.source}
                />
              </>
            )}

            {isFlip && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">
                  Flip underwriting (ARV, rehab, margin) is computed in the Flip
                  Tracker app, not in Jarvis.
                </p>
                {flipTrackerUrl ? (
                  <a
                    href={flipTrackerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
                  >
                    <Hammer size={14} /> Open in Flip Tracker{" "}
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-muted">
                    Flip Tracker link not configured — set
                    NEXT_PUBLIC_FLIP_TRACKER_URL to enable the click-out.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deal metadata */}
      <div className="mt-6">
        <SectionLabel>Details</SectionLabel>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-panel p-5 text-sm sm:grid-cols-3">
          <Meta label="Asset type" value={a.asset_type} />
          <Meta label="Units" value={a.units != null ? String(a.units) : "—"} />
          <Meta label="Price" value={money(a.price)} />
          <Meta label="Price / unit" value={money(a.price_per_unit)} />
          <Meta
            label="In-place cap"
            value={a.in_place_cap != null ? `${a.in_place_cap}%` : "—"}
          />
          <Meta
            label="Expense ratio"
            value={a.expense_ratio != null ? `${a.expense_ratio}%` : "—"}
          />
          <Meta label="Source" value={a.source ?? "—"} />
          <Meta label="From" value={a.person_email ?? "—"} />
          <Meta
            label="Created"
            value={new Date(a.created_at).toLocaleString()}
          />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-zinc-200">{value}</div>
    </div>
  );
}
