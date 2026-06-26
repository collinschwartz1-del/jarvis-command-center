// Collin's World CRM — contact importer (one-time / refresh-on-demand).
//
// Pulls each contact source and UPSERTS into the `contacts` table, keyed on
// (source, source_id) so re-running refreshes in place instead of duplicating.
// Nothing auto-syncs — this runs when you ask ("refresh the CRM"). It only READS
// source systems and writes to Jarvis's own Supabase; it never writes back to
// any source, never emails, never moves money.
//
//   Sources:
//     lendr          → Lendr /borrowers + /investors (live REST) + LLS GHL leads CSV
//     titan          → Titan member directory (reflections repo lib/members.ts)
//     collins_world  → AI-event attendees snapshot (scripts/data/collins-world.json)
//     personal       → Google Contacts export CSV (~/Downloads/contacts.csv)
//     leavenwealth   → LeavenWealth GHL export CSV
//     legacy_re      → cleaned legacy RE master list CSV (COLD → do_not_bulk)
//     partners       → wholesaler pipeline (.md) + broker outreach queue (.csv)
//     owners         → deal-engine (DCC) MF + SF owners w/ phones (COLD, carries DNC)
//
//   Env (.env.local): NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (req),
//     LENDR_API_BASE / LENDR_API_KEY, DCC_SUPABASE_URL / DCC_SUPABASE_KEY.
//   File paths overridable via env (see CONFIG below).
//
//   Run:  node --experimental-strip-types scripts/contacts-import.mjs [all|<source>...]
//         sources: lendr titan collins_world personal leavenwealth legacy_re partners owners

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}
loadEnv();

const HOME = homedir();
const CONFIG = {
  titanMembers: process.env.TITAN_MEMBERS_PATH ||
    `${HOME}/Desktop/08_Side_Projects/5pct-reflections-coach/lib/members.ts`,
  googleContacts: process.env.GOOGLE_CONTACTS_CSV || `${HOME}/Downloads/contacts.csv`,
  ghlLeavenwealth: process.env.GHL_LW_CSV || `${HOME}/Downloads/LeavenWealth (GHL).csv`,
  ghlLiquidLending: process.env.GHL_LLS_CSV || `${HOME}/Downloads/Liquid Lending (GHL).csv`,
  legacyRe: process.env.LEGACY_RE_CSV ||
    `${HOME}/Documents/my-ai-team/sue/trackers/legacy-contacts-labeled-ALL.csv`,
  wholesalers: process.env.WHOLESALER_MD ||
    `${HOME}/Documents/my-ai-team/sue/trackers/wholesaler-pipeline.md`,
  brokers: process.env.BROKERS_CSV || `${HOME}/Downloads/outreach-queue-enriched.csv`,
  vince: process.env.VINCE_CSV || join(process.cwd(), "scripts", "data", "vince.csv"),
  austin: process.env.AUSTIN_CSV || join(process.cwd(), "scripts", "data", "austin.csv"),
  vcard: process.env.VCARD_PATH || `${HOME}/Documents/MasterContacts.vcf`,
};

