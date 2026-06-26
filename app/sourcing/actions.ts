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

  // Record the flagged contacts on a DNC event so it can be undone cleanly later.
  const detail: Record<string, unknown> = { outcome: disposition, notes: notes ?? null };
  if (disposition === "dnc" && contactIds.length) detail.contact_ids = contactIds;

  const { error: logErr } = await sb.rpc("hub_log_outreach", {
    p_lead_id: leadId,
    p_channel: "call",
    p_detail: detail,
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

// Undo a logged entry (mis-click or wrong disposition). The entry is NOT deleted
// — it's VOIDED (kept in the history for audit, struck through) and its effect is
// REPAIRED: the lead's status is re-derived from whatever live events remain, and
// (for a DNC) the phone numbers are un-flagged so the lead returns to the queue.
// Reversible because dispositionLead stamps the flagged contact_ids onto the DNC
// event.
export async function undoLeadEvent(eventId: number) {
  const { ok, actor } = await requireDeskAccess();
  if (!ok) return { ok: false, error: "Forbidden" };
  const sb = supabaseDeal();

  // 1) load the event so we know the lead + what to repair
  const { data: ev, error: getErr } = await sb
    .from("hub_lead_event")
    .select("id, lead_id, event_type, detail, voided_at")
    .eq("id", eventId)
    .single();
  if (getErr || !ev) return { ok: false, error: getErr?.message ?? "entry not found" };
  if (ev.voided_at) return { ok: true }; // already voided — no-op
  const detail = (ev.detail ?? {}) as Record<string, unknown>;
  const outcome = detail.outcome as string | undefined;

  // 2) mark it voided (audit trail preserved — the row stays)
  const { error: voidErr } = await sb
    .from("hub_lead_event")
    .update({ voided_at: new Date().toISOString(), voided_by: actor })
    .eq("id", eventId);
  if (voidErr) return { ok: false, error: voidErr.message };

  // 3) DNC reversal — bring the flagged numbers back into the callable queue
  if (outcome === "dnc") {
    const ids = (detail.contact_ids as number[] | undefined) ?? [];
    if (ids.length) {
      await sb.from("owner_contacts").update({ dnc: false, dnc_checked_at: null }).in("id", ids);
    }
  }

  // 4) re-derive the lead's status from the remaining LIVE (non-voided) call
  //    events (most recent meaningful disposition wins; nothing left → "new").
  if (outcome && outcome in STATUS_MAP) {
    const { data: rest } = await sb
      .from("hub_lead_event")
      .select("detail, created_at, voided_at")
      .eq("lead_id", ev.lead_id)
      .is("voided_at", null)
      .order("created_at", { ascending: false });
    let next = "new";
    for (const r of rest ?? []) {
      const o = (r.detail as Record<string, unknown> | null)?.outcome as string | undefined;
      const mapped = o ? STATUS_MAP[o as Disposition] : undefined;
      if (mapped) { next = mapped; break; }
    }
    await sb.from("hub_lead").update({ status: next }).eq("id", ev.lead_id);
  }

  revalidatePath("/sourcing");
  revalidatePath("/sourcing/log");
  return { ok: true };
}

// Full event history for a lead (calls + notes), newest first.
export async function getLeadHistory(leadId: number) {
  const { ok } = await requireDeskAccess();
  if (!ok) return { ok: false, error: "Forbidden", events: [] };
  const { data, error } = await supabaseDeal()
    .from("hub_lead_event")
    .select("id, event_type, channel, actor, detail, created_at, voided_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message, events: [] };
  return { ok: true, events: data ?? [] };
}
