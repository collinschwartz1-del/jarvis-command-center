"use server";

import { revalidatePath } from "next/cache";
import { supabaseDeal } from "@/lib/supabase-deal";
import { currentRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { devOwnerEmail } from "@/lib/roles";

export type Disposition =
  | "reached"
  | "interested"
  | "voicemail"
  | "callback"
  | "not_selling"
  | "dnc";

// How each disposition moves the lead's status. null = leave unchanged
// (a voicemail keeps the lead in the queue for a retry).
const STATUS_MAP: Record<Disposition, string | null> = {
  reached: "contacted",
  interested: "qualified", // hot — surfaces for follow-up / handoff
  voicemail: null,
  callback: "contacted",
  not_selling: "passed",
  dnc: "dead",
};

// The sourcing call queue is a shared working surface: owner (Collin),
// caller (VA / Tyler), and viewer (Karen) may all log calls + notes here.
// (Viewers remain read-only everywhere else.)
async function requireDeskAccess(): Promise<{ ok: boolean; actor: string }> {
  const role = await currentRole();
  if (role !== "owner" && role !== "caller" && role !== "viewer") {
    return { ok: false, actor: "" };
  }
  const dev = devOwnerEmail();
  let email = dev;
  if (!email) {
    const { data } = await (await supabaseServer()).auth.getUser();
    email = data.user?.email ?? role;
  }
  return { ok: true, actor: email ?? role ?? "user" };
}

export async function dispositionLead(input: {
  leadId: number;
  // The property's phone contacts. DNC flags all of them; other dispositions
  // act on the lead and ignore this. (contactId kept for back-compat callers.)
  contactIds?: number[];
  contactId?: number;
  disposition: Disposition;
  notes?: string;
}) {
  const { leadId, disposition, notes } = input;
  const contactIds = input.contactIds ?? (input.contactId != null ? [input.contactId] : []);
  const { ok, actor } = await requireDeskAccess();
  if (!ok) return { ok: false, error: "Forbidden" };

  const sb = supabaseDeal();

  const { error: logErr } = await sb.rpc("hub_log_outreach", {
    p_lead_id: leadId,
    p_channel: "call",
    p_detail: { outcome: disposition, notes: notes ?? null },
    p_actor: actor,
    p_set_status: STATUS_MAP[disposition],
  });
  if (logErr) return { ok: false, error: logErr.message };

  // DNC = the owner said stop: flag every number on the property (gate excludes
  // dnc = true) and the lead goes dead (STATUS_MAP), dropping it from the queue.
  if (disposition === "dnc" && contactIds.length) {
    const { error: dncErr } = await sb
      .from("owner_contacts")
      .update({ dnc: true, dnc_checked_at: new Date().toISOString() })
      .in("id", contactIds);
    if (dncErr) return { ok: false, error: dncErr.message };
  }

  revalidatePath("/sourcing");
  return { ok: true };
}

// Free-form commentary on a lead, any time (not tied to a call).
export async function addNote(leadId: number, note: string) {
  if (!note?.trim()) return { ok: false, error: "empty note" };
  const { ok, actor } = await requireDeskAccess();
  if (!ok) return { ok: false, error: "Forbidden" };

  const { error } = await supabaseDeal().from("hub_lead_event").insert({
    lead_id: leadId,
    event_type: "note",
    channel: "note",
    actor,
    detail: { note: note.trim() },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/sourcing");
  return { ok: true };
}

// Full event history for a lead (calls + notes), newest first.
export async function getLeadHistory(leadId: number) {
  const { ok } = await requireDeskAccess();
  if (!ok) return { ok: false, error: "Forbidden", events: [] };
  const { data, error } = await supabaseDeal()
    .from("hub_lead_event")
    .select("id, event_type, channel, actor, detail, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message, events: [] };
  return { ok: true, events: data ?? [] };
}
