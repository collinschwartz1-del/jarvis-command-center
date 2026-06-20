import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type IntelCard = {
  thread: string;
  contact: string;
  isGroup?: boolean;
  msgCount: number;
  lastTs: number;
  lastIso: string | null;
  lastFromMe: boolean;
  is_business: boolean;
  category:
    | "hot-lead"
    | "opportunity"
    | "owed-reply"
    | "problem"
    | "theme"
    | "business-idea"
    | "self-coaching"
    | "none";
  priority: "high" | "medium" | "low";
  summary: string;
  suggested_action: string;
  owed_reply: boolean;
  suggested_reply: string;
  entities: string[];
  // set by reconcile.mjs (fast, local) between full classify runs:
  replied?: boolean; // you replied in Messages since this was classified
  repliedAt?: string | null; // ISO of your reply (shown today, fades next day)
  newInbound?: boolean; // they texted back after this card was made — your move
};

const VAULT = path.join(os.homedir(), "text-intel-vault");
const CARDS = path.join(VAULT, "intel", "cards.json");
const MANIFEST = path.join(VAULT, "classify-manifest.json");

export function getTextIntel(): {
  cards: IntelCard[];
  generatedAt: string | null;
  available: boolean;
} {
  try {
    const cards: IntelCard[] = JSON.parse(fs.readFileSync(CARDS, "utf8"));
    let generatedAt: string | null = null;
    try {
      generatedAt = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).when ?? null;
    } catch {}
    return { cards, generatedAt, available: true };
  } catch {
    return { cards: [], generatedAt: null, available: false };
  }
}

export const CATEGORY_META: Record<
  IntelCard["category"],
  { label: string; icon: string; order: number }
> = {
  "hot-lead": { label: "Hot Leads", icon: "🔥", order: 0 },
  opportunity: { label: "Opportunities", icon: "💰", order: 1 },
  "owed-reply": { label: "Owed Replies", icon: "↩️", order: 2 },
  problem: { label: "Problems / Fires", icon: "⚠️", order: 3 },
  "business-idea": { label: "Business Ideas", icon: "💡", order: 4 },
  theme: { label: "Themes", icon: "📊", order: 5 },
  "self-coaching": { label: "Self-Coaching", icon: "🎯", order: 6 },
  none: { label: "Other", icon: "·", order: 7 },
};
