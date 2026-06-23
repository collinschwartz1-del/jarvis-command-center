import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// Magic-link lands here with a ?code= — exchange it for a session cookie.
// Failure modes we make visible (instead of silently dumping back to /login):
//   - no code / Supabase passed an ?error= (link expired OR already consumed by
//     a corporate mail scanner like Outlook/Defender Safe Links pre-clicking it)
//   - exchangeCodeForSession fails (single-use code already spent, or the PKCE
//     verifier cookie is missing because the link was opened on another device)
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const providerErr = searchParams.get("error_description") || searchParams.get("error");

  if (providerErr) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "link");
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "link");
    return NextResponse.redirect(url);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "link");
    return NextResponse.redirect(url);
  }

  // Session set. Land on "/" — middleware routes to the role's home (callers → /sourcing).
  return NextResponse.redirect(`${origin}/`);
}
