import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { requireOwner } from "@/lib/auth";

// Runs the FAST local reconcile (scripts/reconcile.mjs): re-checks the latest
// message per existing text card against chat.db and updates reply state. No AI,
// ~seconds. Localhost-only by design (reads chat.db, which never leaves the Mac).
const PIPELINE = path.join(os.homedir(), "Documents", "my-ai-team", "text-intel");
const SCRIPT = path.join(PIPELINE, "scripts", "reconcile.mjs");

export async function POST() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return NextResponse.json(
      { ok: false, error: "Disabled in cloud — run Jarvis locally." },
      { status: 403 }
    );
  }
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return new Promise<NextResponse>((resolve) => {
    let out = "";
    let err = "";
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: PIPELINE,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
      },
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(
        NextResponse.json({ ok: false, error: "reconcile timed out" }, { status: 504 })
      );
    }, 30000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(NextResponse.json({ ok: false, error: String(e) }, { status: 500 }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(
          NextResponse.json(
            { ok: false, error: err.trim().slice(-200) || `exit ${code}` },
            { status: 500 }
          )
        );
        return;
      }
      let stats: Record<string, unknown> = {};
      try {
        const line = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
        stats = JSON.parse(line);
      } catch {}
      resolve(NextResponse.json({ ok: true, ...stats }));
    });
  });
}
