import { supabaseAdmin } from "./supabase";

// All reads target the `brain` schema (LeavenWealth Business Brain) in the same
// jarvis-command-center Supabase project. Service-role only (RLS deny-all).
const brain = () => supabaseAdmin().schema("brain");

export const BUSINESSES = [
  "LeavenWealth",
  "Liquid Lending",
  "Acreage Brothers",
  "Titan Mastermind",
  "MASC Investments",
  "Other",
];

export type BrainStats = {
  total: number;
  byBusiness: { business: string; count: number }[];
  principalCount: number;
  latest: string | null;
  earliest: string | null;
};

export async function getBrainStats(): Promise<BrainStats> {
  const b = brain();
  const total = (await b.from("communications").select("*", { count: "exact", head: true })).count ?? 0;
  const byBusiness = await Promise.all(
    BUSINESSES.map(async (business) => ({
      business,
      count: (await b.from("communications").select("*", { count: "exact", head: true }).eq("business", business)).count ?? 0,
    }))
  );
  const principalCount =
    (await b.from("communications").select("*", { count: "exact", head: true }).not("extracted->deep", "is", null)).count ?? 0;
  const latest =
    (await b.from("communications").select("occurred_at").order("occurred_at", { ascending: false }).limit(1)).data?.[0]?.occurred_at ?? null;
  const earliest =
    (await b.from("communications").select("occurred_at").not("occurred_at", "is", null).order("occurred_at", { ascending: true }).limit(1)).data?.[0]
      ?.occurred_at ?? null;
  return { total, byBusiness: byBusiness.sort((a, z) => z.count - a.count), principalCount, latest, earliest };
}

export type DecisionItem = { subject: string | null; business: string | null; occurred_at: string | null; decision: string };

// Crown jewels: decisions the Opus deep-extract pulled from principal (Chris/Collin) mail.
export async function getRecentDecisions(limit = 14): Promise<DecisionItem[]> {
  const { data } = await brain()
    .from("communications")
    .select("subject,business,occurred_at,extracted")
    .not("extracted->deep", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(160);
  const out: DecisionItem[] = [];
  for (const r of (data ?? []) as { subject: string | null; business: string | null; occurred_at: string | null; extracted: { deep?: { decisions?: { decision?: string }[] } } }[]) {
    const d = r.extracted?.deep?.decisions?.[0]?.decision;
    if (d) out.push({ subject: r.subject, business: r.business, occurred_at: r.occurred_at, decision: d });
    if (out.length >= limit) break;
  }
  return out;
}

export type CommHit = {
  id: string;
  subject: string | null;
  snippet: string | null;
  business: string | null;
  occurred_at: string | null;
};

export type ActionItem = {
  id: string;
  function: string;
  title: string;
  detail: string | null;
  confidence: number | null;
  provenance: { urgency?: string; business?: string | null; agent?: string } | null;
  created_at: string;
};

// The HITL queue — AI-operator proposals awaiting a human decision.
export async function getActionQueue(): Promise<ActionItem[]> {
  const { data } = await brain()
    .from("action_items")
    .select("id,function,title,detail,confidence,provenance,created_at")
    .eq("approval_state", "proposed")
    .order("created_at", { ascending: false });
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return ((data ?? []) as ActionItem[]).sort(
    (a, z) => (rank[a.provenance?.urgency ?? "medium"] ?? 1) - (rank[z.provenance?.urgency ?? "medium"] ?? 1)
  );
}

// FTS retrieval used by the "Ask the Brain" route (server-side).
export async function searchComms(q: string, biz: string | null, lim = 40): Promise<CommHit[]> {
  const { data, error } = await brain().rpc("search_comms", { q, biz: biz ?? null, lim });
  if (error) throw error;
  return (data ?? []) as CommHit[];
}
