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

export interface EmailBrief {
  id: string;
  person_name: string;
  person_email: string;
  mailbox: string;
  thread_count: number;
  latest_at: string | null;
  summary: string;
  takeaways: string[];
  action_items: ActionItem[];
  subjects: string[];
  created_at: string;
  updated_at: string;
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
