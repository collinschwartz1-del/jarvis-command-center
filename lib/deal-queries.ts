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

export async function getCallQueue(limit = 400): Promise<CallRow[]> {
  if (!dealConfigured()) return [];
  const { data, error } = await supabaseDeal()
    .from("v_call_queue")
    .select("*")
    .limit(limit);
  if (error) {
    console.error("getCallQueue:", error.message);
    return [];
  }
  return (data ?? []) as CallRow[];
}

// Leads for one deal-type track (source), highest score first. The daily brief
// is PostgREST-capped at ~1k rows, so each track gets its own bounded query.
export async function getLeadsBySource(source: string, limit = 300): Promise<BriefLead[]> {
  if (!dealConfigured()) return [];
  const { data, error } = await supabaseDeal()
    .from("v_daily_brief")
    .select("*")
    .eq("source", source)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.error("getLeadsBySource:", error.message);
    return [];
  }
  return (data ?? []) as BriefLead[];
}

export async function getLeadCountBySource(source: string): Promise<number> {
  if (!dealConfigured()) return 0;
  const { count, error } = await supabaseDeal()
    .from("v_daily_brief")
    .select("*", { count: "exact", head: true })
    .eq("source", source);
  if (error) {
    console.error("getLeadCountBySource:", error.message);
    return 0;
  }
  return count ?? 0;
}

// ---- Dialing activity (the output side: is the queue being worked?) --------
// Call dispositions land in hub_lead_event as event_type='outreach',
// channel='call', detail.outcome = the disposition, actor = who dialed.
export type DialStats = {
  today: {
    calls: number;
    contacts: number; // reached + interested (a live conversation)
    interested: number; // the hot ones
    voicemail: number;
    callback: number;
    notSelling: number;
    dnc: number;
  };
  week: { calls: number; contacts: number; interested: number };
  byCaller: { actor: string; calls: number }[]; // today, busiest first
};

const CONTACT_OUTCOMES = new Set(["reached", "interested"]);

// Day bucket in Central time, so "today" matches Omaha calling hours.
function chicagoDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function getDialStats(): Promise<DialStats> {
  const empty: DialStats = {
    today: { calls: 0, contacts: 0, interested: 0, voicemail: 0, callback: 0, notSelling: 0, dnc: 0 },
    week: { calls: 0, contacts: 0, interested: 0 },
    byCaller: [],
  };
  if (!dealConfigured()) return empty;

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabaseDeal()
    .from("hub_lead_event")
    .select("detail, actor, created_at")
    .eq("event_type", "outreach")
    .eq("channel", "call")
    .gte("created_at", since)
    .limit(20000);
  if (error) {
    console.error("getDialStats:", error.message);
    return empty;
  }

  const todayStr = chicagoDay(new Date());
  const today = { ...empty.today };
  const week = { ...empty.week };
  const callers = new Map<string, number>();

  for (const r of (data ?? []) as { detail: Record<string, unknown> | null; actor: string | null; created_at: string }[]) {
    const outcome = String(r.detail?.outcome ?? "");
    const isContact = CONTACT_OUTCOMES.has(outcome);
    const isInterested = outcome === "interested";

    week.calls++;
    if (isContact) week.contacts++;
    if (isInterested) week.interested++;

    if (chicagoDay(new Date(r.created_at)) === todayStr) {
      today.calls++;
      if (isContact) today.contacts++;
      if (isInterested) today.interested++;
      if (outcome === "voicemail") today.voicemail++;
      if (outcome === "callback") today.callback++;
      if (outcome === "not_selling") today.notSelling++;
      if (outcome === "dnc") today.dnc++;
      const actor = (r.actor ?? "—").split("@")[0];
      callers.set(actor, (callers.get(actor) ?? 0) + 1);
    }
  }

  const byCaller = [...callers.entries()]
    .map(([actor, calls]) => ({ actor, calls }))
    .sort((a, b) => b.calls - a.calls);

  return { today, week, byCaller };
}

// True total of callable rows (the queue view is capped for rendering).
export async function getCallQueueCount(): Promise<number> {
  if (!dealConfigured()) return 0;
  const { count, error } = await supabaseDeal()
    .from("v_call_queue")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("getCallQueueCount:", error.message);
    return 0;
  }
  return count ?? 0;
}
