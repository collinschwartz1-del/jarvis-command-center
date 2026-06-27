// One-shot Gmail draft cleanup — removes the duplicate / stale / test drafts the
// 2026-06-26 control-plane audit flagged. CONSERVATIVE: only clearly-safe targets
// (older copies of daily digests, duplicate reply drafts where a newer one exists,
// one duplicate AP nudge, and test/status artifacts). It deliberately does NOT
// touch LLS partner-report drafts or AP nudges to a different recipient — those
// are flagged for Collin instead of auto-deleted.
//
// Safety: DRY by default (prints the plan). Pass --execute to actually delete.
// drafts.delete needs the gmail.compose scope the refresh token already carries;
// if the token is revoked, run `npm run gmail-auth` first.
//
//   node scripts/cleanup-drafts.mjs            # dry run — show the plan
//   node scripts/cleanup-drafts.mjs --execute  # delete the listed drafts

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXECUTE = process.argv.includes("--execute");

function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

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

// The audited delete list — id + who + subject + why. Keep the human-readable
// fields so the dry-run plan is self-documenting.
const TARGETS = [
  // --- stale daily digests (keep only the 6/26 copy) ---
  ["r8902227444088365352",  "self", "Morning Triage — June 21", "stale digest"],
  ["r3078725455421689463",  "self", "Morning Triage — 06-22",   "stale digest"],
  ["r-8255989113996419676", "self", "Morning Triage — June 23", "stale digest"],
  ["r5068555490817138634",  "self", "Morning Triage — 06-24",   "stale digest"],
  ["r8559675951588158125",  "self", "Morning Triage — 06-25",   "stale digest"],
  ["r-9113492418638861942", "self", "End-of-Day Sweep — 06-21",  "stale digest"],
  ["r-784729844467879741",  "self", "End-of-Day Sweep — 06-23",  "stale digest"],
  ["r-1227640760295821327", "self", "End-of-Day Sweep — 06-24",  "stale digest"],
  ["r-8795419064455767221", "self", "End-of-Day Sweep — June 25","stale digest"],
  // --- duplicate reply drafts (a newer draft exists for the same thread) ---
  ["draft-rewrite-1868608306211635781", "jessica@moneysmartsinc.com", "Re: 6-5-26 Items Needed (06-21)", "dup — keep 06-23"],
  ["draft-rewrite-1868698901596964155", "jessica@moneysmartsinc.com", "Re: 6-5-26 Items Needed (06-22)", "dup — keep 06-23"],
  ["r5662465497713740833",  "jessica@moneysmartsinc.com", "Cornelia $5,000 overdue (06-24)", "dup — keep 06-25"],
  ["r-3165811699447173867", "austinjcroghan@gmail.com",   "Re: Titan Performance Vault? (06-23)", "dup — keep 06-24"],
  ["r-219953053608986099",  "jethro@ncbabroker.com",      "Re: Follow up on our conversation (06-24)", "dup — keep 06-25"],
  // --- duplicate AP nudge (same invoice, same recipient, older) ---
  ["r-5024405787238564376", "megan@acornhuskers.com",     "Grunwald HVAC INV 9067 (06-24)", "dup — keep 06-25 megan copy"],
  // --- test / stale status artifacts ---
  ["r-6297629568833133985", "self", "[TEST] New Titan application — Sue E2E Check", "test artifact"],
  ["r4968858504185251963",  "self", "Opportunity Engine export — status HEALTHY (06-22)", "stale status note"],
];

// Drafts intentionally LEFT in place (flagged, not auto-deleted):
const FLAGGED = [
  "LLS Weekly Partner Report — two drafts for week ending June 21 (punctuation dup). External/partner-facing → review & delete one yourself.",
  "jessica@ Grunwald 'Please check INV 9067' — different recipient than megan's; may be intentional. Left in place.",
  "Karen Weekly Coaching Report — 06-21 — stale but a report; your call.",
];

async function main() {
  let token;
  try {
    token = await gmailToken();
  } catch (e) {
    console.error("\n🔴 Gmail token is dead:", e.message);
    console.error("   Run `npm run gmail-auth` (one browser click), then re-run this.\n");
    printPlan();
    process.exit(2);
  }
  if (!token) {
    console.error("Gmail creds missing in .env.local. Run `npm run gmail-auth`.");
    printPlan();
    process.exit(2);
  }

  printPlan();
  if (!EXECUTE) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --execute to delete the list above.\n");
    return;
  }

  console.log("\nExecuting deletions...\n");
  let ok = 0, gone = 0, failed = 0;
  for (const [id, who, subject] of TARGETS) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 204 || res.ok) { ok++; console.log(`  ✓ deleted  ${who.padEnd(28)} ${subject}`); }
    else if (res.status === 404)      { gone++; console.log(`  · already gone  ${who.padEnd(24)} ${subject}`); }
    else { failed++; console.log(`  ✗ FAILED (${res.status})  ${who.padEnd(20)} ${subject} — ${await res.text()}`); }
  }
  console.log(`\nDone: ${ok} deleted, ${gone} already gone, ${failed} failed (of ${TARGETS.length}).`);
  console.log("\nLeft in place (flagged for your review):");
  for (const f of FLAGGED) console.log("  • " + f);
  console.log("");
}

function printPlan() {
  console.log(`\nCleanup plan — ${TARGETS.length} drafts to delete:`);
  for (const [, who, subject, why] of TARGETS) {
    console.log(`  ${who.padEnd(28)} ${subject.padEnd(46)} [${why}]`);
  }
}

main().catch((e) => { console.error("cleanup-drafts: fatal", e); process.exit(1); });
