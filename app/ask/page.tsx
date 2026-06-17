"use client";

import { useRef, useState } from "react";
import { Send, Mic, Volume2, VolumeX } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useSpeechRecognition, useSpeech } from "@/lib/use-voice";

type Msg = { role: "user" | "assistant"; content: string };

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceOutRef = useRef(voiceOut);
  voiceOutRef.current = voiceOut;

  const speech = useSpeech();
  const mic = useSpeechRecognition({
    onInterim: (text) => setInput(text),
    // On a final dictation result, send it straight through.
    onFinal: (text) => send(text),
  });

  async function send(forced?: string) {
    const q = (forced ?? input).trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Request failed." }));
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${error}` };
          return copy;
        });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
        scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
      }
      if (voiceOutRef.current && acc.trim()) speech.speak(acc);
    } finally {
      setBusy(false);
    }
  }

  function toggleVoiceOut() {
    setVoiceOut((v) => {
      if (v) speech.cancel(); // turning off — stop any in-progress speech
      return !v;
    });
  }

  return (
    <div>
      <PageHeader
        title="ASK"
        subtitle="Talk to Jarvis directly — grounded in your live cards, brief, pipeline, and handoffs. Tap the mic to speak, or flip the speaker on to hear replies."
      />

      <div className="flex h-[calc(100vh-220px)] flex-col rounded-lg border border-border bg-panel">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted">
              <p className="max-w-md">
                Ask things like <span className="text-zinc-300">&ldquo;what should I
                focus on today?&rdquo;</span>, <span className="text-zinc-300">&ldquo;summarize
                the liquidity risk&rdquo;</span>, or <span className="text-zinc-300">&ldquo;draft
                the Grant Square nudge&rdquo;</span>.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent/15 text-text"
                    : "border border-border bg-panel-2 text-zinc-200"
                }`}
              >
                {m.content || (busy ? "…" : "")}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border p-4">
          {speech.supported && (
            <button
              onClick={toggleVoiceOut}
              title={voiceOut ? "Voice replies on — Jarvis reads answers aloud" : "Voice replies off"}
              className={`inline-flex items-center justify-center rounded border px-3 py-2.5 transition-colors ${
                voiceOut
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-muted hover:bg-panel-2 hover:text-text"
              }`}
            >
              {voiceOut ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={mic.listening ? "Listening…" : "Ask Jarvis anything…"}
            className="flex-1 rounded border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent/50"
          />
          {mic.supported && (
            <button
              onClick={mic.toggle}
              title={mic.listening ? "Stop listening" : "Speak a command"}
              className={`inline-flex items-center justify-center rounded border px-3 py-2.5 transition-colors ${
                mic.listening
                  ? "border-accent bg-accent/20 text-accent shadow-[0_0_10px_var(--accent)]"
                  : "border-border text-muted hover:bg-panel-2 hover:text-text"
              }`}
            >
              <Mic size={16} className={mic.listening ? "animate-pulse" : ""} />
            </button>
          )}
          <button
            onClick={() => send()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}
