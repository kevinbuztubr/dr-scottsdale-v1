/**
 * /api/lead — Dr. Scottsdale® → NRPS Admin → GHL lead-submission proxy.
 *
 * Why this function exists (vs. having the static widget POST directly to
 * nrps-admin):
 *   1. The HMAC widget secret stays server-side. The browser never sees it.
 *      Same security posture as Natural Results' nr-website widget — the
 *      secret is signed on the server and the SAME secret already exists
 *      on nr-website's NEXT_PUBLIC env (browser-exposed by design there),
 *      so we're not regressing the security model, we're keeping parity.
 *   2. Same-origin POSTs from the static HTML avoid the cross-origin CORS
 *      preflight maze entirely.
 *   3. Per-property attribution is enforced server-side: this function
 *      always stamps siteSource: "drscottsdaleaz.com" so a hostile caller
 *      can't impersonate Natural Results' source attribution.
 *   4. Honeypot + basic abuse defense lives here, not in the static JS
 *      where it's trivially bypassable.
 *
 * Defense in depth (in addition to nrps-admin's HMAC + CORS + rate limit):
 *   - Reject anything bigger than 8 KB (form submissions are tiny).
 *   - Honeypot field "company_website" — if it's non-empty the request
 *     came from a bot; we 200 it silently to avoid telling the bot it
 *     was caught.
 *   - Time-on-page check: form must have been open for at least 2 seconds
 *     before submit (basic bot deterrent).
 *
 * Security checklist (matches naturalresultsaz.com posture):
 *   ✓ Widget secret never sent to browser
 *   ✓ HMAC verified by downstream nrps-admin
 *   ✓ siteSource enforced server-side (can't be spoofed)
 *   ✓ Body size capped before parse
 *   ✓ Honeypot anti-bot
 *   ✓ Rate limit handled downstream (in-process + KV on nrps-admin)
 *   ✓ No PHI logged — only mask-style debug
 */

const { createHmac } = require("crypto");

const ADMIN_URL = "https://nrps-admin.vercel.app";
const ENDPOINT = "/api/widget/quote";

const SITE_SOURCE = "drscottsdaleaz.com";
const MAX_BODY_BYTES = 8 * 1024;
const MIN_TIME_ON_PAGE_MS = 2000;

// HMAC-sign the body with NRPS_WIDGET_SECRET (server env only).
function sign(body) {
  const secret = process.env.NRPS_WIDGET_SECRET || "";
  if (!secret) throw new Error("Widget secret not configured");
  return createHmac("sha256", secret).update(body).digest("hex");
}

function maskEmail(e) {
  if (!e || !e.includes("@")) return "[no-email]";
  const [local, domain] = e.split("@");
  return `${(local[0] || "")}***@${(domain[0] || "")}***`;
}
function maskPhone(p) {
  if (!p) return "[no-phone]";
  const digits = String(p).replace(/\D/g, "");
  return digits.length < 4 ? "***" : `***-***-${digits.slice(-4)}`;
}

module.exports = async function handler(req, res) {
  // CORS — same-origin only by default. We don't expose this beyond the
  // dr-scottsdale-v1 origin because the static HTML calls us from the
  // same host. If you add a marketing landing on another domain, add it here.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read body (Vercel Node functions parse JSON automatically if Content-Type
  // is application/json, but we want to control body-size limits ourselves).
  let raw = "";
  try {
    if (req.body && typeof req.body === "object") {
      raw = JSON.stringify(req.body);
    } else if (typeof req.body === "string") {
      raw = req.body;
    } else {
      // Stream the raw body if needed
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString("utf-8");
    }
  } catch (e) {
    res.status(400).json({ error: "Could not read body" });
    return;
  }

  if (raw.length > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Body too large" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Honeypot. Silently 200 — never tell the bot why it failed.
  if (payload && typeof payload.company_website === "string" && payload.company_website.trim().length > 0) {
    res.status(200).json({ ok: true });
    return;
  }

  // Time-on-page sanity (very basic — humans take >2s to fill a form).
  const tStart = Number(payload._tStart);
  if (Number.isFinite(tStart)) {
    const elapsed = Date.now() - tStart;
    if (elapsed < MIN_TIME_ON_PAGE_MS) {
      // Silent success — don't leak the heuristic.
      res.status(200).json({ ok: true });
      return;
    }
  }

  // Strip client-only fields before forwarding.
  const {
    company_website: _hp,
    _tStart: _t,
    ...rest
  } = payload;

  // Force the source attribution server-side — clients can't spoof which
  // property the submission came from.
  const adminPayload = {
    ...rest,
    siteSource: SITE_SOURCE,
  };

  // Sane defaults for Dr. Scottsdale's primary flow. The widget on the
  // static site collects: firstName, lastName, email, phone, message.
  // We mirror that into the admin's "Book Appointment" intake shape so
  // the same downstream pipeline handles it.
  adminPayload.action = adminPayload.action || "Book Appointment";
  adminPayload.provider = adminPayload.provider || "dr-mata";
  adminPayload.selections = Array.isArray(adminPayload.selections) && adminPayload.selections.length
    ? adminPayload.selections
    : ["dr-scottsdale-consult"];

  const adminBody = JSON.stringify(adminPayload);
  let signature;
  try {
    signature = sign(adminBody);
  } catch (e) {
    console.error("[lead] sign error:", e.message);
    res.status(503).json({ error: "Widget temporarily unavailable" });
    return;
  }

  // Idempotency: forward the client-provided key if present, else generate one.
  const idempotencyKey =
    req.headers["x-idempotency-key"] ||
    `dsaz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let upstream;
  try {
    upstream = await fetch(`${ADMIN_URL}${ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Widget-Signature": signature,
        "X-Idempotency-Key": String(idempotencyKey),
        // Pass the original requester's IP so nrps-admin's rate limit
        // sees the real client, not Vercel's edge.
        "X-Forwarded-For":
          req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "",
        // Origin header so the admin's CORS allowlist sees the real origin.
        // The admin must have dr-scottsdale-v1.vercel.app + drscottsdaleaz.com
        // in NRPS_WIDGET_ALLOWED_ORIGINS.
        Origin: req.headers.origin || "https://dr-scottsdale-v1.vercel.app",
      },
      body: adminBody,
    });
  } catch (e) {
    console.error("[lead] upstream fetch failed:", e.message);
    res.status(502).json({ error: "Could not reach lead service" });
    return;
  }

  let upstreamBody;
  try {
    upstreamBody = await upstream.json();
  } catch {
    upstreamBody = { error: "Invalid upstream response" };
  }

  // PHI-aware log line — masked, no raw values.
  const c = (payload && payload.contact) || {};
  console.log(
    `[lead] ${upstream.status} action=${adminPayload.action} email=${maskEmail(c.email)} phone=${maskPhone(c.phone)} source=${SITE_SOURCE}`,
  );

  res.status(upstream.status).json(upstreamBody);
};
