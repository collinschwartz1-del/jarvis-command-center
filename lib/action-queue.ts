// THE ACTION SPINE (Phase 1).
// One ranked, cross-domain list of everything open that needs Collin — pulled
// from every silo (replies, cards, borrower inbox, deals, texts, handoffs) so
// "what needs me right now" lives on one screen instead of 10 tabs.
//
// Each source maps to a normalized ActionQueueItem with an urgency score; the
// queue sorts by urgency desc, then most-recent. Scores are heuristic but tuned
// so money/time-sensitive/high-tier work floats above nurture/noise.

import {
  getCards,
  getPendingReplies,
  getLlsInbox,
  getDealAnalyses,
  getHandoffs,
} from "./queries";
import { getTextIntel } from "./textIntel";
import type { ActionQueueItem } from "./action-queue-types";

export type { ActionDomain, ActionQueueItem } from "./action-queue-types";
export { domainMeta, queueCounts } from "./action-queue-types";

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 36e5);
}

// A mild age nudge: the longer something sits, the more overdue it reads.
// Caps so a week-old item can't outrank a fresh money item by age alone.
function ageBoost(ageHours: number | null): number {
  if (ageHours == null) return 0;
  return Math.min(15, ageHours / 8);
}

export async function getActionQueue(): Promise<ActionQueueItem[]> {
  const [cards, replies, inbox, deals, handoffs] = await Promise.all([
    getCards(),
    getPendingReplies(),
    getLlsInbox(),
    getDealAnalyses(),
    getHandoffs(),
  ]);

  const items: ActionQueueItem[] = [];

  // 1. Reply drafts awaiting Collin's pick (pending + held).
  for (const r of replies) {
    const sensitive = r.sensitivity === "sensitive";
    const decision = r.reply_kind === "decision";
    const age = hoursSince(r.created_at);
    const base = sensitive ? 82 : decision ? 66 : 50;
    items.push({
      key: `reply-${r.id}`,
      refId: r.id,
      domain: "reply",
      label: sensitive ? "SENSITIVE" : decision ? "DECISION" : "REPLY",
      title: r.subject || `Reply to ${r.person_name}`,
      why: sensitive
        ? `${r.person_name} · flagged sensitive — review carefully`
        : `${r.person_name} · ${decision ? "pick an option" : "draft ready to send"}`,
      href: "/replies",
      urgency: base + ageBoost(age),
      ageHours: age,
      sensitive,
    });
  }

  // 2. Pending cards (decisions). Tier drives weight; only pending need Collin.
  for (const c of cards) {
    if (c.status !== "pending") continue;
    const base = c.tier === "3" ? 85 : c.tier === "2" ? 56 : 36;
    const age = hoursSince(c.created_at);
    items.push({
      key: `card-${c.id}`,
      refId: c.id,
      domain: "card",
      label: `TIER ${c.tier}`,
      title: c.title,
      why: c.why || c.action || "Awaiting your approval",
      href: "/projects",
      urgency: base + ageBoost(age),
      ageHours: age,
    });
  }

  // 3. Open borrower requests (money/time-sensitive). priority is numeric.
  for (const it of inbox) {
    if (it.handled) continue;
    const age = hoursSince(it.received_at);
    const base = 64 + (it.priority || 0) * 6;
    items.push({
      key: `borrower-${it.gmail_message_id}`,
      refId: it.gmail_message_id,
      domain: "borrower",
      label: (it.category || "REQUEST").toUpperCase(),
      title: it.request_summary || it.subject || `Request from ${it.from_name}`,
      why: `${it.from_name ?? it.from_email ?? "borrower"} · waiting on your reply`,
      href: "/lending",
      urgency: base + ageBoost(age),
      ageHours: age,
    });
  }

  // 4. Deals flagged but not yet underwritten (clear next action: run the screen).
  for (const d of deals) {
    if (d.routed_to) continue;
    if (d.fit_score != null) continue; // already screened
    if (d.asset_type === "flip") continue; // flips route elsewhere
    const age = hoursSince(d.created_at);
    items.push({
      key: `deal-${d.id}`,
      refId: d.id,
      domain: "deal",
      label: "UNDERWRITE",
      title: d.deal_name,
      why: `${d.address || d.source || "flagged from email"} · run the screen`,
      href: "/sales",
      urgency: 50 + ageBoost(age),
      ageHours: age,
    });
  }

  // 5. Texts owed a reply or flagged hot (local vault; empty in cloud by design).
  const intel = getTextIntel();
  if (intel.available) {
    for (const t of intel.cards) {
      if (!t.is_business) continue;
      if (t.replied) continue; // you already replied (reconciled) — don't nag
      const owed = t.owed_reply;
      const hot = t.category === "hot-lead" || t.category === "problem";
      if (!owed && !hot && !t.newInbound) continue;
      const age = hoursSince(t.lastIso);
      const base = t.newInbound ? 62 : hot ? 60 : t.priority === "high" ? 58 : 44;
      items.push({
        key: `text-${t.thread}`,
        refId: t.thread,
        domain: "text",
        label: t.newInbound
          ? "NEW MESSAGE"
          : owed
            ? "OWED REPLY"
            : t.category.toUpperCase().replace("-", " "),
        title: `${t.contact} — ${t.summary}`,
        why: t.newInbound ? "They texted back — your move" : t.suggested_action || "Follow up",
        href: "/texts",
        urgency: base + ageBoost(age),
        ageHours: age,
      });
    }
  }

  // 6. Handoffs in flight (rises with age — surfaces stuck ones).
  for (const h of handoffs) {
    if (h.status !== "pending" && h.status !== "in_flight") continue;
    const age = hoursSince(h.updated_at || h.created_at);
    items.push({
      key: `handoff-${h.id}`,
      refId: h.id,
      domain: "handoff",
      label: h.status === "in_flight" ? "IN FLIGHT" : "HANDOFF",
      title: h.ask,
      why: `${h.from_party} → ${h.to_party}`,
      href: "/bridge",
      urgency: 34 + ageBoost(age) * 1.6,
      ageHours: age,
    });
  }

  items.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    return (b.ageHours ?? 0) - (a.ageHours ?? 0); // older first on ties
  });
  return items;
}
