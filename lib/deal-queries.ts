import { supabaseDeal, dealConfigured } from "./supabase-deal";

// Rows from the spine's v_daily_brief view.
export type BriefLead = {
  lead_id: number;
  source: string;
  display_address: string;
  market: string | null;
  buy_box: string | null;
  rank_label: string | null;
  tier: string | null;
  gate: string | null;
  confidence: string | null;
  score: number | null;
  status: string;
  summary: string | null;
  equity_capture: string | null;
  timing: string | null;
  owner_name: string | null;
  owner_entity_type: string | null;
  owner_absentee: boolean | null;
  acq_mid: string | null;
  emv: string | null;
  ask: string | null;
  arv: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  surfaced_at: string | null;
};

// Rows from the spine's v_call_queue view (DNC-clean callable phones).
export type CallRow = {
  lead_id: number;
  display_address: string;
  source: string;
  rank_label: string | null;
  score: number | null;
  status: string;
  owner_id: number;
  owner_name: string;
  entity_type: string | null;
  contact_id: number;
  phone: string;
  phone_label: string | null;
  litigator: boolean;
  equity_capture: string | null;
  timing: string | null;
};

export async function getDailyBrief(): Promise<BriefLead[]> {
  if (!dealConfigured()) return [];
  const { data, error } = await supabaseDeal()
    .from("v_daily_brief")
    .select("*");
  if (error) {
    console.error("getDailyBrief:", error.message);
    return [];
  }
  return (data ?? []) as BriefLead[];
}

export async function getCallQueue(): Promise<CallRow[]> {
  if (!dealConfigured()) return [];
  const { data, error } = await supabaseDeal()
    .from("v_call_queue")
    .select("*");
  if (error) {
    console.error("getCallQueue:", error.message);
    return [];
  }
  return (data ?? []) as CallRow[];
}