// Business / real-estate / trades signal for splitting the macOS contacts.
const RE_KW = /real ?estate|realtor|realty|investor|investment|develop|capital|properties|property|home ?buyer|homes|wholesale|mortgage|lend|broker|equity|\bfund\b|syndicat|acquisition|landlord|rental|reit|apprais|title co|escrow|acreage|leavenwealth/i;
const TRADES_KW = /construction|contractor|contracting|builder|roof|plumb|hvac|heating|\belectric|remodel|renovat|flooring|concrete|drywall|paint|excavat|landscap|mechanical|welding|fabricat|demolition|insulation|siding|window|gutter|handyman|restoration|exterior|masonry|carpentry|cabinet/i;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("contacts-import: missing SUPABASE creds — aborting.");
  process.exit(1);
}
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// --- helpers ---
const normEmail = (e) => (e ? String(e).trim().toLowerCase() || null : null);
const normPhone = (p) => {
  const d = (p ? String(p) : "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d.length ? d : null;
};
const clean = (s) => {
  const v = s == null ? null : String(s).trim();
  return v ? v : null;
};
// consent heuristic from free-text consent/relationship fields
function consentFrom(...vals) {
  const s = vals.filter(Boolean).join(" ").toLowerCase();
  if (/insider|do.?not|dnc|unsub|suppress/.test(s)) return "do_not_bulk";
  if (/opt.?in|warm|subscribed|relationship|attended/.test(s)) return "opt_in";
  return "unknown";
}

// minimal RFC-4180 CSV parser (handles quotes, embedded commas/newlines)
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvObjects(path) {
  if (!existsSync(path)) return null;
  const rows = parseCsv(readFileSync(path, "utf8")).filter((r) => r.some((c) => c !== ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}

async function upsert(rows) {
  if (!rows.length) return 0;
  // Collapse duplicate (source, source_id) keys — Postgres rejects upserting the
  // same conflict target twice in one statement (Google Contacts repeats emails).
  // Last write wins; merge a phone/email in from the dropped twin if missing.
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.source}|${r.source_id}`;
    const prev = byKey.get(k);
    if (prev) { r.phone = r.phone || prev.phone; r.email = r.email || prev.email; }
    byKey.set(k, r);
  }
  rows = [...byKey.values()];
  const stamped = rows.map((r) => ({
    ...r,
    email_norm: normEmail(r.email),
    phone_norm: normPhone(r.phone),
    updated_at: new Date().toISOString(),
  }));
  let n = 0;
  for (let i = 0; i < stamped.length; i += 500) {
    const chunk = stamped.slice(i, i + 500);
    const { error } = await db.from("contacts").upsert(chunk, { onConflict: "source,source_id" });
    if (error) throw new Error(`upsert ${rows[0]?.source}: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

// ============================ Lendr ============================
async function lendr(path) {
  const base = (process.env.LENDR_API_BASE || "").replace(/\/$/, "");
  const key = process.env.LENDR_API_KEY;
  if (!base || !key) return [];
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`lendr ${path} ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j) ? j : j?.data ?? [];
}

async function importLendr() {
  const out = [];
  const borrowers = await lendr("/borrowers");
  for (const b of borrowers) {
    out.push({
      source: "lendr", source_id: `borrower-${b.id}`,
      first_name: clean(b.first_name), last_name: clean(b.last_name),
      full_name: clean([b.first_name, b.last_name].filter(Boolean).join(" ")),
      email: clean(b.email), phone: clean(b.phone), company: clean(b.company),
      purpose: "Borrower (LLS / MASC lending)", segment: b.archived ? "archived" : "active",
      consent_status: "unknown", owner: "LLS / MASC",
      notes: clean([b.city, b.state].filter(Boolean).join(", ")), raw: b,
    });
  }
  const investors = await lendr("/investors");
  for (const i of investors) {
    out.push({
      source: "lendr", source_id: `investor-${i.id}`,
      first_name: clean(i.first_name), last_name: clean(i.last_name),
      full_name: clean([i.first_name, i.last_name].filter(Boolean).join(" ")),
      email: clean(i.email), phone: clean(i.phone), company: clean(i.company),
      purpose: "Investor (LLS fund)", segment: i.archived ? "archived" : "active",
      consent_status: "unknown", owner: "LLS",
      notes: clean([i.city, i.state].filter(Boolean).join(", ")), raw: i,
    });
  }
  // LLS marketing leads from the GHL export (kept in the Liquid Lending tab)
  const ghl = csvObjects(CONFIG.ghlLiquidLending) || [];
  ghl.forEach((r, idx) => {
    const email = normEmail(r.email);
    if (!email && !normPhone(r.phone)) return;
    out.push({
      source: "lendr", source_id: `ghl-${email || idx}`,
      first_name: clean(r.first_name), last_name: clean(r.last_name),
      full_name: clean([r.first_name, r.last_name].filter(Boolean).join(" ")),
      email: clean(r.email), phone: clean(r.phone), company: null,
      purpose: "Liquid Lending lead (GHL)", segment: clean(r.segment) || "GHL lead",
      consent_status: consentFrom(r.consent_status, r.relationship_flag, r.segment),
      owner: "LLS", notes: clean(r.notes), raw: r,
    });
  });
  const n = await upsert(out);
  console.log(`  lendr: ${borrowers.length} borrowers + ${investors.length} investors + ${ghl.length} GHL leads → ${n}`);
  return n;
}

// ============================ Titan ============================
async function importTitan() {
  if (!existsSync(CONFIG.titanMembers)) { console.log("  titan: members file not found — skipped"); return 0; }
  const mod = await import(pathToFileURL(CONFIG.titanMembers).href);
  const members = mod.MEMBERS || [];
  const tierLabel = { founder: "Titan founder", advisor: "Titan advisor", member: "Titan member" };
  const out = members.map((m) => {
    const tier = m.tier || "member";
    const slug = (m.email || `${m.firstName}-${m.lastName}`).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      source: "titan", source_id: slug,
      first_name: clean(m.firstName), last_name: clean(m.lastName),
      full_name: clean([m.firstName, m.lastName].filter(Boolean).join(" ")),
      email: clean(m.email), phone: clean(m.phone), company: clean(m.company),
      purpose: tierLabel[tier], segment: tier, consent_status: "unknown",
      owner: "Titan Mastermind", notes: clean([m.city, m.state].filter(Boolean).join(", ")),
      raw: { assetClass: m.assetClass, website: m.website, linkedin: m.linkedin, bio: m.bio },
    };
  });
  const n = await upsert(out);
  console.log(`  titan: ${members.length} members → ${n}`);
  return n;
}

// ====================== Collin's World ======================
async function importCollinsWorld() {
  const p = join(process.cwd(), "scripts", "data", "collins-world.json");
  if (!existsSync(p)) { console.log("  collins_world: snapshot not found — skipped"); return 0; }
  const rows = JSON.parse(readFileSync(p, "utf8"));
  const out = rows.filter((r) => r.email).map((r) => ({
    source: "collins_world", source_id: normEmail(r.email),
    first_name: clean(r.first_name), last_name: clean(r.last_name),
    full_name: clean([r.first_name, r.last_name].filter(Boolean).join(" ")),
    email: clean(r.email), phone: clean(r.phone), company: null,
    purpose: "AI event attendee (AI Bottleneck Workshop 6/15/26)", segment: clean(r.segment),
    consent_status: r.relationship_flag === "INSIDER" ? "do_not_bulk" : "opt_in",
    owner: "Collin", notes: clean([r.relationship_flag, r.notes].filter(Boolean).join(" — ")), raw: r,
  }));
  const n = await upsert(out);
  console.log(`  collins_world: ${rows.length} rows → ${n}`);
  return n;
}

// ====================== Personal (Google Contacts) ======================
async function importPersonal() {
  const rows = csvObjects(CONFIG.googleContacts);
  if (!rows) { console.log("  personal: contacts.csv not found — skipped"); return 0; }
  const g = (r, k) => clean(r[k]);
  const out = [];
  rows.forEach((r, idx) => {
    const email = g(r, "E-mail 1 - Value");
    const phone = g(r, "Phone 1 - Value");
    if (!email && !phone) return; // need at least one reachable handle
    const first = g(r, "First Name"), last = g(r, "Last Name");
    out.push({
      source: "personal", source_id: normEmail(email) || normPhone(phone) || `gc-${idx}`,
      first_name: first, last_name: last,
      full_name: clean([first, g(r, "Middle Name"), last].filter(Boolean).join(" ")) || g(r, "Organization Name"),
      email, phone, company: g(r, "Organization Name"),
      purpose: "Personal / Google contact", segment: g(r, "Labels"),
      consent_status: "unknown", owner: "Collin", notes: g(r, "Notes"), raw: null,
    });
  });
  const n = await upsert(out);
  console.log(`  personal: ${rows.length} rows (${out.length} with email/phone) → ${n}`);
  return n;
}

// ====================== LeavenWealth (GHL) ======================
async function importLeavenwealth() {
  const rows = csvObjects(CONFIG.ghlLeavenwealth);
  if (!rows) { console.log("  leavenwealth: GHL csv not found — skipped"); return 0; }
  const out = [];
  rows.forEach((r, idx) => {
    const email = normEmail(r.email);
    if (!email && !normPhone(r.phone)) return;
    out.push({
      source: "leavenwealth", source_id: `lw-${email || idx}`,
      first_name: clean(r.first_name), last_name: clean(r.last_name),
      full_name: clean([r.first_name, r.last_name].filter(Boolean).join(" ")),
      email: clean(r.email), phone: clean(r.phone), company: null,
      purpose: "LeavenWealth lead / contact (GHL)", segment: clean(r.segment),
      consent_status: consentFrom(r.consent_status, r.relationship_flag, r.segment),
      owner: "LeavenWealth", notes: clean([r.relationship_flag, r.notes].filter(Boolean).join(" — ")), raw: r,
    });
  });
  const n = await upsert(out);
  console.log(`  leavenwealth: ${rows.length} rows → ${n}`);
  return n;
}

// ====================== Legacy RE (COLD) ======================
async function importLegacyRe() {
  const rows = csvObjects(CONFIG.legacyRe);
  if (!rows) { console.log("  legacy_re: csv not found — skipped"); return 0; }
  const out = [];
  rows.forEach((r, idx) => {
    const email = normEmail(r.email);
    if (!email && !normPhone(r.phone)) return;
    out.push({
      source: "legacy_re", source_id: `legacy-${email || idx}`,
      first_name: clean(r.first_name), last_name: clean(r.last_name),
      full_name: clean([r.first_name, r.last_name].filter(Boolean).join(" ")),
      email: clean(r.email), phone: clean(r.phone), company: null,
      purpose: "Legacy RE master list", segment: clean(r.category) || "legacy",
      consent_status: "do_not_bulk", // unverified legacy — never bulk email
      owner: "Collin", notes: null, raw: r,
    });
  });
  const n = await upsert(out);
  console.log(`  legacy_re: ${rows.length} rows → ${n}`);
  return n;
}

// ====================== Wholesalers + Brokers ======================
function importPartners() {
  const out = [];
  // Wholesalers: parse the markdown table (Source | Contact | Tier | Last touch | Notes)
  if (existsSync(CONFIG.wholesalers)) {
    const lines = readFileSync(CONFIG.wholesalers, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length < 3) continue;
      const name = cells[0].replace(/\*\*/g, "").trim();
      if (!name || /^source$/i.test(name) || /^-+$/.test(name)) continue;
      const contact = cells[1] || "";
      const email = (contact.match(/[\w.+-]+@[\w.-]+\.\w+/) || [])[0] || null;
      const phone = (contact.match(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/) || [])[0] || null;
      if (!email && !phone) continue; // skip "need direct contact" rows
      out.push({
        source: "partners", source_id: `wholesaler-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        first_name: null, last_name: null, full_name: name,
        email, phone, company: name, purpose: "Wholesaler (deal sourcing)",
        segment: clean(cells[2]) || "wholesaler", consent_status: "unknown",
        owner: "Acreage / Sourcing", notes: clean(cells[cells.length - 1]), raw: { row: cells },
      });
    }
  }
  // Brokers: outreach-queue-enriched.csv
  const brokers = csvObjects(CONFIG.brokers) || [];
  brokers.forEach((r, idx) => {
    const email = normEmail(r.broker_email);
    if (!email && !normPhone(r.phone)) return;
    out.push({
      source: "partners", source_id: `broker-${email || idx}`,
      first_name: null, last_name: null, full_name: clean(r.broker_name),
      email: clean(r.broker_email), phone: clean(r.phone), company: clean(r.broker_company),
      purpose: "CRE broker (acquisitions)", segment: clean(r.target_market) || "broker",
      consent_status: "unknown", owner: "LeavenWealth / Acq",
      notes: clean([r.status, r.notes].filter(Boolean).join(" — ")), raw: r,
    });
  });
  return upsert(out).then((n) => { console.log(`  partners: ${out.length} (wholesalers + brokers) → ${n}`); return n; });
}

