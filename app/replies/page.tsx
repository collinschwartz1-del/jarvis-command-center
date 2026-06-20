import { getPendingReplies } from "@/lib/queries";
import { RepliesBoard } from "@/components/replies-board";
import { ReplyReconciler } from "@/components/reply-reconciler";
import { MetricTile } from "@/components/metric-tile";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const replies = await getPendingReplies();

  const total = replies.length;
  const decisions = replies.filter((r) => r.reply_kind === "decision").length;
  const sensitive = replies.filter((r) => r.sensitivity === "sensitive").length;

  return (
    <div>
      <PageHeader
        title="REPLIES"
        subtitle="A prepopulated reply in your voice for every email that needs one. Yes/no and either/or threads get multiple options. Pick one, tweak if needed, and approve — it stages a Gmail draft on the thread for you to send. Sensitive threads (money, investor, loan, terms) are drafted safely and flagged."
      />

      <div className="mb-8 grid grid-cols-3 gap-4">
        <MetricTile label="Awaiting you" value={total} sub="threads" />
        <MetricTile label="Decisions" value={decisions} sub="multi-option" />
        <MetricTile label="Sensitive" value={sensitive} sub="review closely" />
      </div>

      <ReplyReconciler />

      {replies.length ? (
        <RepliesBoard drafts={replies} />
      ) : (
        <Empty>
          No replies waiting. Run the reply drafter (pulls the last 48h, drafts
          low-risk replies in your voice, and Sue clears them) to populate this
          queue.
        </Empty>
      )}
    </div>
  );
}
