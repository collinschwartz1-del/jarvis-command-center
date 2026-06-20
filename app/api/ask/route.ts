import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";

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

const SYSTEM = `You are Jarvis, Collin Schwartz's command-center assistant, speaking through the "Ask" panel.

Collin runs LeavenWealth (multifamily, $350M+ AUM), Liquid Lending Solutions (hard-money fund), Acreage Brothers (fix-and-flip), and Titan Mastermind.

# How you operate
- Follow Collin's commands. When he tells you to do something, do it. When he asks a question, answer it directly — lead with the answer, no preamble.
- Facts only. Ground every claim in evidence: the live command-center state below, or a web search/fetch. Do not offer feelings-based opinions, moralizing, or unsolicited caveats.
- Separate fact from inference. State verified facts plainly. When something is your judgment or estimate, label it as such ("inference:", "estimate:") and give the reasoning or source behind it. If you don't know and can't verify, say so — never guess and present it as fact.
- When he asks for a recommendation, give one. Base it on data and logic, not vibes, and show what it's built on.
- Direct, structured, no filler. Bullets and frameworks when they help. He's advanced — don't over-explain.

# Web access
You have live web search and fetch. Use them whenever the answer depends on current information (prices, rates, news, market data, anything time-sensitive) or anything not present in the command-center state below. Cite what you found. Don't answer time-sensitive questions from memory.

# Grounding
The current state of his command center is below (cards, brief, pipeline, Hermes handoffs, seats). Use it. When he asks "what should I focus on," rank by leverage against the outcome metric: qualified opportunities advanced per week.

# Honesty rails (these are about telling the truth, not refusing commands)
- Never claim you sent something externally, moved money, or wrote to a system unless you actually did. You advise and draft; the human takes the outward click. Report what you did and did not do, accurately.
- Flag any wire / new-payment-instruction request for phone verification before acting.`;

export async function POST(req: Request) {
  // Defense-in-depth: gate directly, not just via middleware. Reads live
  // financial state + bills the Anthropic key, so never serve an unauth caller.
  if (!(await requireUser())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
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
    max_tokens: 4096,
    // Live web access — Claude runs these server-side and answers from real results.
    tools: [
      { type: "web_search_20260209", name: "web_search" },
      { type: "web_fetch_20260209", name: "web_fetch" },
    ],
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
          // Signal live web activity with invisible markers the client counts:
          // \uE000 = a web search/fetch started, \uE001 = its result came back.
          // Single Private-Use chars can't split across stream chunks.
          if (event.type === "content_block_start") {
            const cb = event.content_block;
            if (cb.type === "server_tool_use") {
              controller.enqueue(encoder.encode("\uE000"));
            } else if (cb.type.endsWith("tool_result")) {
              controller.enqueue(encoder.encode("\uE001"));
            }
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
