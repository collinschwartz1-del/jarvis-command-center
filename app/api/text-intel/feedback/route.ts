import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireOwner } from "@/lib/auth";

// Appends a feedback event to the local vault — seeds the self-learning loop.
// Local-only: writes to ~/text-intel-vault/feedback.jsonl, never to cloud.
export async function POST(req: NextRequest) {
  try {
    await requireOwner();
    const body = await req.json();
    const entry = {
      ts: new Date().toISOString(),
      thread: String(body.thread ?? ""),
      category: String(body.category ?? ""),
      priority: String(body.priority ?? ""),
      action: body.action === "dismiss" ? "dismiss" : "approve",
    };
    const file = path.join(os.homedir(), "text-intel-vault", "feedback.jsonl");
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
