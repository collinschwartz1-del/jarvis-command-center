// CARD INTAKE — credential-based, headless, autonomous.
//
// Replaces the retired `claude -p /board` step. Cowork's "CEO Daily Briefing
// TITAN" owns the morning brief; this script READS that brief and turns its
// action items into approvable Jarvis cards (.md files in the brain), which
// `sync.mjs` then mirrors into Supabase for the dashboard.
//
// Why .mjs and not `claude -p`: the interactive agent's MCP connectors
// (Gmail/Slack/Supabase) only auth in an interactive session and fail silently
// under cron. This script carries its own Gmail OAuth + Anthropic key, so it
// actually runs at 7am unattended — same pattern as intel.mjs / draft-replies.mjs.
//
// Safety: writes only local card .md files (status: pending — nothing executes
// until Collin approves a card in the dashboard). No sends. Dedupes against
// existing open cards so it never restages the same work.
//
// Usage:
//   node scripts/intake-cards.mjs          # write new pending cards
//   node scripts/intake-cards.mjs --dry    # print proposed cards, write nothing

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const DRY = process.argv.includes("--dry");

// --- env (same loader as sync.mjs / intel.mjs) ---
function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const JARVIS = process.env.JARVIS_DIR;
const MODEL = process.env.INTAKE_MODEL || "claude-sonnet-4-6";
if (!ANTHROPIC_KEY || !JARVIS) {
  console.error("intake: missing ANTHROPIC_API_KEY or JARVIS_DIR — aborting.");
  process.exit(1);
}
const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ---------- Gmail (REST + fetch; copied from intel.mjs) ----------
async function gmailToken() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}
function header(payload, name) {
  const h = (payload?.headers || []).find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}
function decodeBody(payload) {
  function walk(p) {
    if (!p) return "";
    if (p.mimeType === "text/plain" && p.body?.data)
      return Buffer.from(p.body.data, "base64").toString("utf8");
    for (const part of p.parts || []) {
      const t = walk(part);
      if (t) return t;
    }
    return "";
  }
  // brief can be long; keep more than intel's 4k snippet cap
  return walk(payload).slice(0, 12000);
}

