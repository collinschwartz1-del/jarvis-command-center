// Shared Google helpers for headless reports: OAuth token (refresh-token grant),
// HTML→Drive PDF, and Gmail send. Scopes needed on the refresh token:
// drive.file + gmail.compose (compose can both draft and send).

export async function googleToken() {
  const id = process.env.GMAIL_CLIENT_ID;
  const secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Google creds absent (need drive.file + gmail.compose).");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

function multipart(metadata, mediaType, media, boundary) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`
  );
  return Buffer.concat([head, Buffer.from(media), Buffer.from(`\r\n--${boundary}--`)]);
}

// Renders HTML to a Google Doc, exports it to PDF, uploads the PDF (optionally to
// a folder), deletes the temp Doc, and returns { id, webViewLink }.
export async function htmlToDrivePdf(token, html, name, folderId) {
  const b = "jarvis_boundary_x";
  const docBody = multipart({ name: `${name} (tmp)`, mimeType: "application/vnd.google-apps.document" }, "text/html", html, b);
  const docRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${b}` }, body: docBody,
  });
  if (!docRes.ok) throw new Error(`drive doc create ${docRes.status}: ${await docRes.text()}`);
  const docId = (await docRes.json()).id;

  const pdfRes = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!pdfRes.ok) throw new Error(`drive export ${pdfRes.status}: ${await pdfRes.text()}`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());

  const meta = { name: `${name}.pdf`, mimeType: "application/pdf" };
  if (folderId) meta.parents = [folderId];
  const upBody = multipart(meta, "application/pdf", pdf, b);
  const upRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${b}` }, body: upBody,
  });
  if (!upRes.ok) throw new Error(`drive pdf upload ${upRes.status}: ${await upRes.text()}`);
  const out = await upRes.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  return out;
}

export async function sendEmail(token, to, subject, html) {
  const raw = [`To: ${to}`, "Content-Type: text/html; charset=UTF-8", "MIME-Version: 1.0", `Subject: ${subject}`, "", html].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: encoded }),
  });
  if (!r.ok) throw new Error(`gmail send ${r.status}: ${await r.text()}`);
  return r.json();
}

// ISO week id, e.g. 2026-W26
export function weekId(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
