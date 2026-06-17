import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// Magic-link lands here with a ?code= — exchange it for a session cookie.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