// ====================== Owners (deal-engine / DCC) ======================
async function fetchAll(dcc, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await dcc.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function importOwners() {
  const url = process.env.DCC_SUPABASE_URL, key = process.env.DCC_SUPABASE_KEY;
  if (!url || !key) { console.log("  owners: DCC creds missing — skipped"); return 0; }
  const dcc = createClient(url, key, { auth: { persistSession: false } });

  const props = await fetchAll(dcc, "hub_property", "id,property_type,display_address,city,state,zip,units,est_market_value");
  const links = await fetchAll(dcc, "hub_property_owner", "property_id,owner_id");
  const owners = await fetchAll(dcc, "hub_owner", "id,display_name,entity_type,mailing_address,absentee");
  const oc = await fetchAll(dcc, "owner_contacts", "owner_id,contact_type,value,dnc,is_primary");

  const propById = new Map(props.map((p) => [p.id, p]));
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const types = new Map(); // owner_id -> { sfr, mf, prop }
  for (const l of links) {
    const p = propById.get(l.property_id); if (!p) continue;
    const e = types.get(l.owner_id) || { sfr: false, mf: false, prop: null };
    if (p.property_type === "sfr") e.sfr = true;
    if (p.property_type === "multifamily") { e.mf = true; if (!e.prop || e.prop.property_type !== "multifamily") e.prop = p; }
    if (!e.prop) e.prop = p;
    types.set(l.owner_id, e);
  }
  const phones = new Map(), emails = new Map();
  for (const c of oc) {
    const m = c.contact_type === "phone" ? phones : c.contact_type === "email" ? emails : null;
    if (!m) continue;
    const a = m.get(c.owner_id) || []; a.push(c); m.set(c.owner_id, a);
  }

  const mf = [], sf = [];
  for (const [ownerId, t] of types) {
    const ph = (phones.get(ownerId) || []).slice().sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
    if (!ph.length) continue; // owners WITH phone numbers only
    const o = ownerById.get(ownerId); if (!o) continue;
    const em = emails.get(ownerId) || [];
    const callable = ph.some((p) => p.dnc === false);
    const prop = t.prop;
    const mk = (source, kind) => ({
      source, source_id: `owner-${ownerId}`,
      first_name: null, last_name: null, full_name: clean(o.display_name),
      email: clean(em[0]?.value) || null, phone: clean(ph[0].value),
      company: o.entity_type && o.entity_type !== "individual" ? clean(o.display_name) : null,
      purpose: `${kind} property owner (off-market sourcing)`,
      segment: callable ? "callable" : "all-DNC",
      consent_status: "do_not_bulk",
      owner: "Acreage / Deal Engine",
      notes: clean([
        [prop?.display_address, prop?.city, prop?.state].filter(Boolean).join(", "),
        ph.length > 1 ? `${ph.length} phones` : null,
        callable ? null : "ALL phones DNC-flagged",
        o.absentee ? "absentee" : null,
      ].filter(Boolean).join(" · ")),
      raw: { owner: o, property: prop, phones: ph, emails: em },
    });
    if (t.mf) mf.push(mk("multifamily_owners", "Multifamily"));
    if (t.sfr) sf.push(mk("single_family_owners", "Single-family"));
  }
  const n = (await upsert(mf)) + (await upsert(sf));
  console.log(`  owners: ${mf.length} MF + ${sf.length} SF (with phones) → ${n}`);
  return n;
}

// ====================== Vince's list (3rd-party) ======================
async function importVince() {
  const rows = csvObjects(CONFIG.vince);
  if (!rows) { console.log("  vince: csv not found — skipped"); return 0; }
  const out = [];
  rows.forEach((r, idx) => {
    const email = normEmail(r.Email), phone = normPhone(r.Phone);
    if (!email && !phone) return;
    out.push({
      source: "vince", source_id: email || phone || `vince-${idx}`,
      first_name: clean(r["First Name"]), last_name: clean(r["Last Name"]),
      full_name: clean(r["Full Name"]), email: clean(r.Email), phone: clean(r.Phone),
      company: clean(r.Company), purpose: "Vince's contact list (3rd-party)",
      segment: clean(r.Title) || "vince-list", consent_status: "do_not_bulk",
      owner: "Vince (3rd-party)", notes: clean(r.Notes), raw: null,
    });
  });
  const n = await upsert(out);
  console.log(`  vince: ${rows.length} rows (${out.length} reachable) → ${n}`);
  return n;
}

// ====================== Austin's list (3rd-party) ======================
async function importAustin() {
  const rows = csvObjects(CONFIG.austin);
  if (!rows) { console.log("  austin: csv not found — skipped"); return 0; }
  const out = [];
  rows.forEach((r, idx) => {
    const email = normEmail(r["Email Address"]), phone = normPhone(r["Phone Number"]);
    if (!email && !phone) return;
    out.push({
      source: "austin", source_id: email || phone || `austin-${idx}`,
      first_name: clean(r["First Name"]), last_name: clean(r["Last Name"]),
      full_name: clean([r["First Name"], r["Last Name"]].filter(Boolean).join(" ")),
      email: clean(r["Email Address"]), phone: clean(r["Phone Number"]), company: null,
      purpose: "Austin Croghan investor list (Mailchimp, 3rd-party)", segment: "mailchimp",
      consent_status: "do_not_bulk", owner: "Austin Croghan (3rd-party)", notes: null, raw: null,
    });
  });
  const n = await upsert(out);
  console.log(`  austin: ${rows.length} rows (${out.length} reachable) → ${n}`);
  return n;
}

// ====================== macOS Contacts (vCard) → business vs other ======================
function parseVcards(text) {
  const cards = [];
  let card = null, cur = null, skip = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) { if (!skip && cur) cur.val += raw.slice(1); continue; }
    if (cur && card) { card.push(cur); cur = null; }
    skip = false;
    if (/^BEGIN:VCARD/i.test(raw)) { card = []; continue; }
    if (/^END:VCARD/i.test(raw)) { if (card) cards.push(card); card = null; continue; }
    const idx = raw.indexOf(":"); if (idx < 0) continue;
    const name = raw.slice(0, idx);
    if (/^PHOTO/i.test(name)) { skip = true; continue; } // drop base64 photo blobs
    cur = { base: name.replace(/^item\d+\./i, "").split(";")[0].toUpperCase(), val: raw.slice(idx + 1) };
  }
  return cards;
}

