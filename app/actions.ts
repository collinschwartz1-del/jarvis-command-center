"use server";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { gmailToken, writeGmailDraft, getThreadState } from "@/lib/gmail";
import { normalizeActionItems } from "@/lib/queries";
import { actionSignature, isWireItem } from "@/lib/inbox-rules.mjs";
import { recordDraftFeedback } from "@/lib/draft-control.mjs";
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

// Hand an item off to Sue / Karen / a VA. Records a tracked handoff (surfaces in
// /bridge as the "awaiting" lane) and moves the source item OUT of Collin's
// active queue so it doesn't keep pinging him — it's someone else's ball now.
export type DelegateDomain = "card" | "reply" | "borrower";

export async function delegate(input: {
  domain: DelegateDomain;
  refId: string;
  title: string;
  assignee: string;
  note?: string;
}) {
  await requireOwner();
  const db = supabaseAdmin();
  const ask = input.note?.trim()
    ? `${input.title} — ${input.note.trim()}`
    : input.title;

  // 1. the tracked handoff (the awaiting lane on /bridge)
  await db.from("handoffs").insert({
    packet_id: `dlg-${randomUUID()}`,
    direction: "from_jarvis",
    from_party: "collin",
    to_party: input.assignee,
    ask,
    status: "pending",
    card_id: input.domain === "card" ? input.refId : null,
  });

  // 2. move the source out of Collin's active queue
  if (input.domain === "card") {
    await db.from("cards").update({ status: "review" }).eq("id", input.refId);
  } else if (input.domain === "reply") {
    await db.from("email_drafts").update({ status: "delegated" }).eq("id", input.refId);
  } else {
    await db
      .from("lls_inbox")
      .update({ handled: true })
      .eq("gmail_message_id", input.refId);
  }

  // 3. log it
  const refTable =
    input.domain === "card"
      ? "cards"
      : input.domain === "reply"
        ? "email_drafts"
        : "lls_inbox";
  await db.from("activity").insert({
    actor: "collin",
    kind: "delegated",
    ref_table: refTable,
    ref_id: input.refId,
    summary: `Delegated to ${input.assignee}: ${input.title}`,
  });

  revalidatePath("/");
  revalidatePath("/bridge");
  revalidatePath(
    input.domain === "card"
      ? "/projects"
      : input.domain === "reply"
        ? "/replies"
        : "/lending"
  );
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

  // Learning signal: did Collin keep the draft as-is, or rewrite it? An edit is
  // the most valuable signal — draft_body vs edited_body is a correction the next
  // run learns from. (see scripts/draft-replies.mjs loadFeedbackMemory)
  const original = (picked?.body ?? row.draft_body ?? "").trim();
  const wasEdited = !!editedBody && body !== original;
  await recordDraftFeedback(db, {
    draft_id: draftId,
    thread_id: row.gmail_thread_id,
    person_email: row.person_email,
    subject: row.subject,
    draft_body: original,
    edited_body: wasEdited ? body : null,
    signal: wasEdited ? "edited" : "approved",
    reason: wasEdited ? "Collin rewrote before staging" : "staged as-is",
  });

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
    .select("person_name, person_email, subject, gmail_thread_id, draft_body")
    .eq("id", draftId)
    .maybeSingle();
  await db.from("email_drafts").update({ status: "dismissed" }).eq("id", draftId);

  // Learning signal: Collin threw this draft away — a negative example the next
  // run weights against (don't draft this kind again). See draft_feedback.
  await recordDraftFeedback(db, {
    draft_id: draftId,
    thread_id: row?.gmail_thread_id,
    person_email: row?.person_email,
    subject: row?.subject,
    draft_body: row?.draft_body,
    edited_body: null,
    signal: "dismissed",
    reason: "dismissed from /replies",
  });

  await db.from("activity").insert({
    actor: "collin",
    kind: "reply_dismissed",
    ref_table: "email_drafts",
    ref_id: draftId,
    summary: `Dismissed reply to ${row?.person_name ?? row?.person_email ?? draftId}`,
  });
  revalidatePath("/replies");
}

