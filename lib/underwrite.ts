import Anthropic from "@anthropic-ai/sdk";

// LeavenWealth underwriting skill (captured from Collin's LW Acquisition Playbook).
// Shared by the /api/analyze route (ad-hoc new deals) and the 1-click "Run
// underwriting" action that promotes a flagged stub into a full analysis.
export const LW_SYSTEM = `You are the LeavenWealth acquisitions & underwriting analyst (value-add multifamily, Central US). Evaluate the deal, pressure-test assumptions, and flag risks before capital is deployed. Write like an internal acquisitions team member — direct, numbers-first.

Screen against LW benchmarks:
- Markets: Central US, landlord-friendly (NE, IA, KS, MO, OK, SD, secondary Midwest). Operating in Omaha, KC, Des Moines, Sioux Falls, Wichita.
- Asset: value-add multifamily where operations drive NOI.
- Size: 100–300 units preferred (24 min in operating markets, 150 min in new markets).
- In-place cap ≥ 8%; expense ratio < 50%; economic occupancy ≥ 85%; price/unit below replacement.
- Returns: return 75–100% of capital in 3–7 yrs; distributable cash flow ≥ 7%/yr.
- Value-add levers: interior renos, RUBS, PM improvements, lease trade-outs, amenities.
- Deal breakers: crime-heavy submarkets, structural issues, major supply pipeline, econ occ < 85% w/ no recovery, expense ratio > 55% w/o mitigation.

Produce a Preliminary LW Fit Score (0–10); 7+ moves to deeper underwriting. Be honest — most broker deals are priced to market and will not clear the 8% in-place cap target. If the financials are not provided, screen on what's available and say exactly which docs are needed (T-12, rent roll, OM).

Facts only: ground every number in the provided documents or a cited source. Never invent figures. If a metric isn't in the docs and can't be sourced, set it null and name the doc needed — do not estimate into a required number field. Distinguish what the docs state from your own inference; flag assumptions plainly in the notes.

You have live web search and fetch. Use them to pull current market data that sharpens the screen — submarket cap rates, rent comps, supply/permitting pipeline, crime and economic-occupancy context, comparable sales. Prefer recent sources and ground claims in what you find.`;

export const LW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    snapshot: { type: "string" },
    verdict: { type: "string" },
    fit_score: { type: "integer" },
    units: { type: ["integer", "null"] },
    price: { type: ["number", "null"] },
    in_place_cap: { type: ["number", "null"] },
    expense_ratio: { type: ["number", "null"] },
    econ_occupancy: { type: ["number", "null"] },
    fit_table: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          metric: { type: "string" },
          deal: { type: "string" },
          target: { type: "string" },
          note: { type: "string" },
        },
        required: ["metric", "deal", "target", "note"],
      },
    },
    red_flags: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    docs_status: { type: "string" },
  },
  required: [
    "snapshot", "verdict", "fit_score", "units", "price", "in_place_cap",
    "expense_ratio", "econ_occupancy", "fit_table", "red_flags", "questions", "docs_status",
  ],
} as const;

export interface LwInput {
  dealName: string;
  address?: string | null;
  source?: string | null;
  docText?: string | null;
}

export interface LwResult {
  snapshot: string;
  verdict: string;
  fit_score: number;
  units: number | null;
  price: number | null;
  in_place_cap: number | null;
  expense_ratio: number | null;
  econ_occupancy: number | null;
  price_per_unit: number | null;
  fit_table: { metric: string; deal: string; target: string; note: string }[];
  red_flags: string[];
  questions: string[];
  docs_status: string;
}

// Runs the LW preliminary screen. Streams (avoids HTTP timeouts while web
// search runs) and continues across any pause_turn from the server-side tool
// loop, up to a small bound. Throws if ANTHROPIC_API_KEY is missing.
export async function runLwUnderwriting(input: LwInput): Promise<LwResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (or Vercel env) and retry.");
  }
  const client = new Anthropic({ apiKey });

  const convo: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Run the LW preliminary underwriting screen on this deal.

Deal: ${input.dealName}
Address: ${input.address ?? "(unknown)"}
Source: ${input.source ?? "(unknown)"}

Documents / data provided:
${input.docText?.slice(0, 120000) ?? "(none — screen on the header data above and list the docs needed)"}`,
    },
  ];

  let msg;
  for (let i = 0; i < 4; i++) {
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      tools: [
        { type: "web_search_20260209", name: "web_search" },
        { type: "web_fetch_20260209", name: "web_fetch" },
      ],
      system: LW_SYSTEM,
      output_config: { format: { type: "json_schema", schema: LW_SCHEMA } },
      messages: convo,
    });
    msg = await stream.finalMessage();
    if (msg.stop_reason !== "pause_turn") break;
    convo.push({ role: "assistant", content: msg.content });
  }

  // Guard the empty-result path: if the model ended without a text block (e.g.
  // interrupted mid web-search / hit the pause-loop bound), DON'T parse "{}" and
  // write an all-null analysis — throw so the caller surfaces a retryable error.
  const textBlocks = (msg?.content ?? []).filter((b) => b.type === "text");
  const last = textBlocks[textBlocks.length - 1];
  const text = last && "text" in last ? last.text.trim() : "";
  if (!text) {
    throw new Error(
      "The underwriting model returned no analysis (likely interrupted mid web-search). Nothing was saved — try again."
    );
  }
  let parsed: LwResult;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The underwriting result wasn't valid JSON. Nothing was saved — try again.");
  }
  if (typeof parsed.fit_score !== "number") {
    throw new Error("The underwriting result was incomplete (no fit score). Nothing was saved — try again.");
  }
  const ppu =
    parsed.price && parsed.units ? Math.round(parsed.price / parsed.units) : null;

  return { ...parsed, price_per_unit: ppu } as LwResult;
}