async function importVcard() {
  if (!existsSync(CONFIG.vcard)) { console.log("  vcard: MasterContacts.vcf not found — skipped"); return 0; }
  const cards = parseVcards(readFileSync(CONFIG.vcard, "utf8"));
  const biz = [], other = [];
  cards.forEach((props, idx) => {
    const get = (b) => props.find((p) => p.base === b)?.val || "";
    const getAll = (b) => props.filter((p) => p.base === b).map((p) => p.val);
    const fn = clean(get("FN"));
    const nParts = get("N").split(";"); // Last;First;Middle;Prefix;Suffix
    const email = (getAll("EMAIL")[0] || "").trim() || null;
    const phone = (getAll("TEL")[0] || "").trim() || null;
    if (!email && !phone && !fn) return;
    const org = clean(get("ORG").replace(/;+\s*$/, "")), title = clean(get("TITLE")), note = clean(get("NOTE"));
    const hay = [org, title, note].filter(Boolean).join(" ");
    let isBiz = true, segment;
    if (RE_KW.test(hay)) segment = "real estate";
    else if (TRADES_KW.test(hay)) segment = "trades";
    else if (org || title) segment = "business";
    else { isBiz = false; segment = "personal"; }
    const row = {
      source: isBiz ? "network_business" : "other",
      source_id: normEmail(email) || normPhone(phone) || `vcf-${idx}`,
      first_name: clean(nParts[1]), last_name: clean(nParts[0]),
      full_name: fn || clean([nParts[1], nParts[0]].filter(Boolean).join(" ")),
      email, phone, company: org,
      purpose: isBiz ? `Network — ${segment}` : "Personal contact (not business)",
      segment, consent_status: "unknown", owner: "Collin",
      notes: clean([title, note].filter(Boolean).join(" · ")), raw: null,
    };
    (isBiz ? biz : other).push(row);
  });
  const n = (await upsert(biz)) + (await upsert(other));
  console.log(`  vcard: ${cards.length} cards → ${biz.length} business / ${other.length} other → ${n}`);
  return n;
}