// Toggle a single email action item's done state. Uses normalizeActionItems so a
// legacy string item can't crash it (the old "Cannot create property 'done' on
// string" 500).
export async function toggleActionItem(briefId: string, index: number) {
  await requireOwner();
  const db = supabaseAdmin();
  const { data } = await db
    .from("email_briefs")
    .select("action_items")
    .eq("id", briefId)
    .maybeSingle();
  const items = normalizeActionItems(data?.action_items);
  if (!items[index]) return;
  items[index].done = !items[index].done;
  await db.from("email_briefs").update({ action_items: items }).eq("id", briefId);
  revalidatePath("/inbox");
}

// ---------- Two-way reconciliation: read live mailbox state ----------
// The dashboard was a one-way snapshot — reply in Gmail and it kept nagging.
// This reads each open draft's Gmail thread: if Collin already SENT a reply
// there (outside the app), the open draft is cleared and logged, so it stops
// showing as a decision on /replies and the Core spine. "responded" drops out of
// getPendingReplies (pending/held only).
export async function reconcileReplies(): Promise<{
  checked: number;
  cleared: number;
  followups: number;
  error?: string;
}> {
  await requireOwner();
  const db = supabaseAdmin();
  const token = await gmailToken();
  if (!token) return { checked: 0, cleared: 0, followups: 0, error: "Gmail not configured." };

  const { data: drafts } = await db
    .from("email_drafts")
    .select("id, gmail_thread_id, person_name, created_at")
    .in("status", ["pending", "held"]);

  // count distinct threads, not rows (a thread can have several draft rows)
  const checkedThreads = new Set<string>();
  const clearedThreads = new Set<string>();
  const followupThreads = new Set<string>();
  for (const d of drafts ?? []) {
    if (!d.gmail_thread_id) continue;
    checkedThreads.add(d.gmail_thread_id);
    let st;
    try {
      st = await getThreadState(token, d.gmail_thread_id);
    } catch {
      continue;
    }
    if (!st) continue;
    const createdMs = new Date(d.created_at).getTime();
    // Collin SENT in this thread after we drafted → he already replied in Gmail.
    if (st.lastSentAt && st.lastSentAt > createdMs) {
      await db.from("email_drafts").update({ status: "responded" }).eq("id", d.id);
      if (!clearedThreads.has(d.gmail_thread_id)) {
        await db.from("activity").insert({
          actor: "collin",
          kind: "reply_detected",
          ref_table: "email_drafts",
          ref_id: d.id,
          summary: `Detected your reply to ${d.person_name} in Gmail — cleared the open draft`,
        });
      }
      clearedThreads.add(d.gmail_thread_id);
    } else if (st.lastInboundAt && st.lastInboundAt > createdMs) {
      followupThreads.add(d.gmail_thread_id);
    }
  }
  if (clearedThreads.size) {
    revalidatePath("/replies");
    revalidatePath("/");
  }
  return {
    checked: checkedThreads.size,
    cleared: clearedThreads.size,
    followups: followupThreads.size,
  };
}

// ---------- Inbox → action (the chief-of-staff layer) ----------
// Each captured email item becomes a tracked card so it flows into the spine /
// Projects and can then be approved, delegated, or bundled. Every action logs a
// structured `activity` row (kind + person in the summary) so trends — who/what
// generates the most work — become derivable over time.

const INBOX_SEAT = "correspondence"; // the email/comms agent seat (FK-valid)

async function readBrief(briefId: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("email_briefs")
    .select("person_name, person_email, action_items")
    .eq("id", briefId)
    .maybeSingle();
  return data
    ? {
        person_name: data.person_name as string,
        person_email: data.person_email as string,
        items: normalizeActionItems(data.action_items),
      }
    : null;
}

