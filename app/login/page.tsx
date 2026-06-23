"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, KeyRound } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

function LoginInner() {
  const params = useSearchParams();
  const reason = params.get("error");
  const rejectedEmail = params.get("email");
  // A failed sign-in used to dump the user back here with no explanation.
  // Name the actual failure so they can fix it without a 60-message thread.
  const notice =
    reason === "not_authorized"
      ? `${rejectedEmail ? `“${rejectedEmail}”` : "That email"} isn't on the access list. Sign in with the exact address Collin approved — or ask him to add this one.`
      : reason === "link"
        ? "That sign-in link was already used or expired. We've switched to a typed code — request one below."
        : null;

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — send a 6-digit code. No emailRedirectTo: we verify a typed token,
  // so there is no clickable link for a corporate mail scanner to pre-consume,
  // and no PKCE verifier that breaks when the link is opened on another device.
  async function sendCode() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else setStep("code");
  }

  // Step 2 — verify the typed code. On success the browser client writes the
  // session cookie; a full navigation lets middleware route to the role's home.
  async function verify() {
    const token = code.trim();
    if (token.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="ticked w-full max-w-sm rounded-lg border border-border bg-panel p-7">
        <div className="flex items-center gap-2.5">
          <span className="dot-pulse h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-sm font-semibold tracking-[0.22em] text-text">
            JARVIS
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted">
            COMMAND CENTER
          </span>
        </div>

        {notice && (
          <p className="mt-5 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-300">
            {notice}
          </p>
        )}

        {step === "code" ? (
          <div className="mt-6">
            <p className="text-sm text-text">Enter your code.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              We emailed a 6-digit code to{" "}
              <span className="text-zinc-300">{email}</span>. Type it below — no
              link to click.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="123456"
              className="mt-4 w-full rounded border border-border bg-bg px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-text outline-none placeholder:text-muted focus:border-accent/50"
            />
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            <button
              onClick={verify}
              disabled={busy || code.length < 6}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <KeyRound size={14} /> {busy ? "Verifying…" : "Enter command center"}
            </button>
            <button
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="mt-3 w-full text-center text-xs text-muted hover:text-text"
            >
              ← Use a different email / resend
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-relaxed text-muted">
              Private. Enter your email and we&rsquo;ll send a 6-digit sign-in
              code. Only allowlisted addresses can enter.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
              placeholder="you@example.com"
              className="mt-4 w-full rounded border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent/50"
            />
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            <button
              onClick={sendCode}
              disabled={busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <Mail size={14} /> {busy ? "Sending…" : "Send sign-in code"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary under Next 15's prerender.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
