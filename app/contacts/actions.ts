"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

// Save a relationship note on a contact. Owner-only (viewers are read-only).
// Mirrors the sourcing addNote pattern, but writes to the Jarvis `contacts`
// table (relationship notes), separate from deal/seller notes on the spine.
export async function updateContactNotes(id: string, notes: string) {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Forbidden — read-only access." };
  }
  const { error } = await supabaseAdmin()
    .from("contacts")
    .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  return { ok: true };
}
