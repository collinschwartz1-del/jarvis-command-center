import { supabaseAdmin } from "./supabase";
import type {
  Agent,
  Card,
  Briefing,
  Deal,
  Handoff,
  Metric,
  Activity,
  ActionItem as ActionItemT,
  EmailBrief,
  EmailDraft,
  DraftVariant,
  DealAnalysis,
  Property,
  PortfolioSummary,
  LlsSnapshot,
  LlsLoan,
  LlsLoanComment,
  LlsInboxItem,
  LlsReport,
} from "./types";

export async function getAgents(): Promise<Agent[]> {
  const { data } = await supabaseAdmin()
    .from("agents")
    .select("*")
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return data ?? [];
}

export async function getCards(): Promise<Card[]> {
  const { data } = await supabaseAdmin()
    .from("cards")
    .select("*")
    .order("tier", { ascending: true })
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getLatestBriefing(): Promise<Briefing | null> {
  const { data } = await supabaseAdmin()
    .from("briefings")
    .select("*")
    .order("brief_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getDeals(): Promise<Deal[]> {
  const { data } = await supabaseAdmin()
    .from("deals")
    .select("*")
    .order("updated_at", { ascending: false });
  return data ?? [];
}

export async function getHandoffs(): Promise<Handoff[]> {
  const { data } = await supabaseAdmin()
    .from("handoffs")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getTodayMetric(): Promise<Metric | null> {
  const { data } = await supabaseAdmin()
    .from("metrics")
    .select("*")
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getDealAnalyses(): Promise<DealAnalysis[]> {
  const { data } = await supabaseAdmin()
    .from("deal_analyses")
    .select("*")
    .order("fit_score", { ascending: false, nullsFirst: false });
  return data ?? [];
}

export async function getDealAnalysis(id: string): Promise<DealAnalysis | null> {
  const { data } = await supabaseAdmin()
    .from("deal_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

export async function getEmailBriefs(): Promise<EmailBrief[]> {
  const { data } = await supabaseAdmin()
    .from("email_briefs")
    .select("*")
    .order("latest_at", { ascending: false });
  // action_items is JSONB written inconsistently by the intel cron: sometimes a
  // string[] (legacy), sometimes a {text,done}[] (current), sometimes null.
  // Normalize every element to {text,done} so the UI + actions never choke on a
  // bare string (the old crash: "Cannot create property 'done' on string").
  return (data ?? []).map((b) => ({
    ...b,
    action_items: normalizeActionItems(b.action_items),
  }));
}

export function normalizeActionItems(raw: unknown): ActionItemT[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) =>
      typeof a === "string"
        ? { text: a, done: false }
        : {
            text: String((a as { text?: unknown })?.text ?? ""),
            done: !!(a as { done?: unknown })?.done,
          }
    )
    .filter((a) => a.text.trim().length > 0);
}

// Reply drafts for the /replies approval queue — every reply-needed thread that's
// awaiting Collin. Includes 'pending' (Sue cleared >=1 option) and 'held' (Sue
// flagged every option) so Collin always has a reply to start from; the card
// surfaces Sue's caution on held variants. Newest first. Normalizes variants to
// an array (jsonb can come back null) and, for legacy single-draft rows written
// before the variants migration, synthesizes a one-entry variant from draft_body.
export async function getPendingReplies(): Promise<EmailDraft[]> {
  const { data } = await supabaseAdmin()
    .from("email_drafts")
    .select("*")
    .in("status", ["pending", "held"])
    .order("created_at", { ascending: false });
  // The drafter inserts one row per run, so a thread can have several rows across
  // days. Keep only the newest per thread (rows are already newest-first).
  const seen = new Set<string>();
  const latest = (data ?? []).filter((d) => {
    const key = d.gmail_thread_id ?? d.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return latest.map((d) => {
    let variants: DraftVariant[] = Array.isArray(d.variants) ? d.variants : [];
    if (!variants.length && d.draft_body) {
      variants = [
        {
          label: "Reply",
          body: d.draft_body,
          verdict: d.sue_verdict === "hold" ? "hold" : "approve",
          note: d.sue_note ?? null,
        },
      ];
    }
    return { ...d, variants } as EmailDraft;
  });
}

export async function getProperties(company = "pgo"): Promise<Property[]> {
  const { data } = await supabaseAdmin()
    .from("properties")
    .select("*")
    .eq("folio_company", company)
    .order("market_value", { ascending: false, nullsFirst: false });
  return data ?? [];
}

export async function getPortfolioSummary(
  company = "pgo"
): Promise<PortfolioSummary | null> {
  const { data } = await supabaseAdmin()
    .from("portfolio_summary")
    .select("*")
    .eq("folio_company", company)
    .maybeSingle();
  return data ?? null;
}

export async function getActivity(limit = 12): Promise<Activity[]> {
  const { data } = await supabaseAdmin()
    .from("activity")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// The freshest morning-sync timestamp — sync.mjs writes a `sync_run` activity
// row every time the daily pipeline lands data. This is the system's heartbeat:
// if it's old, the dashboard you're looking at is stale. Surfaced in the ribbon.
export async function getLastSync(): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("activity")
    .select("at")
    .eq("kind", "sync_run")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.at ?? null;
}

// ---------- LLS (Liquid Lending Solutions) ----------

// Newest fund snapshot = current state.
export async function getLlsSnapshot(): Promise<LlsSnapshot | null> {
  const { data } = await supabaseAdmin()
    .from("lls_snapshot")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getLlsLoans(
  type?: "active" | "pipeline"
): Promise<LlsLoan[]> {
  let q = supabaseAdmin().from("lls_loans").select("*");
  if (type) q = q.eq("loan_type", type);
  const { data } = await q.order("payoff_date", {
    ascending: true,
    nullsFirst: false,
  });
  return data ?? [];
}

export async function getLlsInbox(): Promise<LlsInboxItem[]> {
  const { data } = await supabaseAdmin()
    .from("lls_inbox")
    .select("*")
    .order("priority", { ascending: false })
    .order("received_at", { ascending: false });
  return data ?? [];
}

// Comments for the loans referenced by inbox items, grouped by loan id.
export async function getLlsCommentsByLoan(
  loanIds: string[]
): Promise<Record<string, LlsLoanComment[]>> {
  const ids = loanIds.filter(Boolean);
  if (!ids.length) return {};
  const { data } = await supabaseAdmin()
    .from("lls_loan_comments")
    .select("*")
    .in("loan_id", ids)
    .order("created_at", { ascending: false });
  const out: Record<string, LlsLoanComment[]> = {};
  for (const c of data ?? []) (out[c.loan_id] ??= []).push(c as LlsLoanComment);
  return out;
}

export async function getLlsReports(limit = 12): Promise<LlsReport[]> {
  const { data } = await supabaseAdmin()
    .from("lls_reports")
    .select("*")
    .order("period", { ascending: false })
    .limit(limit);
  return data ?? [];
}