// ====================== ClickUp workspace members ======================
async function importClickup() {
  const p = join(process.cwd(), "scripts", "data", "clickup-members.json");
  if (!existsSync(p)) { console.log("  clickup: snapshot not found — skipped"); return 0; }
  const rows = JSON.parse(readFileSync(p, "utf8"));
  const wsLabel = { LW: "LeavenWealth", PGO: "Point Guard Omaha", Both: "LeavenWealth + PGO" };
  const out = rows.filter((r) => r.email).map((r) => {
    const domain = (r.email.split("@")[1] || "").split(".")[0];
    return {
      source: "clickup", source_id: normEmail(r.email),
      first_name: clean(r.name?.split(" ")[0]), last_name: clean(r.name?.split(" ").slice(1).join(" ")),
      full_name: clean(r.name), email: clean(r.email), phone: null,
      company: domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : null,
      purpose: "ClickUp workspace member (team / vendor / partner)",
      segment: wsLabel[r.ws] || "ClickUp", consent_status: "unknown",
      owner: "Collin", notes: `Workspace: ${wsLabel[r.ws] || r.ws}`, raw: r,
    };
  });
  const n = await upsert(out);
  console.log(`  clickup: ${rows.length} members → ${n}`);
  return n;
}

// ============== Mail-mined business contacts (Gmail / Outlook) ==============
// Reads a pipe-delimited snapshot:  email|name|domain|category|sample_subject
function importMail(source, file, ownerLabel) {
  return async () => {
    const p = join(process.cwd(), "scripts", "data", file);
    if (!existsSync(p)) { console.log(`  ${source}: ${file} not found — skipped`); return 0; }
    const lines = readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      if (/^email\s*\|/i.test(line)) continue; // skip a header if present
      const [email, name, domain, category, subject] = line.split("|").map((s) => (s || "").trim());
      if (!normEmail(email)) continue;
      const company = domain && !/gmail|yahoo|hotmail|icloud|aol|outlook\.com/i.test(domain)
        ? domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()) : null;
      out.push({
        source, source_id: normEmail(email),
        first_name: clean(name?.split(" ")[0]), last_name: clean(name?.split(" ").slice(1).join(" ")),
        full_name: clean(name) || clean(email), email: clean(email), phone: null, company,
        purpose: `${ownerLabel} business contact (email correspondence)`,
        segment: clean(category) || "business", consent_status: "unknown", owner: "Collin",
        notes: clean(subject ? `re: ${subject}` : null), raw: null,
      });
    }
    const n = await upsert(out);
    console.log(`  ${source}: ${lines.length} lines → ${n}`);
    return n;
  };
}

