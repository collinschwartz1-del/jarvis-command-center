export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side ElevenLabs text-to-speech. The key never reaches the browser.
// Returns audio/mpeg on success; 503 when no key is configured so the client
// transparently falls back to the browser's built-in speech synthesis.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // Adam
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "tts_not_configured" }, { status: 503 });
  }

  const { text } = (await req.json()) as { text?: string };
  const clean = (text ?? "").replace(/[*_`#>]/g, "").trim().slice(0, 5000);
  if (!clean) return Response.json({ error: "empty" }, { status: 400 });

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: clean,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: "elevenlabs_failed", status: res.status, detail: detail.slice(0, 300) },
      { status: 502 }
    );
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
