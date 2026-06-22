// Omaha Deal Engine — lead alerts to Collin + Tyler.
//
// Fires when NEW acreage (SFR flip) or multifamily leads land in the spine.
// Emails both recipients (and texts them once Twilio is wired). Hot-lead
// real-time alerts (VA marks a seller "Interested") are sent separately by the
// /sourcing disposition action — this script is the batched new-lead digest,
// run from morning-board.sh (or ad-hoc).
//
// SAFETY: defaults to DRY RUN (prints, sends nothing). Pass --send to actually
// email. State file tracks last-run so each lead alerts once.
//
// Env (from .env.local): DCC_SUPABASE_URL, DCC_SUPABASE_KEY, GMAIL_* ,
//   optional TWILIO_* + ALERT_SMS_FROM.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// load .env.local
const envPath = join(HERE, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const SEND = process.argv.includes("--send");
const STATE = join(HERE, ".lead-alerts-state.json");
const URL = process.env.DCC_SUPABASE_URL;
const KEY = process.env.DCC_SUPABASE_KEY;

// Recipients — Collin + Tyler (deals partner). Acreage + MF leads go to both.
const RECIPIENTS = [
  { name: "Collin", email: "collinschwartz1@gmail.com", cell: "4025360580" },
  { name: "Tyler", email: "tyler.trelles@bhhsamb.com", cell: "4028126984" },
];

const usd = (n) => (n == null || isNaN(+n) ? "—" : "$" + Math.round(+n).toLocaleString("en-US"));

function lastRun() {
  try { return JSON.parse(readFileSync(STATE, "utf8")).lastRunISO; } catch { return null; }
}
function saveRun(iso) { writeFileSync(STATE, JSON.stringify({ lastRunISO: iso }, null, 2)); }

async function fetchNewLeads(sinceISO) {
  // acreage (flip) + multifamily, surfaced since last run, newest/highest first
  const q = new URLSearchParams({
    buy_box: "in.(flip,multifamily)",
    surfaced_at: `gt.${sinceISO}`,
    order: "score.desc.nullslast,surfaced_at.desc",
    select: "lead_id,source,display_address,buy_box,rank_label,confidence,score,equity_capture,owner_name,summary,ask,surfaced_at",
  });
  const r = await fetch(`${URL.replace(/\/$/, "")}/rest/v1/v_daily_brief?${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`spine ${r.status}: ${await r.text()}`);
  return r.json();
}

function emailHTML(leads) {
  const rows = leads.map((l) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #2a3340;font-weight:600">${l.display_address}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #2a3340">${l.buy_box === "multifamily" ? "Multifamily" : "Acreage/Flip"}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #2a3340">${l.rank_label ?? "—"}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #2a3340;color:#3fb950;font-weight:700">${usd(l.equity_capture) !== "—" ? usd(l.equity_capture) : usd(l.ask)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #2a3340">${l.owner_name ?? "—"}</td>
    </tr>`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0a0e14;color:#e6edf3;padding:22px">
    <h2 style="margin:0 0 4px">🏠 New deal leads — ${leads.length}</h2>
    <p style="color:#8b96a5;margin:0 0 16px">Acreage (flip) + multifamily leads just surfaced in the Omaha Deal Engine. Full queue + call dispositions in the Jarvis <b>Deals</b> tab.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="color:#8b96a5;text-transform:uppercase;font-size:11px">
        <td style="padding:7px 10px">Address</td><td style="padding:7px 10px">Type</td><td style="padding:7px 10px">Tier</td><td style="padding:7px 10px">Equity/Ask</td><td style="padding:7px 10px">Owner</td>
      </tr>${rows}
    </table>
  </div>`;
}

async function gmailToken() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET, refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`gmail token ${r.status}`);
  return (await r.json()).access_token;
}

async function emailAll(leads) {
  const token = await gmailToken();
  if (!token) { console.log("Gmail creds absent — cannot email."); return; }
  const to = RECIPIENTS.map((r) => r.email).join(", ");
  const subject = `🏠 ${leads.length} new deal lead${leads.length > 1 ? "s" : ""} — Omaha Deal Engine`;
  const raw = [
    `To: ${to}`, `From: collinschwartz1@gmail.com`, `Subject: ${subject}`,
    "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", emailHTML(leads),
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${await r.text()}`);
  console.log(`✓ emailed ${to}`);
}

async function smsAll(leads) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.ALERT_SMS_FROM;
  if (!sid || !tok || !from) { console.log("Twilio not configured — SMS skipped (email sent)."); return; }
  const body = `Omaha Deal Engine: ${leads.length} new ${leads.length > 1 ? "leads" : "lead"} (${leads.slice(0, 3).map((l) => l.display_address).join("; ")}${leads.length > 3 ? "…" : ""}). See Jarvis Deals tab.`;
  for (const rcpt of RECIPIENTS) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: "+1" + rcpt.cell, From: from, Body: body }),
    });
    console.log(r.ok ? `✓ texted ${rcpt.name}` : `✗ sms ${rcpt.name}: ${r.status}`);
  }
}

async function main() {
  if (!URL || !KEY) { console.error("DCC_SUPABASE_URL/KEY missing"); process.exit(1); }
  const since = lastRun() ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const nowISO = new Date().toISOString();
  const leads = await fetchNewLeads(since);
  console.log(`Lead alerts · since ${since} · ${leads.length} new acreage/MF lead(s)${SEND ? "" : " · DRY RUN"}`);
  if (!leads.length) { console.log("nothing new — no alert."); return; }
  for (const l of leads) console.log(`  • ${l.display_address} [${l.buy_box}] ${l.rank_label ?? ""} ${usd(l.equity_capture)} — ${l.owner_name ?? ""}`);
  if (!SEND) { console.log("\n(DRY RUN — re-run with --send to email Collin + Tyler. State not advanced.)"); return; }
  await emailAll(leads);
  await smsAll(leads);
  saveRun(nowISO);
}

main();
