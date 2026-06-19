import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireOwner } from "@/lib/auth";

// Triggers the LOCAL text-intel pipeline (extract → filter → classify → digest)
// from the Jarvis Texts tab. Localhost-only by design: the raw iMessage data
// lives only on this Mac, so this route hard-refuses to run on Vercel/any cloud.
// Ollama does the classification entirely on-device — nothing leaves the machine.

const VAULT = path.join(os.homedir(), "text-intel-vault");
const LOCK = path.join(VAULT, "classify.lock");
const LOG = path.join(VAULT, "daily.log");
const MANIFEST = path.join(VAULT, "classify-manifest.json");
const PIPELINE = path.join(os.homedir(), "Documents", "my-ai-team", "text-intel");
const SCRIPT = path.join(PIPELINE, "scripts", "run-daily.sh");

// Block any cloud execution outright. process.env.VERCEL is set on every
// Vercel deployment; if it's present we are NOT on Collin's Mac.
function cloudBlocked(): NextResponse | null {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return NextResponse.json(
      { ok: false, error: "Disabled in cloud. Run Jarvis locally on your Mac to classify." },
      { status: 403 },
    );
  }
  return null;
}

function lastRun(): string | null {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).when ?? null;
  } catch {
    return null;
  }
}

function logTail(lines = 12): string {
  try {
    const all = fs.readFileSync(LOG, "utf8").trimEnd().split("\n");
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// POST = start a run (no-op if one is already in flight).
export async function POST(req: NextRequest) {
  const blocked = cloudBlocked();
  if (blocked) return blocked;
  try {
    await requireOwner();

    if (fs.existsSync(LOCK)) {
      return NextResponse.json({ ok: true, started: false, running: true });
    }
    if (!fs.existsSync(SCRIPT)) {
      return NextResponse.json(
        { ok: false, error: `Pipeline not found at ${SCRIPT}` },
        { status: 404 },
      );
    }

    let days = 3;
    try {
      const body = await req.json();
      const d = Number(body?.days);
      if ([1, 3, 7, 30].includes(d)) days = d;
    } catch {}

    fs.mkdirSync(VAULT, { recursive: true });
    fs.writeFileSync(LOCK, new Date().toISOString());

    // Detached so the HTTP request returns immediately. The trap guarantees the
    // lock is cleared whether the run succeeds or fails. run-daily.sh writes its
    // own output to daily.log.
    const child = spawn(
      "bash",
      ["-c", `trap 'rm -f "${LOCK}"' EXIT; bash "${SCRIPT}" ${days}`],
      { cwd: PIPELINE, detached: true, stdio: "ignore" },
    );
    child.unref();

    return NextResponse.json({ ok: true, started: true, running: true, days });
  } catch (e) {
    try {
      fs.rmSync(LOCK, { force: true });
    } catch {}
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// GET = poll status (is a run in flight? when did the last one finish?).
export async function GET() {
  const blocked = cloudBlocked();
  if (blocked) return blocked;
  try {
    await requireOwner();
    return NextResponse.json({
      ok: true,
      running: fs.existsSync(LOCK),
      lastRun: lastRun(),
      log: logTail(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
