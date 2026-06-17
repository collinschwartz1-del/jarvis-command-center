import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LeavenWealth underwriting skill (captured from Collin's LW Acquisition Playbook).
const LW_SYSTEM = `You are the LeavenWealth acquisitions & underwriting analyst (value-add multifamily, Central US). Evaluate the deal, pressure-test assumptions, and flag risks before capital is deployed. Write like an internal acquisitions team member — direct, numbers-first.

Screen against LW benchmarks:
- Markets: Central US, landlord-friendly (NE, IA, KS, MO, OK, SD, secondary Midwest). Operating in Omaha, KC, Des Moines, Sioux Falls, Wichita.
- Asset: value-add multifamily where operations drive NOI.
- Size: 100–300 units preferred (24 min in operating markets, 150 min in new markets).
- In-place cap ≥ 8%; expense ratio < 50%; economic occupancy ≥ 85%; price/unit below replacement.
- Returns: return 75–100% of capital in 3–7 yrs; distributable cash flow ≥ 7%/yr.
- Value-add levers: interior renos, RUBS, PM improvements, lease trade-outs, amenities.
- Deal breakers: crime-heavy submarkets, structural issues, major supply pipeline, econ occ < 85% w/ no recovery, expense ratio > 55% w/o mitigation.

Produce a Preliminary LW Fit Score (0–10); 7+ moves to deeper underwriting. Be honest — most broker deals are priced to market and will not clear the 8% in-place cap target. If the financials are not provided, screen on what's available and say exactly which docs are needed (T-12, rent roll, OM).`;

const SCHEMA = {
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

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart." },
      { status: 503 }
    );
  }

  const body = await req.json();
  const { dealName, address, source, assetType, docText } = body as {
    dealName: string;
    address?: string;
    source?: string;
    assetType?: string;
    docText?: string;
  };

  // Flips don't run here — they route to Flip Tracker.
  if (assetType === "flip") {
    return Response.json(
      { error: "Flips route to Flip Tracker, not the LW multifamily analyzer." },
      { status: 400 }
    );
  }

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: LW_SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Run the LW preliminary underwriting screen on this deal.

Deal: ${dealName}
Address: ${address ?? "(unknown)"}
Source: ${source ?? "(unknown)"}

Documents / data provided:
${docText?.slice(0, 120000) ?? "(none — screen on the header data above and list the docs needed)"}`,
      },
    ],
  });

  const text = msg.content.find((b) => b.type === "text");
  const parsed = JSON.parse(text && "text" in text ? text.text : "{}");

  const ppu =
    parsed.price && parsed.units ? Math.round(parsed.price / parsed.units) : null;

  const { data, error } = await supabaseAdmin()
    .from("deal_analyses")
    .insert({
      deal_name: dealName,
      address: address ?? null,
      asset_type: "multifamily",
      source: source ?? null,
      units: parsed.units,
      price: parsed.price,
      price_per_unit: ppu,
      in_place_cap: parsed.in_place_cap,
      expense_ratio: parsed.expense_ratio,
      econ_occupancy: parsed.econ_occupancy,
      fit_score: parsed.fit_score,
      verdict: parsed.verdict,
      snapshot: parsed.snapshot,
      fit_table: parsed.fit_table,
      red_flags: parsed.red_flags,
      questions: parsed.questions,
      docs_status: parsed.docs_status,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ analysis: data });
}