async function setItemsDone(briefId: string, indexes: number[]) {
  const db = supabaseAdmin();
  const brief = await readBrief(briefId);
  if (!brief) return;
  for (const i of indexes) if (brief.items[i]) brief.items[i].done = true;
  await db
    .from("email_briefs")
    .update({ action_items: brief.items })
    .eq("id", briefId);
}

// Promote one inbox action item to a pending card.
export async function captureActionItem(briefId: string, index: number) {
  await requireOwner();
  const db = supabaseAdmin();
  const brief = await readBrief(briefId);
  const item = brief?.items[index];
  if (!brief || !item) return;

  const id = `inbox-${randomUUID().slice(0, 8)}`;
  await db.from("cards").insert({
    id,
    title: item.text.slice(0, 120),
    seat: INBOX_SEAT,
    tier: "2",
    status: "pending",
    why: `Captured from ${brief.person_name}'s email`,
    body: `From ${brief.person_name} <${brief.person_email}>\n\n${item.text}`,
  });
  await setItemsDone(briefId, [index]);
  await db.from("activity").insert({
    actor: "collin",
    kind: "inbox_captured",
    ref_table: "cards",
    ref_id: id,
    summary: `Captured from ${brief.person_name}: ${item.text.slice(0, 80)}`,
  });
  revalidatePath("/inbox");
  revalidatePath("/projects");
  revalidatePath("/");
}

// Bundle several inbox items (from one person) into a single project card.
export async function combineIntoProject(
  briefId: string,
  indexes: number[],
  title: string
) {
  await requireOwner();
  const db = supabaseAdmin();
  const brief = await readBrief(briefId);
  if (!brief) return;
  const chosen = indexes
    .map((i) => brief.items[i]?.text)
    .filter((t): t is string => !!t);
  if (!chosen.length) return;

  const id = `proj-${randomUUID().slice(0, 8)}`;
  const name = (title.trim() || `${brief.person_name}: project`).slice(0, 120);
  const body =
    `Project bundled from ${brief.person_name}'s email (${chosen.length} items):\n\n` +
    chosen.map((t) => `- [ ] ${t}`).join("\n");
  await db.from("cards").insert({
    id,
    title: name,
    seat: INBOX_SEAT,
    tier: "2",
    status: "pending",
    why: `Bundled ${chosen.length} items from ${brief.person_name}'s email`,
    body,
  });
  await setItemsDone(briefId, indexes);
  await db.from("activity").insert({
    actor: "collin",
    kind: "inbox_project_created",
    ref_table: "cards",
    ref_id: id,
    summary: `Project "${name}" from ${chosen.length} ${brief.person_name} items`,
  });
  revalidatePath("/inbox");
  revalidatePath("/projects");
  revalidatePath("/");
}

// Acknowledge an item without making a card (clears it, logs the signal) AND
// remembers it so the next intel cron can't re-raise it. This is the fix for the
// Kathleen-Miller re-nag: dismissing a WIRE-VERIFY here records a 'wire'
// suppression for that person, so any future wire flag from them stays dead.
export async function dismissActionItem(briefId: string, index: number) {
  await requireOwner();
  const db = supabaseAdmin();
  const brief = await readBrief(briefId);
  const item = brief?.items[index];
  if (!brief || !item) return;
  await setItemsDone(briefId, [index]);

  // Persistent "I already handled this" memory.
  const wire = isWireItem(item.text);
  await db.from("inbox_suppressions").upsert(
    {
      person_email: brief.person_email.toLowerCase(),
      signature: wire ? "wire" : actionSignature(item.text),
      kind: wire ? "wire" : "action",
      reason: `dismissed from ${brief.person_name}`,
    },
    { onConflict: "person_email,signature" }
  );

  await db.from("activity").insert({
    actor: "collin",
    kind: "inbox_dismissed",
    ref_table: "email_briefs",
    ref_id: briefId,
    summary: `Cleared${wire ? " (wire flag silenced)" : ""} from ${brief.person_name}: ${item.text.slice(0, 60)}`,
  });
  revalidatePath("/inbox");
}
