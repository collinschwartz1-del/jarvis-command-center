"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

// Approve or dismiss an AI-operator proposal. This is the human-in-the-loop gate —
// nothing the operators propose takes effect until a human acts here.
export async function resolveActionItem(id: string, state: "approved" | "dismissed" | "actioned") {
  const user = await requireUser();
  if (!user) throw new Error("Forbidden");
  const { error } = await supabaseAdmin()
    .schema("brain")
    .from("action_items")
    .update({ approval_state: state, approved_by: user.email ?? "owner", approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/business-brain");
}
