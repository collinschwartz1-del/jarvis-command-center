// Pure types + presentation helpers for the action queue. NO server imports,
// so this is safe to pull into client components (the buttons/filter bar) while
// the data-fetching half (action-queue.ts) stays server-only.

export type ActionDomain =
  | "reply"
  | "card"
  | "borrower"
  | "deal"
  | "text"
  | "handoff";

export interface ActionQueueItem {
  key: string;
  domain: ActionDomain;
  refId: string; // raw id for inline server actions (card id, draft id, msg id…)
  label: string;
  title: string;
  why: string;
  href: string;
  urgency: number;
  ageHours: number | null;
  sensitive?: boolean;
}

const DOMAIN_META: Record<
  ActionDomain,
  { label: string; icon: string; accent: string }
> = {
  reply: { label: "Reply", icon: "✉", accent: "text-sky-300" },
  card: { label: "Decision", icon: "◆", accent: "text-rose-300" },
  borrower: { label: "Borrower", icon: "$", accent: "text-amber-300" },
  deal: { label: "Deal", icon: "⌂", accent: "text-emerald-300" },
  text: { label: "Text", icon: "✱", accent: "text-violet-300" },
  handoff: { label: "Handoff", icon: "⇄", accent: "text-zinc-300" },
};

export function domainMeta(d: ActionDomain) {
  return DOMAIN_META[d];
}

export const DOMAIN_ORDER: ActionDomain[] = [
  "reply",
  "card",
  "borrower",
  "deal",
  "text",
  "handoff",
];

// Per-domain open counts for the at-a-glance load strip / filter chips.
export function queueCounts(
  items: ActionQueueItem[]
): { domain: ActionDomain; count: number }[] {
  return DOMAIN_ORDER.map((domain) => ({
    domain,
    count: items.filter((i) => i.domain === domain).length,
  })).filter((x) => x.count > 0);
}
