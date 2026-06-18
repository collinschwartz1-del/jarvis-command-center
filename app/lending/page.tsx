import {
  getLlsSnapshot,
  getLlsLoans,
  getLlsInbox,
  getLlsCommentsByLoan,
  getLlsReports,
} from "@/lib/queries";
import { PageHeader, SectionLabel, Empty } from "@/components/ui";
import { StatTiles } from "@/components/lls/StatTiles";
import { CashflowStrip } from "@/components/lls/CashflowStrip";
import { BorrowerInbox } from "@/components/lls/BorrowerInbox";
import { PipelineBoard } from "@/components/lls/PipelineBoard";
import { LoanRow } from "@/components/lls/LoanRow";
import { Concentration } from "@/components/lls/Concentration";
import { MonthlyFinancials } from "@/components/lls/MonthlyFinancials";
import { timeAgo } from "@/lib/format";
import type { LlsLoan } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LendingPage() {
  const [snap, loans, inbox, reports] = await Promise.all([
    getLlsSnapshot(),
    getLlsLoans(),
    getLlsInbox(),
    getLlsReports(),
  ]);

  // comments only for loans referenced by inbox items (carry team feedback through)
  const matchedIds = [
    ...new Set(inbox.map((i) => i.matched_loan_id).filter((x): x is string => !!x)),
  ];
  const commentsByLoan = await getLlsCommentsByLoan(matchedIds);

  const loansById: Record<string, LlsLoan> = {};
  for (const l of loans) loansById[l.lendr_id] = l;
  const active = loans.filter((l) => l.loan_type === "active");

  // open (unhandled) items first, then handled — both already priority-sorted
  const open = inbox.filter((i) => !i.handled);
  const handled = inbox.filter((i) => i.handled);
  const orderedInbox = [...open, ...handled];

  return (
    <div className="space-y-8">
      <PageHeader
        title="LLS · LENDING"
        subtitle={
          snap
            ? `Liquid Lending Solutions — live from Lendr. Snapshot ${timeAgo(
                snap.captured_at
              )}.`
            : "Liquid Lending Solutions — run the LLS sync to populate this dashboard."
        }
      />

      {snap ? (
        <>
          {/* 1 — capital + health stats */}
          <StatTiles snap={snap} />

          {/* 2 — 30-day cash flow (payoffs vs deploys) */}
          <CashflowStrip raw={snap.raw} />

          {/* 3 — borrower inbox, directly under the stats (as requested) */}
          <section>
            <SectionLabel>
              Borrower Inbox{open.length ? ` · ${open.length} open` : ""}
            </SectionLabel>
            {orderedInbox.length ? (
              <BorrowerInbox
                items={orderedInbox}
                loansById={loansById}
                commentsByLoan={commentsByLoan}
              />
            ) : (
              <Empty>
                No borrower-request mail yet. The sync pulls LLS mail (Luke, Angie,
                borrowers, Lendr) and classifies it here.
              </Empty>
            )}
          </section>

          {/* 4 — pipeline (waiting for approval) */}
          <section>
            <SectionLabel>Pipeline · Waiting for Approval</SectionLabel>
            <PipelineBoard raw={snap.raw} />
          </section>

          {/* 5 — active loans */}
          <section>
            <SectionLabel>Active Loans · {active.length}</SectionLabel>
            {active.length ? (
              <div className="grid gap-2.5 lg:grid-cols-2">
                {active.map((l) => (
                  <LoanRow key={l.lendr_id} loan={l} />
                ))}
              </div>
            ) : (
              <Empty>No active loans synced yet.</Empty>
            )}
          </section>

          {/* 6 — concentration risk + monthly financials */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <SectionLabel>Concentration Risk</SectionLabel>
              <Concentration raw={snap.raw} />
            </div>
            <div>
              <SectionLabel>Monthly Financials</SectionLabel>
              <MonthlyFinancials raw={snap.raw} reports={reports} />
            </div>
          </section>
        </>
      ) : (
        <Empty>
          No Lendr snapshot yet. Add LENDR_API_BASE / LENDR_API_KEY to .env.local and
          run <span className="font-mono text-accent">npm run lls-sync</span>.
        </Empty>
      )}
    </div>
  );
}
