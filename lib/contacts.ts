import { supabaseAdmin } from "./supabase";

// ---------- Collin's World CRM (unified contacts) ----------
// Read layer for the /contacts module. Server-side only (supabaseAdmin).

export type ConsentStatus = "opt_in" | "unknown" | "do_not_bulk";

export type Contact = {
  id: string;
  source: string;
  source_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_norm: string | null;
  phone: string | null;
  phone_norm: string | null;
  company: string | null;
  purpose: string | null;
  segment: string | null;
  consent_status: ConsentStatus;
  owner: string | null;
  date_added: string;
  last_touch: string | null;
  notes: string | null;
  raw: unknown;
  created_at: string;
  updated_at: string;
};

// The contact pools that feed the CRM, in tab order. `key` matches contacts.source.
//   cold        — not opt-in; imports flagged do_not_bulk (consent guardrail).
//   captureOnly — can't be imported (FB blocks export); fills via opt-in over time.
export const CONTACT_SOURCES = [
  { key: "collins_world",       label: "Collin's World", blurb: "Event attendees + opt-ins — the owned authority list" },
  { key: "personal",            label: "Personal",       blurb: "Your Google / phone contacts export" },
  { key: "network_business",    label: "Network (RE/Biz)", blurb: "macOS contacts tagged real estate / investor / developer / trades / business" },
  { key: "other",               label: "Other (Not Biz)",  blurb: "macOS contacts that are not business-related (personal / family / friends)" },
  { key: "lendr",               label: "Liquid Lending", blurb: "LLS / MASC borrowers, investors + leads" },
  { key: "leavenwealth",        label: "LeavenWealth",   blurb: "LeavenWealth leads + contacts (GHL)" },
  { key: "titan",               label: "Titan",          blurb: "Titan Mastermind members, advisors, founders" },
  { key: "wholesalers",         label: "Wholesalers",    blurb: "Omaha/Lincoln/CB wholesalers + cash buyers (Acreage deal sourcing)" },
  { key: "partners",            label: "Brokers/Partners", blurb: "CRE brokers + deal-sourcing partners" },
  { key: "clickup",             label: "ClickUp",        blurb: "LeavenWealth + PGO workspace members (team / vendors / partners)" },
  { key: "gmail",               label: "Gmail",          blurb: "Business people you correspond with in Gmail (mined from sent + received mail)" },
  { key: "outlook",             label: "Outlook",        blurb: "Business people you correspond with in Outlook / M365 (mined from mail)" },
  { key: "buildium",            label: "Buildium",       blurb: "PGO tenants — no email/phone in the current export (resident data pending John's grant)", captureOnly: true },
  { key: "legacy_re",           label: "Legacy RE",      blurb: "Cleaned legacy real-estate master list", cold: true },
  { key: "multifamily_owners",  label: "Multifamily Owners",  blurb: "Off-market MF owners w/ phone (skip-traced) — carries DNC flag", cold: true },
  { key: "single_family_owners",label: "Single-Family Owners",blurb: "Off-market SFR owners w/ phone (skip-traced) — carries DNC flag", cold: true },
  { key: "vince",               label: "Vince's List",   blurb: "Vince's phone contacts — 3rd-party import", cold: true },
  { key: "austin",              label: "Austin's List",  blurb: "Austin Croghan investor / Mailchimp list — 3rd-party import", cold: true },
  { key: "fb_meetup",           label: "FB Meetup",      blurb: "Omaha RE Meetup group — capture-over-time; FB blocks export", captureOnly: true },
] as const;

export type ContactSourceKey = (typeof CONTACT_SOURCES)[number]["key"];

export function sourceMeta(key: string) {
  return CONTACT_SOURCES.find((s) => s.key === key);
}

// Supabase caps a single .select() at 1000 rows server-side, so we page with
// .range() to pull a full source tab (which can be thousands of rows).
async function fetchPaged(source: string | undefined, cap: number): Promise<Contact[]> {
  const rows: Contact[] = [];
  const seen = new Set<string>();
  for (let from = 0; from < cap; from += 1000) {
    let q = supabaseAdmin().from("contacts").select("*");
    if (source) q = q.eq("source", source);
    // Order by a UNIQUE tiebreaker (id) alongside updated_at: bulk imports stamp a
    // whole batch with the same updated_at, and .range() paging over a non-unique
    // sort returns the same row on two pages → React duplicate-key crash.
    const { data } = await q
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data as Contact[]) {
      if (seen.has(r.id)) continue; // defensive: never emit the same id twice
      seen.add(r.id);
      rows.push(r);
    }
    if (data.length < 1000) break;
  }
  return rows;
}

// Rows for a source tab (all of them, paged). For the master view (no source) we
// pull a bounded page to dedupe for display — the true distinct count comes from
// getContactStats(), not from counting these rows.
export async function getContacts(source?: string): Promise<Contact[]> {
  return fetchPaged(source, source ? 8000 : 3000);
}

// Per-source counts via a DB view (aggregated server-side, so NOT subject to the
// 1000-row select cap that made the old client-side count read "~1000").
export async function getContactCounts(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin().from("v_contact_source_counts").select("source,n");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { source: string; n: number }[]) counts[row.source] = row.n;
  return counts;
}

export type ContactStats = { total: number; distinct_people: number; sources: number };
export async function getContactStats(): Promise<ContactStats> {
  const { data } = await supabaseAdmin().from("v_contact_stats").select("*").maybeSingle();
  return (data as ContactStats) ?? { total: 0, distinct_people: 0, sources: 0 };
}

// "All People" master view: collapse rows sharing a normalized email (or phone,
// when no email) into one identity, remembering every source it appeared in.
export type MergedContact = Contact & { sources: string[]; mergedCount: number };

export function dedupe(rows: Contact[]): MergedContact[] {
  const byKey = new Map<string, MergedContact>();
  const standalone: MergedContact[] = [];

  for (const r of rows) {
    const key = r.email_norm || (r.phone_norm ? `tel:${r.phone_norm}` : null);
    if (!key) {
      standalone.push({ ...r, sources: [r.source], mergedCount: 1 });
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r, sources: [r.source], mergedCount: 1 });
    } else {
      // Keep the richest record; union the sources; opt_in/do_not_bulk beat unknown.
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
      existing.mergedCount += 1;
      existing.phone = existing.phone || r.phone;
      existing.full_name = existing.full_name || r.full_name;
      existing.company = existing.company || r.company;
      existing.purpose = existing.purpose || r.purpose;
      if (existing.consent_status === "unknown" && r.consent_status !== "unknown") {
        existing.consent_status = r.consent_status;
      }
    }
  }
  return [...byKey.values(), ...standalone];
}
