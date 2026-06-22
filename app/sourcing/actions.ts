"use server";

import { revalidatePath } from "next/cache";
import { supabaseDeal } from "@/lib/supabase-deal";
import { currentRole } from "@/lib/auth";

export type Disposition =
  | "reached"
  | "voicemail"
  | "callback"
  | "not_selling"
  | "dnc";

// How each disposition moves the lead's status. null = leave unchanged
// (e.g. a voicemail keeps the lead in the queue for a retry).
const STATUS_MAP: Record<Disposition, string | null> = {
  reached: "contacted",
  voicemail: null,
  callback: "contacted",
  not_selling: "passed",
  dnc: "dead",
};

export async function dispositionLead(input: {
  leadId: number;
  contactId: number;
  disposition: Disposition;
  notes?: string;
}) {
  const { leadId, contactId, disposition, notes } = input;

  // Only owner or the dialing caller may log dispositions (viewers can't).
  const role = await currentRole();
  if (role !== "owner" && role !== "caller") {
    return { ok: false, error: "Forbidden" };
  }

  const sb = supabaseDeal();

  // 1) log the outreach attempt + move status
  const { error: logErr } = await sb.rpc("hub_log_outreach", {
    p_lead_id: leadId,
    p_channel: "call",
    p_detail: { outcome: disposition, notes: notes ?? null },
    p_actor: "va",
    p_set_status: STATUS_MAP[disposition],
  });
  if (logErr) return { ok: false, error: logErr.message };

  // 2) DNC removes the phone from the call queue (gate excludes dnc = true)
  if (disposition === "dnc") {
    const { error: dncErr } = await sb
      .from("owner_contacts")
      .update({ dnc: true, dnc_checked_at: new Date().toISOString() })
      .eq("id", contactId);
    if (dncErr) return { ok: false, error: dncErr.message };
  }

  revalidatePath("/sourcing");
  return { ok: true };
}
