"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  type ActionQueueItem,
  type ActionDomain,
  domainMeta,
  queueCounts,
} from "@/lib/action-queue-types";
import { approveCard, dismissCard, dismissReply } from "@/app/actions";
import { markHandled } from "@/app/lending/actions";
import { DelegateButton } from "./delegate-button";
import { useCanWrite } from "./role-context";

const DELEGATABLE = new Set(["card", "reply", "borrower"]);

function age(h: number | null): string {
  if (h == null) return "";
  if (h < 1) return "now";
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

type Filter = ActionDomain | "all";

// Phase 2: the spine is now a triage surface. Resolve the common items in place
// (approve/dismiss a card, dismiss a reply, mark a borrower request handled) and
// filter by desk to cut noise. Items that need richer UI still deep-link out.
export function ActionQueueBoard({
  items,
  limit = 14,
}: {
  items: ActionQueueItem[];
  limit?: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const canWrite = useCanWrite();

  const counts = useMemo(() => queueCounts(items), [items]);
  const live = items.filter((i) => !resolved.has(i.key));
  const visible = live
    .filter((i) => filter === "all" || i.domain === filter)
    .slice(0, limit);

  function resolve(key: string, fn: () => Promise<unknown>) {
    setResolved((prev) => new Set(prev).add(key));
    start(async () => {
      try {
        await fn();
      } catch {
        // action failed — put it back so nothing is silently lost
        setResolved((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    });
  }

  const chip = (key: Filter, label: string, count: number, icon?: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        filter === key
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-border bg-panel-2 text-muted hover:text-text"
      }`}
    >
      {icon ? <span className="mr-1">{icon}</span> : null}
      {label} {count}
    </button>
  );

  return (
    <div className={pending ? "opacity-90" : ""}>
      {/* filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {chip("all", "All", live.length)}
        {counts.map(({ domain, count }) => {
          const m = domainMeta(domain);
          return chip(domain, m.label, count, m.icon);
        })}
      </div>

      {/* the queue */}
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {visible.map((it) => (
          <Row
            key={it.key}
            item={it}
            onResolve={resolve}
            canWrite={canWrite}
            pending={pending}
          />
        ))}
        {!visible.length && (
          <p className="col-span-full rounded-lg border border-border bg-panel px-4 py-5 text-sm text-muted">
            Nothing here. {filter !== "all" && "Try another desk."}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  item,
  onResolve,
  canWrite,
  pending,
}: {
  item: ActionQueueItem;
  onResolve: (key: string, fn: () => Promise<unknown>) => void;
  canWrite: boolean;
  pending: boolean;
}) {
  const m = domainMeta(item.domain);
  return (
    <div
      className={`ticked flex flex-col rounded-lg border bg-panel p-3.5 ${
        item.sensitive ? "border-rose-500/40" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`font-mono text-xs ${m.accent}`}>{m.icon}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            item.sensitive ? "bg-rose-500/15 text-rose-300" : "bg-panel-2 text-muted"
          }`}
        >
          {item.label}
        </span>
        {item.ageHours != null && (
          <span className="ml-auto font-mono text-[10px] text-muted">
            {age(item.ageHours)}
          </span>
        )}
      </div>

      <Link href={item.href} className="group mt-2 block">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-text group-hover:text-accent">
          {item.title}
        </p>
        <p className="mt-1 line-clamp-1 text-xs text-muted">{item.why}</p>
      </Link>

      {/* inline actions — owners only; viewers get the deep-link */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        {canWrite && item.domain === "card" && (
          <>
            <ActBtn
              tone="go"
              label="✓ Approve"
              disabled={pending}
              onClick={() => onResolve(item.key, () => approveCard(item.refId))}
            />
            <ActBtn
              tone="kill"
              label="Dismiss"
              disabled={pending}
              onClick={() => onResolve(item.key, () => dismissCard(item.refId))}
            />
          </>
        )}
        {canWrite && item.domain === "reply" && (
          <ActBtn
            tone="kill"
            label="Dismiss"
            disabled={pending}
            onClick={() => onResolve(item.key, () => dismissReply(item.refId))}
          />
        )}
        {canWrite && item.domain === "borrower" && (
          <ActBtn
            tone="go"
            label="✓ Mark handled"
            disabled={pending}
            onClick={() => onResolve(item.key, () => markHandled(item.refId))}
          />
        )}
        {canWrite && DELEGATABLE.has(item.domain) && (
          <DelegateButton
            domain={item.domain as "card" | "reply" | "borrower"}
            refId={item.refId}
            title={item.title}
            disabled={pending}
            onHandOff={(fn) => onResolve(item.key, fn)}
          />
        )}
        <Link
          href={item.href}
          className="ml-auto font-mono text-[11px] text-muted transition-colors hover:text-accent"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}

function ActBtn({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  tone: "go" | "kill";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2 py-1 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "go"
          ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border border-border text-muted hover:bg-panel-2 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
