import { supabaseAdmin } from "./supabase";
import type {
  Agent,
  Card,
  Briefing,
  Deal,
  Handoff,
  Metric,
  Activity,
  EmailBrief,
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

export async function getEmailBriefs(): Promise<EmailBrief[]> {
  const { data } = await supabaseAdmin()
    .from("email_briefs")
    .select("*")
    .order("latest_at", { ascending: false });
  // action_items is a JSONB column and can come back null; normalize to an
  // array so every render site (.filter/.map/.length) is safe.
  return (data ?? []).map((b) => ({
    ...b,
    action_items: Array.isArray(b.action_items) ? b.action_items : [],
  }));
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
