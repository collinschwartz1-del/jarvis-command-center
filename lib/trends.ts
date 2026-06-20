// SELF-LEARNING / TRENDS.
// Reads the activity log (Collin's actual behavior) + live briefs and turns them
// into patterns: where work comes from, how he resolves it, who's most
// demanding, and what Jarvis should start doing for him. This is the loop that
// lets the system learn from how he operates.

import { supabaseAdmin } from "./supabase";
import { getEmailBriefs } from "./queries";

// System events aren't "Collin decisions" — exclude from behavior metrics.
const SYSTEM_KINDS = new Set([
  "sync_run",
  "brief_delivered",
  "handoff_delivered",
]);

type Group = "decide" | "reply" | "capture" | "delegate" | "route";

const KIND_META: Record<string, { label: string; group: Group }> = {
  card_approved: { label: "Approved a card", group: "decide" },
  card_dismissed: { label: "Dismissed a card", group: "decide" },
  card_done: { label: "Completed a card", group: "decide" },
  reply_approved: { label: "Staged a reply", group: "reply" },
  reply_dismissed: { label: "Dismissed a reply", group: "reply" },
  lls_reply_drafted: { label: "Replied to a borrower", group: "reply" },
  inbox_captured: { label: "Captured from email", group: "capture" },
  inbox_project_created: { label: "Built a project", group: "capture" },
  inbox_dismissed: { label: "Cleared an email item", group: "capture" },
  delegated: { label: "Delegated", group: "delegate" },
  flip_routed: { label: "Routed to Flip Tracker", group: "route" },
};

const GROUP_LABEL: Record<Group, string> = {
  decide: "Decisions",
  reply: "Replies",
  capture: "Capture / build",
  delegate: "Delegation",
  route: "Routing",
};

export interface TrendsData {
  windowDays: number;
  totalActions: number;
  perDay: { date: string; count: number }[];
  byGroup: { group: Group; label: string; count: number }[];
  byKind: { kind: string; label: string; count: number }[];
  delegationRate: number; // delegated / total
  captureVsClear: { captured: number; cleared: number };
  demanding: { name: string; open: number; threads: number }[];
  captureSources: { name: string; count: number }[];
  suggestions: string[];
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function getTrends(windowDays = 30): Promise<TrendsData> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - windowDays * 864e5).toISOString();

  const [{ data: rawActs }, briefs] = await Promise.all([
    db
      .from("activity")
      .select("kind,at,summary")
      .gte("at", since)
      .order("at", { ascending: false }),
    getEmailBriefs(),
  ]);

  const acts = (rawActs ?? []).filter((a) => !SYSTEM_KINDS.has(a.kind));
  const total = acts.length;

  // throughput: actions per day for the last 14 days
  const perDay: { date: string; count: number }[] = [];
  for (let d = 13; d >= 0; d--) {
    const key = dayKey(new Date(Date.now() - d * 864e5).toISOString());
    perDay.push({ date: key, count: acts.filter((a) => dayKey(a.at) === key).length });
  }

  // by group + by kind
  const groupCount = new Map<Group, number>();
  const kindCount = new Map<string, number>();
  for (const a of acts) {
    const meta = KIND_META[a.kind];
    if (!meta) continue;
    groupCount.set(meta.group, (groupCount.get(meta.group) ?? 0) + 1);
    kindCount.set(a.kind, (kindCount.get(a.kind) ?? 0) + 1);
  }
  const byGroup = [...groupCount.entries()]
    .map(([group, count]) => ({ group, label: GROUP_LABEL[group], count }))
    .sort((a, b) => b.count - a.count);
  const byKind = [...kindCount.entries()]
    .map(([kind, count]) => ({ kind, label: KIND_META[kind]?.label ?? kind, count }))
    .sort((a, b) => b.count - a.count);

  const delegated = kindCount.get("delegated") ?? 0;
  const delegationRate = total ? delegated / total : 0;

  const captured =
    (kindCount.get("inbox_captured") ?? 0) +
    (kindCount.get("inbox_project_created") ?? 0);
  const cleared = kindCount.get("inbox_dismissed") ?? 0;

  // most-demanding relationships (clean person names from briefs)
  const demanding = briefs
    .map((b) => ({
      name: b.person_name,
      open: (b.action_items ?? []).filter((x) => !x.done).length,
      threads: b.thread_count,
    }))
    .filter((x) => x.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 6);

  // what Collin keeps turning into work — parse "Captured from {Name}:"
  const srcCount = new Map<string, number>();
  for (const a of acts) {
    if (a.kind !== "inbox_captured") continue;
    const m = /Captured from (.+?):/.exec(a.summary ?? "");
    if (m) srcCount.set(m[1], (srcCount.get(m[1]) ?? 0) + 1);
  }
  const captureSources = [...srcCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ---- Jarvis suggests: heuristics that close the learning loop ----
  const suggestions: string[] = [];
  const topDemand = demanding[0];
  if (topDemand && topDemand.open >= 3) {
    suggestions.push(
      `${topDemand.name} has ${topDemand.open} open actions on you — bundle them into a project or hand the routine ones to Sue.`
    );
  }
  if (total >= 5 && delegated === 0) {
    suggestions.push(
      `You've taken ${total} actions and delegated none. Try handing routine replies or captures to Sue/Karen to free your time.`
    );
  }
  if (captured >= 3 && captured > cleared * 2) {
    suggestions.push(
      `You turn most email into work (${captured} captured vs ${cleared} cleared). A standing project${
        captureSources[0] ? ` for ${captureSources[0].name}` : ""
      } may beat one-off cards.`
    );
  }
  const dismissed =
    (kindCount.get("reply_dismissed") ?? 0) + (kindCount.get("card_dismissed") ?? 0);
  if (dismissed >= 4 && dismissed > total * 0.4) {
    suggestions.push(
      `${dismissed} of your last ${total} actions were dismissals — Jarvis may be surfacing too much noise. Tighten what reaches you.`
    );
  }
  if (!suggestions.length && total > 0) {
    suggestions.push(
      "Healthy mix — no friction patterns detected this window. Keep going."
    );
  }

  return {
    windowDays,
    totalActions: total,
    perDay,
    byGroup,
    byKind,
    delegationRate,
    captureVsClear: { captured, cleared },
    demanding,
    captureSources,
    suggestions,
  };
}
