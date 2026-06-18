"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not in the standard DOM lib).
// ---------------------------------------------------------------------------
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Voice commands (speech-to-text) — push-to-talk dictation.
// ---------------------------------------------------------------------------
export function useSpeechRecognition(opts: {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
}) {
  const { onInterim, onFinal } = opts;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep latest callbacks without re-creating the recognition instance.
  const cbRef = useRef({ onInterim, onFinal });
  cbRef.current = { onInterim, onFinal };

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setSupported(true);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) final += text;
        else interim += text;
      }
      if (interim) cbRef.current.onInterim?.(interim);
      if (final) cbRef.current.onFinal?.(final.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || listening) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* start() throws if already running — ignore */
    }
  }, [listening]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, start, stop, toggle };
}

// ---------------------------------------------------------------------------
// Speech output (text-to-speech) — Jarvis reads replies aloud.
// Prefers server-side ElevenLabs (/api/tts) for a natural voice; falls back to
// the browser's built-in speech synthesis when TTS isn't configured (503) or
// the request fails.
// ---------------------------------------------------------------------------
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every cancel() so a slow in-flight TTS fetch can detect it's stale.
  const genRef = useRef(0);

  useEffect(() => {
    // Either path counts as supported; ElevenLabs works even without speechSynthesis.
    setSupported(typeof window !== "undefined");
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    genRef.current += 1;
    stopAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [stopAudio]);

  const browserSpeak = useCallback((clean: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "en-US";
    u.rate = 1.05;
    u.pitch = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (typeof window === "undefined") return;
      const clean = text.replace(/[*_`#>]/g, "").trim();
      if (!clean) return;

      cancel(); // stop anything already playing; bumps genRef
      const gen = genRef.current;
      setSpeaking(true);

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (gen !== genRef.current) return; // cancelled while fetching
        if (!res.ok) {
          // 503 = not configured, anything else = failure → browser fallback
          browserSpeak(clean);
          return;
        }
        const blob = await res.blob();
        if (gen !== genRef.current) return;
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => browserSpeak(clean);
        await audio.play();
      } catch {
        if (gen === genRef.current) browserSpeak(clean);
      }
    },
    [cancel, browserSpeak]
  );

  return { supported, speaking, speak, cancel };
}
