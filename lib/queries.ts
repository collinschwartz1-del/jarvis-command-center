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
  return data ?? [];
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
