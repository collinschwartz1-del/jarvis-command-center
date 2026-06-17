// Jarvis → Supabase sync runner (Phase 4).
// Reads the file-based brain at $JARVIS_DIR and upserts cards + briefings into
// the command-center database, then recomputes the metric tiles. Idempotent —
// run it after every /board pass (or on a cron). `npm run sync`.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Tolerant frontmatter parser for the hand-written card files (their `why:`
// text contains unquoted colons, so strict YAML rejects them). Handles scalar
// keys and `key: |` block scalars; everything after the closing --- is body.
function parseCard(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: raw };
  const lines = m[1].split("\n");
  const data = {};
  let key = null;
  let block = null; // collecting a `|` block scalar
  for (const line of lines) {
    if (block !== null) {
      if (/^\s{2,}/.test(line) || line.trim() === "") {
        block.push(line.replace(/^ {2}/, ""));
        continue;
      }
      data[key] = block.join("\n").trim();
      block = null;
    }
    const kv = line.match(/^([a-zA-Z_]+):\s?(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const val = kv[2];
    if (val === "|" || val === "|-") block = [];
    else data[key] = val;
  }
  if (block !== null) data[key] = block.join("\n").trim();
  return { data, content: (m[2] || "").trim() };
}

// --- load .env.local (standalone node doesn't read it like Next does) ---
function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JARVIS = process.env.JARVIS_DIR;
if (!URL || !KEY || !JARVIS) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or JARVIS_DIR");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

// --- cards ---
const cardsDir = join(JARVIS, "jarvis", "cards");
let cardCount = 0;
if (existsSync(cardsDir)) {
  for (const file of readdirSync(cardsDir).filter((f) => /^card-.*\.md$/.test(f))) {
    const raw = readFileSync(join(cardsDir, file), "utf8");
    const { data, content } = parseCard(raw);
    if (!data.id) continue;
    const { error } = await db.from("cards").upsert(
      {
        id: String(data.id),
        title: data.title ?? "(untitled)",
        seat: data.seat ?? "chief-of-staff",
        tier: String(data.tier ?? "1"),
        status: data.status ?? "pending",
        why: data.why ?? "",
        action: data.action ?? null,
        result: data.result ? String(data.result) : null,
        body: content.trim() || null,
        file_path: `jarvis/cards/${file}`,
      },
      { onConflict: "id" }
    );
    if (error) console.error(`card ${data.id}:`, error.message);
    else cardCount++;
  }
}

// --- briefings (YYYY-MM-DD.md) ---
const briefDir = join(JARVIS, "jarvis", "briefings");
let briefCount = 0;
if (existsSync(briefDir)) {
  for (const file of readdirSync(briefDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))) {
    const date = file.replace(/\.md$/, "");
    const content = readFileSync(join(briefDir, file), "utf8");
    const { error } = await db
      .from("briefings")
      .upsert({ brief_date: date, content }, { onConflict: "brief_date" });
    if (error) console.error(`briefing ${date}:`, error.message);
    else briefCount++;
  }
}

// --- recompute today's metric tiles ---
const { data: cards } = await db.from("cards").select("status");
const active = (cards ?? []).filter((c) => !["done", "dismissed", "archived"].includes(c.status)).length;
const { count: onlineCount } = await db
  .from("agents")
  .select("*", { count: "exact", head: true })
  .eq("online", true);

const today = new Date().toISOString().slice(0, 10);
await db.from("metrics").upsert(
  { metric_date: today, workflows: active, agents_online: onlineCount ?? 0 },
  { onConflict: "metric_date" }
);

await db.from("activity").insert({
  actor: "sync",
  kind: "sync_run",
  summary: `Synced ${cardCount} cards and ${briefCount} briefings from the Jarvis files`,
});

console.log(`✅ Synced ${cardCount} cards, ${briefCount} briefings. Active workflows: ${active}.`);
