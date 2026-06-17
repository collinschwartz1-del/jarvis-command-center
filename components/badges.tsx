import type { CardTier, CardStatus, HandoffStatus } from "@/lib/types";

const TIER: Record<CardTier, { label: string; cls: string }> = {
  "1": { label: "TIER 1 · auto-safe", cls: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  "2": { label: "TIER 2 · draft", cls: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  "3": { label: "TIER 3 · approval", cls: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
};

const STATUS: Record<CardStatus, string> = {
  pending: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  approved: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  review: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  done: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10",
  dismissed: "text-zinc-500 border-zinc-700/40 bg-zinc-700/10",
  archived: "text-zinc-500 border-zinc-700/40 bg-zinc-700/10",
};

const HSTATUS: Record<HandoffStatus, string> = {
  pending: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  in_flight: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  delivered: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  done: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10",
  archived: "text-zinc-500 border-zinc-700/40 bg-zinc-700/10",
};

const base =
  "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border";

export function TierBadge({ tier }: { tier: CardTier }) {
  return <span className={`${base} ${TIER[tier].cls}`}>{TIER[tier].label}</span>;
}

export function StatusBadge({ status }: { status: CardStatus }) {
  return <span className={`${base} ${STATUS[status]}`}>{status}</span>;
}

export function HandoffStatusBadge({ status }: { status: HandoffStatus }) {
  return <span className={`${base} ${HSTATUS[status]}`}>{status.replace("_", " ")}</span>;
}
