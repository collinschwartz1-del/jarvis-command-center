"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
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

        {sent ? (
          <div className="mt-6">
            <p className="text-sm text-text">Check your email.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              A magic sign-in link is on its way to{" "}
              <span className="text-zinc-300">{email}</span>. Open it on this
              device to enter the command center.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm leading-relaxed text-muted">
              Private. Enter your email and we&rsquo;ll send a one-tap sign-in
              link. Only allowlisted addresses can enter.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              placeholder="you@example.com"
              className="mt-4 w-full rounded border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent/50"
            />
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            <button
              onClick={sendLink}
              disabled={busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <Mail size={14} /> {busy ? "Sending…" : "Send magic link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
