import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login`);
}
