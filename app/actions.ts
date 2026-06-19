"use server";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { gmailToken, writeGmailDraft } from "@/lib/gmail";
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
  await requireOwner();
  await setCardStatus(id, "approved", "card_approved");
}

export async function dismissCard(id: string) {
  await requireOwner();
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
  await requireOwner();
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

// Approve a prepopulated reply from the /replies queue. Collin picks ONE variant
// (optionally edited inline); we write it as a Gmail DRAFT on the thread — never
// sends — then mark the row approved. Final send stays a human action in Gmail.
export async function approveReply(
  draftId: string,
  chosenIndex: number,
  editedBody?: string
) {
  await requireOwner();
  const db = supabaseAdmin();

  const { data: row } = await db
    .from("email_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (!row) throw new Error("Reply draft not found.");

  const variants = Array.isArray(row.variants) ? row.variants : [];
  const picked = variants[chosenIndex];
  const body = (editedBody ?? picked?.body ?? row.draft_body ?? "").trim();
  if (!body) throw new Error("No reply body to approve.");
  if (!row.gmail_thread_id || !row.person_email) {
    throw new Error("Reply draft is missing the Gmail thread/recipient.");
  }

  const token = await gmailToken();
  if (!token) {
    throw new Error(
      "Gmail isn't connected (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN). Run npm run gmail-auth."
    );
  }
  const gmailDraftId = await writeGmailDraft(
    token,
    {
      thread_id: row.gmail_thread_id,
      to_email: row.person_email,
      subject: row.subject ?? "",
      in_reply_to: row.reply_to_message_id ?? null,
      references: row.reply_references ?? null,
    },
    body
  );

  await db
    .from("email_drafts")
    .update({
      status: "approved",
      chosen_index: chosenIndex,
      draft_body: body,
      gmail_draft_id: gmailDraftId,
      written_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  await db.from("activity").insert({
    actor: "collin",
    kind: "reply_approved",
    ref_table: "email_drafts",
    ref_id: draftId,
    summary: `Reply to ${row.person_name ?? row.person_email} → Gmail draft staged`,
  });

  revalidatePath("/replies");
}

// Dismiss a reply draft from the queue without staging anything.
export async function dismissReply(draftId: string) {
  await requireOwner();
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("email_drafts")
    .select("person_name, person_email")
    .eq("id", draftId)
    .maybeSingle();
  await db.from("email_drafts").update({ status: "dismissed" }).eq("id", draftId);
  await db.from("activity").insert({
    actor: "collin",
    kind: "reply_dismissed",
    ref_table: "email_drafts",
    ref_id: draftId,
    summary: `Dismissed reply to ${row?.person_name ?? row?.person_email ?? draftId}`,
  });
  revalidatePath("/replies");
}

// Toggle a single email action item's done state.
export async function toggleActionItem(briefId: string, index: number) {
  await requireOwner();
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
