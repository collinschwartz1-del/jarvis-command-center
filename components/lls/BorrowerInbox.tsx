"use client";

import { useMemo, useState } from "react";
import { Mail, MessageSquare, Link2 } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { ReplyBox } from "@/components/lls/ReplyBox";
import type { LlsInboxItem, LlsLoan, LlsLoanComment } from "@/lib/types";

const CATEGORY: Record<string, string> = {
  "borrower-request": "text-amber-300 border-amber-500/40 bg-amber-500/10",
  draw: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  payoff: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  notification: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
  other: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
};

function InboxItem({
  item,
  loan,
  comments,
}: {
  item: LlsInboxItem;
  loan: LlsLoan | undefined;
  comments: LlsLoanComment[];
}) {
  const isTeam = (item.from_email || "").endsWith("@liquidlendingsolutions.com");
  return (
    <div
      className={`ticked rounded-lg border bg-panel p-5 ${
        item.handled ? "border-border opacity-60" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={14} className="text-muted" />
        <span className="text-sm font-semibold text-text">
          {item.from_name || item.from_email}
        </span>
        {isTeam && (
          <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
            LLS Team
          </span>
        )}
        <span
          className={`ml-auto inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            CATEGORY[item.category || "other"] ?? CATEGORY.other
          }`}
        >
          {item.category || "other"}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span className="truncate">{item.from_email}</span>
        {item.received_at && (
          <>
            <span className="text-border-bright">/</span>
            <span className="shrink-0">{timeAgo(item.received_at)}</span>
          </>
        )}
      </div>

      <p className="mt-3 text-sm font-medium text-zinc-200">{item.subject}</p>
      {item.request_summary && (
        <p className="mt-1 text-sm leading-relaxed text-accent/90">{item.request_summary}</p>
      )}
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{item.snippet}</p>

      {loan && (
        <div className="mt-3 flex items-center gap-2 rounded border border-border bg-panel-2 px-2.5 py-1.5 text-xs">
          <Link2 size={12} className="text-muted" />
          <span className="text-zinc-300">{loan.borrower_name}</span>
          <span className="text-muted">·</span>
          <span className="truncate text-muted">{loan.address}</span>
        </div>
      )}

      {comments.length > 0 && (
        <div className="mt-3 rounded border border-border bg-panel-2 p-3">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">
            <MessageSquare size={11} /> Loan comments · team feedback
          </div>
          <ul className="mt-2 space-y-2">
            {comments.slice(0, 4).map((c) => (
              <li key={c.lendr_comment_id} className="text-sm leading-snug">
                <span className="font-mono text-[11px] text-accent/80">
                  {c.author || "—"}
                </span>
                <span className="ml-1.5 text-[10px] text-muted">{timeAgo(c.created_at)}</span>
                <p className="mt-0.5 text-zinc-300">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReplyBox messageId={item.gmail_message_id} hasLoan={!!item.matched_loan_id} />
    </div>
  );
}

export function BorrowerInbox({
  items,
  loansById,
  commentsByLoan,
}: {
  items: LlsInboxItem[];
  loansById: Record<string, LlsLoan>;
  commentsByLoan: Record<string, LlsLoanComment[]>;
}) {
  const [cat, setCat] = useState<string>("all");
  const [openOnly, setOpenOnly] = useState(false);

  // Categories actually present, in a stable order.
  const cats = useMemo(() => {
    const order = ["borrower-request", "draw", "payoff", "notification", "other"];
    const present = new Set(items.map((i) => i.category || "other"));
    return order.filter((c) => present.has(c));
  }, [items]);

  const visible = items.filter(
    (i) =>
      (cat === "all" || (i.category || "other") === cat) &&
      (!openOnly || !i.handled)
  );

  const chip = (key: string, label: string, n: number) => (
    <button
      key={key}
      onClick={() => setCat(key)}
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        cat === key
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-border bg-panel-2 text-muted hover:text-text"
      }`}
    >
      {label} {n}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chip("all", "All", items.length)}
        {cats.map((c) =>
          chip(c, c, items.filter((i) => (i.category || "other") === c).length)
        )}
        <button
          onClick={() => setOpenOnly((v) => !v)}
          className={`ml-auto rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
            openOnly
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-border bg-panel-2 text-muted hover:text-text"
          }`}
        >
          {openOnly ? "✓ " : ""}Open only
        </button>
      </div>

      {visible.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((item) => (
            <InboxItem
              key={item.gmail_message_id}
              item={item}
              loan={item.matched_loan_id ? loansById[item.matched_loan_id] : undefined}
              comments={
                item.matched_loan_id ? commentsByLoan[item.matched_loan_id] ?? [] : []
              }
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-panel px-4 py-5 text-sm text-muted">
          Nothing in this view.
        </p>
      )}
    </div>
  );
}
