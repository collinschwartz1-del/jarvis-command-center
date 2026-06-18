// One-time Gmail auth — mints the refresh token intel.mjs needs.
//
// Prereq (one-time, in Google Cloud Console — you already have a project from
// the Places API work): APIs & Services → Credentials → Create OAuth client ID
// → type "Desktop app". Copy the client ID + secret into .env.local as
// GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET. Also enable the "Gmail API" for the
// project. Then run:  npm run gmail-auth
//
// This opens your browser, you click "Allow" (read-only Gmail), and it captures
// the code on localhost and writes GMAIL_REFRESH_TOKEN straight into .env.local
// (the token is never printed). No copy/paste of codes by hand.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { exec } from "node:child_process";

function loadEnv() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const ID = process.env.GMAIL_CLIENT_ID;
const SECRET = process.env.GMAIL_CLIENT_SECRET;
if (!ID || !SECRET) {
  console.error(
    "Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env.local.\n" +
      "Create a Desktop-app OAuth client in Google Cloud Console first, then add them."
  );
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
// gmail.readonly  → intel.mjs + LLS sync read mail
// gmail.compose   → LLS Borrower Inbox saves reply DRAFTS (never auto-sends)
// drive.file      → LLS monthly report uploads its PDF to Drive
const SCOPE = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");
const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

const server = createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) { res.end("No code."); return; }
  res.end("Gmail authorized. You can close this tab and return to the terminal.");
  server.close();
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: ID, client_secret: SECRET,
      redirect_uri: REDIRECT, grant_type: "authorization_code",
    }),
  }).then((r) => r.json());
  if (!tok.refresh_token) {
    console.error("No refresh_token returned:", tok);
    process.exit(1);
  }
  // Write the token straight into .env.local — never print it (avoids the
  // secret leaking into terminal scrollback / shared transcripts).
  const envPath = join(process.cwd(), ".env.local");
  const line = `GMAIL_REFRESH_TOKEN=${tok.refresh_token}`;
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (/^#?\s*GMAIL_REFRESH_TOKEN=.*$/m.test(env)) {
    env = env.replace(/^#?\s*GMAIL_REFRESH_TOKEN=.*$/m, line);
  } else {
    env += (env.endsWith("\n") || env === "" ? "" : "\n") + line + "\n";
  }
  writeFileSync(envPath, env);
  console.log("\n✅ Success. GMAIL_REFRESH_TOKEN written to .env.local (value not shown).\n");
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening Google consent screen… click Allow (Gmail read + compose drafts, Drive files).");
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${authUrl}"`);
});
