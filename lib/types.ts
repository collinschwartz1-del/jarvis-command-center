// Types mirror the Supabase schema (migration 0001).

export type SeatKind = "structural" | "domain";
export type CardTier = "1" | "2" | "3";
export type CardStatus =
  | "pending"
  | "approved"
  | "review"
  | "done"
  | "dismissed"
  | "archived";
export type HandoffDir = "to_jarvis" | "from_jarvis";
export type HandoffStatus =
  | "pending"
  | "in_flight"
  | "delivered"
  | "done"
  | "archived";
export type DealKind =
  | "flip"
  | "multifamily"
  | "service_business"
  | "investor"
  | "titan"
  | "other";

export interface Agent {
  id: string;
  name: string;
  kind: SeatKind;
  job: string;
  online: boolean;
  last_run_at: string | null;
  last_summary: string | null;
  created_at: string;
}

export interface Card {
  id: string;
  title: string;
  seat: string;
  tier: CardTier;
  status: CardStatus;
  why: string;
  action: string | null;
  result: string | null;
  body: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Briefing {
  id: string;
  brief_date: string;
  content: string;
  delivered_at: string | null;
  created_at: string;
}

export interface Deal {
  id: string;
  name: string;
  kind: DealKind;
  stage: string;
  value: number | null;
  source: string | null;
  card_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Handoff {
  id: string;
  packet_id: string;
  direction: HandoffDir;
  from_party: string;
  to_party: string;
  ask: string;
  status: HandoffStatus;
  file_path: string | null;
  card_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Metric {
  id: string;
  metric_date: string;
  wakes: number;
  workflows: number;
  spend_usd: number;
  agents_online: number;
  created_at: string;
}

export interface ActionItem {
  text: string;
  done: boolean;
}

// The triage bucket — what Collin needs to do. Drives the /inbox grouping.
export type InboxCategory = "sign" | "question" | "awaiting" | "fyi";

export interface EmailBrief {
  id: string;
  person_name: string;
  person_email: string;
  mailbox: string;
  thread_count: number;
  latest_at: string | null;
  category: InboxCategory;
  summary: string;
  takeaways: string[];
  action_items: ActionItem[];
  subjects: string[];
  created_at: string;
  updated_at: string;
}

// One machine-noise message Jarvis suppressed from the Inbox this window. Audit
// only — muting never touches Gmail. Powers the "N muted" counter on /inbox.
export interface InboxMuted {
  id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  reason: string | null; // sender:<x> | pattern:<x>
  muted_at: string;
}

// One prepopulated reply option. Single-reply threads have exactly one variant;
// decision threads (yes/no, and/or) have 2-3, each Sue-reviewed independently.
export interface DraftVariant {
  label: string; // e.g. "Reply", "Yes / accept", "No / decline", "Option A"
  body: string; // the full reply in Collin's voice
  verdict: "approve" | "hold";
  note: string | null; // Sue's reasoning when held
}

export type DraftStatus =
  | "pending" // >=1 variant cleared Sue; awaiting Collin's pick in /replies
  | "approved" // Collin picked one; Gmail draft written on the thread
  | "held" // Sue held every variant
  | "excluded" // scope gate excluded the thread
  | "dismissed"; // Collin dismissed it

export interface EmailDraft {
  id: string;
  gmail_thread_id: string | null;
  gmail_msg_id: string | null;
  gmail_draft_id: string | null;
  person_name: string;
  person_email: string;
  subject: string;
  category: string; // reply | no-reply-needed (legacy: routine | excluded)
  excluded_reason: string | null; // caution reason when sensitive
  sensitivity: "normal" | "sensitive";
  reply_kind: "single" | "decision";
  variants: DraftVariant[];
  chosen_index: number | null;
  original_snippet: string | null;
  draft_body: string | null; // legacy single-draft body / chosen body on approve
  sue_verdict: string;
  sue_note: string | null;
  status: string; // DraftStatus, plus legacy drafted/written/sent
  written_at: string | null;
  created_at: string;
}

export interface FitRow {
  metric: string;
  deal: string;
  target: string;
  note: string;
}

export interface DealAnalysis {
  id: string;
  deal_name: string;
  address: string | null;
  asset_type: string; // multifamily | flip | unknown
  source: string | null;
  units: number | null;
  price: number | null;
  price_per_unit: number | null;
  in_place_cap: number | null;
  expense_ratio: number | null;
  econ_occupancy: number | null;
  fit_score: number | null;
  verdict: string | null;
  snapshot: string | null;
  fit_table: FitRow[];
  red_flags: string[];
  questions: string[];
  docs_status: string | null;
  output_md: string | null;
  routed_to: string | null;
  person_email: string | null;
  created_at: string;
}

export interface Property {
  id: string;
  folio_company: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  status: string | null;
  units: number | null;
  as_of_date: string | null;
  occupancy: number | null;
  gross_potential_rent: number | null;
  actual_revenue: number | null;
  operating_expenses: number | null;
  noi: number | null;
  debt_service: number | null;
  cash_flow: number | null;
  market_value: number | null;
  loan_balance: number | null;
  equity: number | null;
  cap_rate: number | null;
  dscr: number | null;
  ownership_pct: number | null;
  notes: string | null;
  source: string;
  raw: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioSummary {
  folio_company: string;
  property_count: number;
  total_units: number;
  avg_occupancy: number | null;
  total_value: number | null;
  total_debt: number | null;
  total_equity: number | null;
  total_noi: number | null;
  total_cash_flow: number | null;
  portfolio_cap_rate: number | null;
  latest_as_of: string | null;
}

export interface Activity {
  id: string;
  at: string;
  actor: string | null;
  kind: string;
  ref_table: string | null;
  ref_id: string | null;
  summary: string;
}

// ---------- LLS (Liquid Lending Solutions) — migration 0002 ----------

// Full Lendr dashboard-stats payload kept on lls_snapshot.raw. Typed loosely
// (Record) for the bits we render directly; the API returns far more.
export interface LlsRawStats {
  pipeline_value?: {
    total_value: number;
    loan_count: number;
    breakdown: {
      name: string;
      slug: string;
      color: string;
      total_value: string;
      loan_count: number;
    }[];
  };
  pipeline_vs_payoffs?: {
    inflow_total: number;
    inflow_count: number;
    outflow_total: number;
    outflow_count: number;
    net: number;
    timeline: {
      loan_id: number;
      date_iso: string;
      date_label: string;
      address: string;
      city: string;
      state: string;
      type: "payoff" | "origination";
      stage: string | null;
      amount: number;
      signed_amount: number;
    }[];
    window_start?: string;
    window_end?: string;
  };
  concentration_risk?: {
    first_name: string;
    last_name: string;
    total_amount: string;
    percentage: number;
  }[];
  lender_earnings?: Record<
    string,
    { year: number; month: number; earned: number; projected: number }
  >;
  portfolio_arltv?: number | null;
  past_maturity?: { count: number; total: number };
  computed_at?: string;
  [key: string]: unknown;
}

export interface LlsSnapshot {
  id: string;
  captured_at: string;
  available_capital: number | null;
  outstanding_capital: number | null;
  total_capital: number | null;
  aged_receivables: number | null;
  portfolio_ltv: number | null;
  avg_monthly_interest: number | null;
  unique_borrowers: number | null;
  active_loan_count: number | null;
  pipeline_value: number | null;
  pipeline_count: number | null;
  payoffs_30d_total: number | null;
  payoffs_30d_count: number | null;
  originations_30d_total: number | null;
  originations_30d_count: number | null;
  raw: LlsRawStats;
  created_at: string;
}

export interface LlsLoan {
  lendr_id: string;
  borrower_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  amount: number | null;
  outstanding_principal: number | null;
  status: string | null;
  stage: string | null;
  lien_position: string | null;
  property_type: string | null;
  rate: number | null;
  origination_date: string | null;
  payoff_date: string | null;
  loan_type: "active" | "pipeline";
  updated_at: string;
}

export interface LlsLoanComment {
  lendr_comment_id: string;
  loan_id: string;
  author: string | null;
  body: string;
  created_at: string;
  synced_at: string;
}

export interface LlsInboxItem {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  received_at: string | null;
  category: string | null;
  request_summary: string | null;
  priority: number;
  matched_loan_id: string | null;
  handled: boolean;
  updated_at: string;
}

export interface LlsReport {
  period: string;
  drive_file_id: string | null;
  web_view_link: string | null;
  title: string | null;
  generated_at: string;
}

// ---- PGO (Point Guard Omaha) property-management dashboard ----
// Sourced from the live Buildium export in BigQuery, cached by scripts/pgo-sync.mjs.

export interface PgoTrendPoint {
  month: string; // 'YYYY-MM'
  income: number;
  expense: number;
  noi: number;
}

export interface PgoPropertyDetail {
  property_id: number;
  property_name: string | null;
  income: number;
  expense: number;
  noi: number;
  ar_total: number;
  ar_over_90: number;
  evictions_pending: number;
  units_delinquent: number;
}

export interface PgoTrends {
  noi_latest: number;
  noi_mom_pct: number | null;
  noi_vs_avg3_pct: number | null;
  noi_direction: "up" | "down" | "flat";
  opex_ratio: number | null;
  opex_ratio_3mo: number | null;
  opex_ratio_trend: "rising" | "easing" | "flat";
  ar_now: number;
  ar_wow: number | null;
  ar_pct_income: number | null;
}

export interface PgoScoredItem {
  property_id: number;
  name: string;
  score: number;
  noi: number;
  margin: number | null;
  ar_total: number;
  streak: number;
  reasons: string[];
  momNoi: number | null;
  newlyNegative?: boolean;
}

export interface PgoDueOut {
  kind: "eviction" | "delinquency" | "noi" | "expense";
  priority: number;
  text: string;
}

export interface PgoAnalysis {
  generated_for: string;
  trends: PgoTrends;
  focus: PgoScoredItem[];
  watch: PgoScoredItem[];
  wins: PgoScoredItem[];
  dueOuts: PgoDueOut[];
  counts: { focus: number; watch: number; dueOuts: number };
}

export interface PgoSnapshotRaw {
  trend: PgoTrendPoint[];
  properties: PgoPropertyDetail[];
  recurring_charges_available: boolean;
  analysis?: PgoAnalysis | null;
}

export interface PgoSnapshot {
  id: string;
  captured_at: string;
  period: string;
  property_count: number | null;
  operating_income: number | null;
  operating_expense: number | null;
  noi: number | null;
  noi_prior: number | null;
  ar_total: number | null;
  ar_0_30: number | null;
  ar_31_60: number | null;
  ar_61_90: number | null;
  ar_over_90: number | null;
  evictions_pending: number | null;
  notices_given: number | null;
  delinquency_date: string | null;
  raw: PgoSnapshotRaw;
  created_at: string;
}

export interface PgoProperty {
  property_id: number;
  property_name: string | null;
  period: string | null;
  operating_income: number | null;
  operating_expense: number | null;
  noi: number | null;
  ar_total: number | null;
  ar_over_90: number | null;
  evictions_pending: number | null;
  units_delinquent: number | null;
  updated_at: string;
}

export interface PgoReport {
  period: string;
  drive_file_id: string | null;
  web_view_link: string | null;
  title: string | null;
  generated_at: string;
}
