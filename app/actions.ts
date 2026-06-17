"use server";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import type { CardStatus } from "@/lib/types";

// Phase 3 + 4 — write card decisions back to BOTH Supabase and the markdown
// file in the Jarvis brain, so the next /board /pickup sees the approval.
async function setCardStatus(id: string, status: CardStatus, kind: string) {
  const db = supabaseAdmin();

  const { data: card } = await db
    .from("cards")
    .select("title, file_path")
    .eq("id", id)
    .maybeSingle();

  await db.from("cards").update({ status }).eq("id", id);

  // write-back to the source markdown file (best-effort; DB is source of truth)
  const jarvisDir = process.env.JARVIS_DIR;
  if (jarvisDir && card?.file_path) {
    const abs = join(jarvisDir, card.file_path);
    try {
      if (existsSync(abs)) {
        const raw = await readFile(abs, "utf8");
        const updated = raw.replace(/^status:.*$/m, `status: ${status}`);
        if (updated !== raw) await writeFile(abs, updated, "utf8");
      }
    } catch (e) {
      console.error(`write-back failed for ${id}:`, e);
    }
  }

  await db.from("activity").insert({
    actor: "collin",
    kind,
    ref_table: "cards",
    ref_id: id,
    summary: `${card?.title ?? id} → ${status}`,
  });

  revalidatePath("/projects");
  revalidatePath("/");
}

export async function approveCard(id: string) {
  await setCardStatus(id, "approved", "card_approved");
}

export async function dismissCard(id: string) {
  await setCardStatus(id, "dismissed", "card_dismissed");
}

// Route a single-family / flip deal to the Flip Tracker app. Records the
// hand-off here (price + address) and logs it; Flip Tracker owns ARV/rehab/margin.
export async function routeToFlipTracker(
  dealName: string,
  address: string,
  price: number | null,
  source?: string
) {
  const db = supabaseAdmin();
  await db.from("deal_analyses").insert({
    deal_name: dealName,
    address,
    asset_type: "flip",
    source: source ?? null,
    price,
    routed_to: "flip-tracker",
    verdict: "Routed to Flip Tracker — ARV, rehab, and margin computed there.",
    docs_status: "Sent price + address to Flip Tracker; awaiting its ARV/rehab analysis.",
  });
  await db.from("activity").insert({
    actor: "underwriter",
    kind: "flip_routed",
    ref_table: "deal_analyses",
    ref_id: dealName,
    summary: `Routed flip ${dealName} (${address}) to Flip Tracker`,
  });
  revalidatePath("/sales");
}

// Toggle a single email action item's done state.
export async function toggleActionItem(briefId: string, index: number) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("email_briefs")
    .select("action_items")
    .eq("id", briefId)
    .maybeSingle();
  const items = (data?.action_items ?? []) as { text: string; done: boolean }[];
  if (!items[index]) return;
  items[index].done = !items[index].done;
  await db.from("email_briefs").update({ action_items: items }).eq("id", briefId);
  revalidatePath("/inbox");
}
