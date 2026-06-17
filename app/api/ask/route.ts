import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Build a system prompt grounded in the live state of the command center so
// "Ask" can answer about Collin's actual cards, brief, pipeline, and handoffs.
async function buildContext(): Promise<string> {
  const db = supabaseAdmin();
  const [cards, brief, deals, handoffs, agents] = await Promise.all([
    db.from("cards").select("id,title,seat,tier,status,why,result").order("tier"),
    db.from("briefings").select("content").order("brief_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("deals").select("name,kind,stage,value,source"),
    db.from("handoffs").select("direction,from_party,to_party,ask,status"),
    db.from("agents").select("name,kind,last_summary"),
  ]);

  return [
    "## Today's brief",
    brief.data?.content ?? "(none)",
    "\n## Cards",
    JSON.stringify(cards.data ?? [], null, 0),
    "\n## Deals (pipeline)",
    JSON.stringify(deals.data ?? [], null, 0),
    "\n## Handoffs (Hermes bridge)",
    JSON.stringify(handoffs.data ?? [], null, 0),
    "\n## Agents (seats)",
    JSON.stringify(agents.data ?? [], null, 0),
  ].join("\n");
}

const SYSTEM = `You are Jarvis, Collin Schwartz's autonomous ops / chief-of-staff assistant, speaking through the command-center "Ask" panel.

Collin runs LeavenWealth (multifamily, $350M+ AUM), Liquid Lending Solutions (hard-money fund), Acreage Brothers (fix-and-flip), and Titan Mastermind. Talk to him the way he wants: direct, structured, senior-operator tone, no filler. Lead with the decision. Use bullets and frameworks when useful. He's advanced — don't over-explain.

You have the current state of his command center below (cards, brief, pipeline, Hermes handoffs, seats). Ground your answers in it. When he asks "what should I focus on," rank by leverage against the outcome metric: qualified opportunities advanced per week.

Safety rails are absolute: never claim to have sent anything externally, moved money, or written to a system — you advise and draft only; the human takes every outward click. Flag any wire / new-payment-instruction request for phone verification.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 503 }
    );
  }

  const { messages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  const context = await buildContext();
  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: "# LIVE COMMAND CENTER STATE\n\n" + context },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[error: ${(e as Error).message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