// ====================== Wholesalers / cash buyers ======================
async function importWholesalers() {
  const p = join(process.cwd(), "scripts", "data", "wholesalers.json");
  if (!existsSync(p)) { console.log("  wholesalers: snapshot not found — skipped"); return 0; }
  const rows = JSON.parse(readFileSync(p, "utf8"));
  const out = rows.map((r, idx) => {
    const email = normEmail(r.email);
    const slug = (r.company || `w-${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      source: "wholesalers", source_id: email || `wh-${slug}`,
      first_name: null, last_name: null, full_name: clean(r.contact) || clean(r.company),
      email: clean(r.email), phone: clean(r.phone), company: clean(r.company),
      purpose: "Wholesaler / cash-buyer (deal sourcing)",
      segment: (r.priority ? "⭐ " : "") + (clean(r.city) || "wholesaler"),
      consent_status: "unknown", owner: "Acreage / Sourcing", notes: clean(r.notes), raw: r,
    };
  });
  const n = await upsert(out);
  console.log(`  wholesalers: ${rows.length} → ${n}`);
  return n;
}

// ============================ main ============================
const jobs = {
  lendr: importLendr, titan: importTitan, collins_world: importCollinsWorld,
  personal: importPersonal, leavenwealth: importLeavenwealth, legacy_re: importLegacyRe,
  partners: importPartners, owners: importOwners,
  vince: importVince, austin: importAustin, vcard: importVcard, clickup: importClickup,
  gmail: importMail("gmail", "gmail-business.txt", "Gmail"),
  outlook: importMail("outlook", "outlook-business.txt", "Outlook"),
  wholesalers: importWholesalers,
};
const args = process.argv.slice(2).map((s) => s.toLowerCase());
const run = !args.length || args[0] === "all" ? Object.keys(jobs) : args;
console.log(`contacts-import: ${run.join(", ")}`);
let total = 0;
for (const key of run) {
  if (!jobs[key]) { console.error(`  unknown source "${key}"`); continue; }
  try { total += await jobs[key](); }
  catch (e) { console.error(`  ${key} FAILED: ${e.message}`); }
}
console.log(`contacts-import: done — ${total} contacts upserted.`);
process.exit(0);