// Find the freshest "CEO Daily Briefing TITAN" email and return its plain text.
async function fetchBrief() {
  const token = await gmailToken();
  if (!token) {
    console.log("intake: Gmail creds absent — cannot read the brief. Skipping.");
    return null;
  }
  const auth = { Authorization: `Bearer ${token}` };
  // 1d in production (today's brief). Override via INTAKE_WINDOW for testing or
  // to tolerate a late/weekend brief; maxResults:1 always takes the freshest.
  const window = process.env.INTAKE_WINDOW || "1d";
  const q = `subject:"CEO Daily Briefing TITAN" newer_than:${window}`;
  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=1`,
    { headers: auth }
  ).then((r) => r.json());
  const id = list.messages?.[0]?.id;
  if (!id) {
    console.log("intake: no 'CEO Daily Briefing TITAN' in the last day. Nothing to intake.");
    return null;
  }
  const m = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: auth }
  ).then((r) => r.json());
  return {
    subject: header(m.payload, "Subject"),
    date: header(m.payload, "Date"),
    body: decodeBody(m.payload),
  };
}

// ---------- existing cards: dedupe + next id ----------
const cardsDir = join(JARVIS, "jarvis", "cards");
function existingCards() {
  if (!existsSync(cardsDir)) return { open: [], maxNum: 0 };
  const open = [];
  let maxNum = 0;
  for (const file of readdirSync(cardsDir).filter((f) => /^card-\d+\.md$/.test(f))) {
    const num = parseInt(file.match(/card-(\d+)\.md/)[1], 10);
    if (num > maxNum) maxNum = num;
    const raw = readFileSync(join(cardsDir, file), "utf8");
    const title = raw.match(/^title:\s*(.+)$/m)?.[1]?.trim();
    const status = raw.match(/^status:\s*(.+)$/m)?.[1]?.trim() || "pending";
    // only open cards matter for dedupe — done/dismissed/archived can recur
    if (title && !["done", "dismissed", "archived"].includes(status)) open.push(title);
  }
  return { open, maxNum };
}

// ---------- the extraction ----------
const SEATS = ["scout", "underwriter", "capital", "growth", "correspondence"];

function systemPrompt() {
  return `You are Jarvis's intake function. You convert Collin's morning CEO brief into a SHORT, ruthless list of approvable action cards. You do NOT execute anything — each card is a proposal Collin approves later.

Rules:
- Only card the highest-leverage, genuinely actionable items. Skip FYIs, status lines, and anything not requiring a decision or a next action. Quality over quantity — 0 to 6 cards. If nothing rises to a card, return an empty list.
- Each card needs a crisp imperative title (what to do), a one-sentence "why" (the stakes/context), and a concrete "action" (the literal next step on pickup).
- Assign a seat from this set based on the work:
  ${SEATS.map((s) => `  - ${s}`).join("\n")}
  Use "correspondence" for anything whose action is drafting an email/reply (draft only, never send).
- Assign a tier:
  - "3" = urgent, high-stakes decision that needs Collin now (money at risk, time-sensitive, relationship-critical).
  - "2" = standard action worth doing this week; a draft or prep step helps.
  - "1" = low-priority / nurture / optional.
- DEDUPE: do not propose a card that duplicates one already open (titles provided). When in doubt, skip it.`;
}

function userPrompt(brief, openTitles) {
  return `Today's CEO Daily Briefing TITAN (subject: "${brief.subject}", ${brief.date}):

"""
${brief.body}
"""

Cards ALREADY open (do not duplicate these):
${openTitles.length ? openTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

Extract the action cards now.`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          action: { type: "string" },
          seat: { type: "string", enum: SEATS },
          tier: { type: "string", enum: ["1", "2", "3"] },
        },
        required: ["title", "why", "action", "seat", "tier"],
      },
    },
  },
  required: ["cards"],
};

function cardMarkdown(id, c, briefDate) {
  return `---
id: ${id}
title: ${c.title}
seat: ${c.seat}
tier: ${c.tier}
status: pending
created: ${new Date().toISOString().slice(0, 10)}
why: ${c.why.replace(/\n/g, " ")}
action: |
  ${c.action.replace(/\n/g, "\n  ")}
---

Source: CEO Daily Briefing TITAN (${briefDate}). Auto-staged by intake-cards.mjs — pending Collin's approval.
`;
}

// ---------- run ----------
const brief = await fetchBrief();
if (!brief || !brief.body.trim()) {
  console.log("intake: no brief body to process. Done.");
  process.exit(0);
}

const { open, maxNum } = existingCards();

const resp = await claude.messages.create({
  model: MODEL,
  max_tokens: 2000,
  system: systemPrompt(),
  messages: [{ role: "user", content: userPrompt(brief, open) }],
  output_config: { format: { type: "json_schema", schema: SCHEMA } },
});

let parsed = { cards: [] };
try {
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  parsed = JSON.parse(text || "{}");
} catch (e) {
  console.error("intake: could not parse model output —", String(e));
  process.exit(1);
}
const cards = Array.isArray(parsed.cards) ? parsed.cards : [];

if (!cards.length) {
  console.log("intake: brief read, nothing rose to a card today. Done.");
  process.exit(0);
}

if (DRY) {
  console.log(`intake (DRY): would stage ${cards.length} card(s):\n`);
  cards.forEach((c, i) =>
    console.log(`  ${i + 1}. [tier ${c.tier} · ${c.seat}] ${c.title}\n     why: ${c.why}\n     action: ${c.action}\n`)
  );
  console.log("(--dry: no files written)");
  process.exit(0);
}

let n = maxNum;
let written = 0;
for (const c of cards) {
  n += 1;
  const id = `card-${String(n).padStart(4, "0")}`;
  writeFileSync(join(cardsDir, `${id}.md`), cardMarkdown(id, c, brief.date));
  written += 1;
  console.log(`  staged ${id}: ${c.title}`);
}
console.log(`intake: staged ${written} new pending card(s) from today's brief.`);
