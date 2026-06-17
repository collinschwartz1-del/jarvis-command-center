import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function allowed(): string[] {
  return (
    process.env.ALLOWED_EMAILS ??
    "collinschwartz1@gmail.com,collin@leavenwealth.com"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Gate every route (pages + API) behind an authed, allowlisted session.
// Public: /login and /auth/*.
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          ),
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");
  const ok = user && allowed().includes((user.email ?? "").toLowerCase());

  if (!ok && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // API callers get a 401 instead of an HTML redirect
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(url);
  }

  if (ok && isPublic && path.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
