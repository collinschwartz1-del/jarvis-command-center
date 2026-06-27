import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { searchComms } from "@/lib/brain-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ask a natural-language question; answered ONLY from the retrieved Business Brain emails.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { question, business } = await req.json().catch(() => ({}));
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "missing question" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "missing ANTHROPIC_API_KEY" }, { status: 500 });

  const biz = business && business !== "All" ? business : null;
  let hits;
  try {
    hits = await searchComms(question, biz, 40);
  } catch (e) {
    return NextResponse.json({ error: "search failed: " + (e as Error).message }, { status: 500 });
  }

  const context = hits
    .map(
      (h, i) =>
        `[${i + 1}] (${h.business ?? "?"} · ${h.occurred_at ? new Date(h.occurred_at).toISOString().slice(0, 10) : "?"}) ${h.subject ?? "(no subject)"}\n     ${h.snippet ?? ""}`
    )
    .join("\n");

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system:
      `You answer questions about Collin Schwartz's businesses using ONLY the retrieved emails below, drawn from his Business Brain ` +
      `(~29k emails across LeavenWealth multifamily syndication, Liquid Lending hard-money fund, Acreage Brothers flips, Titan Mastermind, MASC Investments). ` +
      `Ground every claim in the emails and cite the [number] of the source(s) you used. If the emails don't contain the answer, say so plainly — never invent. ` +
      `Be concise and direct, senior-operator tone.\n\n# RETRIEVED EMAILS\n${context || "(no matching emails found)"}`,
    messages: [{ role: "user", content: question }],
  });

  const answer = msg.content.find((c) => c.type === "text")?.text ?? "";
  return NextResponse.json({ answer, sources: hits.slice(0, 12) });
}
