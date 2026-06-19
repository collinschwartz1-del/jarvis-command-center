import { supabaseAdmin } from "@/lib/supabase";
import { runLwUnderwriting } from "@/lib/underwrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LW multifamily underwriting. Two modes:
//   - no `id`  → ad-hoc: run the screen and INSERT a new analysis row.
//   - with `id`→ promote: run the screen and UPDATE the existing (flagged) row
//                in place, so the 1-click "Run underwriting" doesn't duplicate
//                the stub the intel cron created.
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart." },
      { status: 503 }
    );
  }

  const body = await req.json();
  const { id, dealName, address, source, assetType, docText } = body as {
    id?: string;
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

  let parsed;
  try {
    parsed = await runLwUnderwriting({ dealName, address, source, docText });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Underwriting failed." },
      { status: 500 }
    );
  }

  const row = {
    deal_name: dealName,
    address: address ?? null,
    asset_type: "multifamily",
    source: source ?? null,
    units: parsed.units,
    price: parsed.price,
    price_per_unit: parsed.price_per_unit,
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
  };

  const db = supabaseAdmin();
  const { data, error } = id
    ? await db.from("deal_analyses").update(row).eq("id", id).select().single()
    : await db.from("deal_analyses").insert(row).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ analysis: data });
}
