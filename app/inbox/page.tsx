import { getEmailBriefs } from "@/lib/queries";
import { EmailBriefCard } from "@/components/email-brief";
import { MetricTile } from "@/components/metric-tile";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const briefs = await getEmailBriefs();

  const openOf = (b: (typeof briefs)[number]) =>
    (b.action_items ?? []).filter((a) => !a.done).length;

  // Most-demanding relationships first: who has the most open actions on you,
  // then most recent. Surfaces what needs a move instead of a flat list.
  const sorted = [...briefs].sort(
    (a, b) =>
      openOf(b) - openOf(a) ||
      new Date(b.latest_at ?? 0).getTime() - new Date(a.latest_at ?? 0).getTime()
  );

  const people = briefs.length;
  const threads = briefs.reduce((n, b) => n + b.thread_count, 0);
  const openActions = briefs.reduce((n, b) => n + openOf(b), 0);

  return (
    <div>
      <PageHeader
        title="INBOX"
        subtitle="Your mail, summarized by person — the takeaways and what you owe, without opening a thread."
      />

      <div className="mb-8 grid grid-cols-3 gap-4">
        <MetricTile label="People" value={people} sub="with mail" />
        <MetricTile label="Threads" value={threads} sub="last 48h" />
        <MetricTile label="Actions" value={openActions} sub="open on you" />
      </div>

      {sorted.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((b) => (
            <EmailBriefCard key={b.id} brief={b} />
          ))}
        </div>
      ) : (
        <Empty>
          No email summarized yet. Run the inbox ingest (pulls the last 48h from
          Gmail + Outlook and summarizes by person).
        </Empty>
      )}
    </div>
  );
}
