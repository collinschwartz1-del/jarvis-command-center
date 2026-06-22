import { getEmailBriefs, getMutedInbox } from "@/lib/queries";
import { EmailBriefCard } from "@/components/email-brief";
import { MetricTile } from "@/components/metric-tile";
import { PageHeader, Empty } from "@/components/ui";
import type { EmailBrief, InboxCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

// The four triage buckets, in the order Collin works them: what only he can
// unblock first, pure awareness last. Each bucket answers "what do you need to
// do?" instead of dumping mail sorted by volume.
const BUCKETS: {
  key: InboxCategory;
  title: string;
  blurb: string;
  accent: string; // header text color
  dot: string; // status dot
}[] = [
  {
    key: "sign",
    title: "Sign / Approve",
    blurb: "Your signature or approval is the only thing in the way.",
    accent: "text-rose-300",
    dot: "bg-rose-400",
  },
  {
    key: "question",
    title: "Needs Your Answer",
    blurb: "Someone is waiting on a decision from you.",
    accent: "text-amber-300",
    dot: "bg-amber-400",
  },
  {
    key: "awaiting",
    title: "Awaiting Them",
    blurb: "You replied — the ball is in their court. Nudge only if it goes stale.",
    accent: "text-sky-300",
    dot: "bg-sky-400",
  },
  {
    key: "fyi",
    title: "For Awareness",
    blurb: "Informational. Nothing owed by you.",
    accent: "text-zinc-400",
    dot: "bg-zinc-500",
  },
];

export default async function InboxPage() {
  const [briefs, muted] = await Promise.all([getEmailBriefs(), getMutedInbox()]);

  const openOf = (b: EmailBrief) =>
    (b.action_items ?? []).filter((a) => !a.done).length;

  // Within a bucket, surface the most-demanding relationship first, then recency.
  const inBucket = (cat: InboxCategory) =>
    briefs
      .filter((b) => b.category === cat)
      .sort(
        (a, b) =>
          openOf(b) - openOf(a) ||
          new Date(b.latest_at ?? 0).getTime() -
            new Date(a.latest_at ?? 0).getTime()
      );

  const count = (cat: InboxCategory) =>
    briefs.filter((b) => b.category === cat).length;
  const needsYou = count("sign") + count("question");

  return (
    <div>
      <PageHeader
        title="INBOX"
        subtitle="Triaged by what you need to do — not a flat list. Sign/approve floats to the top; pure noise is muted out."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Needs You" value={needsYou} sub="sign + answer" />
        <MetricTile label="Awaiting" value={count("awaiting")} sub="ball in their court" />
        <MetricTile label="FYI" value={count("fyi")} sub="awareness only" />
        <MetricTile label="Muted" value={muted.length} sub="machine noise" />
      </div>

      {/* Audit trail for the muted counter — muting only changes what Jarvis
          shows; the mail is untouched in Gmail. Collapsed by default. */}
      {muted.length > 0 && (
        <details className="mb-8 rounded-lg border border-border bg-panel-2 px-4 py-3">
          <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wider text-muted hover:text-text">
            {muted.length} message{muted.length === 1 ? "" : "s"} muted as machine
            noise — click to audit (nothing is touched in Gmail)
          </summary>
          <ul className="mt-3 space-y-1.5">
            {muted.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-zinc-400"
              >
                <span className="font-medium text-zinc-300">
                  {m.from_name || m.from_email || "unknown"}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {m.from_email}
                </span>
                <span className="truncate text-zinc-500">{m.subject}</span>
                <span className="ml-auto font-mono text-[10px] text-border-bright">
                  {m.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted">
            To silence a new sender, add its domain to MUTED_SENDERS in
            lib/inbox-rules.mjs.
          </p>
        </details>
      )}

      {briefs.length === 0 ? (
        <Empty>
          No email summarized yet. Run the inbox ingest (pulls the last 48h from
          Gmail + Outlook, mutes machine noise, and triages the rest by what you
          need to do).
        </Empty>
      ) : (
        <div className="space-y-10">
          {BUCKETS.map((bucket) => {
            const rows = inBucket(bucket.key);
            if (!rows.length) return null;
            const compact = bucket.key === "fyi";
            return (
              <section key={bucket.key}>
                <div className="mb-3 flex items-baseline gap-2.5">
                  <span className={`h-2 w-2 rounded-full ${bucket.dot}`} />
                  <h2 className={`text-sm font-semibold ${bucket.accent}`}>
                    {bucket.title}
                  </h2>
                  <span className="font-mono text-[11px] text-muted">
                    {rows.length}
                  </span>
                  <span className="hidden text-xs text-muted sm:inline">
                    · {bucket.blurb}
                  </span>
                </div>
                <div
                  className={
                    compact
                      ? "space-y-2"
                      : "grid gap-4 lg:grid-cols-2"
                  }
                >
                  {rows.map((b) => (
                    <EmailBriefCard key={b.id} brief={b} compact={compact} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
