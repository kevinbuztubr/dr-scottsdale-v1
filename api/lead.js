/**
 * /api/lead — Dr. Scottsdale® lead-submission proxy.
 *
 * Flow:
 *   browser
 *     → this function (same-origin from the static HTML)
 *     → nr-website /api/widget-relay (HMAC signs server-side)
 *     → nrps-admin /api/widget/quote
 *     → GHL contact + opportunity stamped source="drscottsdaleaz.com"
 *
 * Why a relay (not a direct call to nrps-admin):
 *   - The HMAC widget secret only lives on nr-website + nrps-admin.
 *     dr-scottsdale-v1 doesn't need to hold it; instead we ride the relay
 *     which signs on our behalf. Smaller key footprint, fewer env vars to
 *     rotate, no secret-parity risk between this project and nrps-admin.
 *   - Per-property attribution (siteSource="drscottsdaleaz.com") is enforced
 *     in TWO places: this function stamps it, AND the relay re-stamps it
 *     unconditionally. Defense in depth — a hostile caller can't impersonate
 *     Natural Results' source even if they bypass this function.
 *
 * Defense in depth:
 *   - 8 KB body cap
 *   - Honeypot field "company_website" — non-empty silently 200's the bot
 *   - Time-on-page check — sub-2-second form submits silently 200 (bot)
 *   - PHI-masked logs only
 */

const RELAY_URL = "https://naturalresultsaz.com/api/widget-relay";
const SITE_SOURCE = "drscottsdaleaz.com";
const MAX_BODY_BYTES = 8 * 1024;
const MIN_TIME_ON_PAGE_MS = 2000;

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
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let raw = "";
  try {
    if (req.body && typeof req.body === "object") {
      raw = JSON.stringify(req.body);
    } else if (typeof req.body === "string") {
      raw = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      raw = Buffer.concat(chunks).toString("utf-8");
    }
  } catch {
    res.status(400).json({ error: "Could not read body" });
    return;
  }
  if (raw.length > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Body too large" });
    return;
  }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Honeypot — silent 200 on bot detection.
  if (payload && typeof payload.company_website === "string" && payload.company_website.trim().length > 0) {
    res.status(200).json({ ok: true });
    return;
  }
  // Time-on-page sanity check.
  const tStart = Number(payload._tStart);
  if (Number.isFinite(tStart) && Date.now() - tStart < MIN_TIME_ON_PAGE_MS) {
    res.status(200).json({ ok: true });
    return;
  }

  // Strip client-only fields before relaying upstream.
  const { company_website: _hp, _tStart: _t, ...clean } = payload;

  const relayPayload = {
    ...clean,
    siteSource: SITE_SOURCE,
    action: clean.action || "Book Appointment",
    provider: clean.provider || "dr-mata",
    selections:
      Array.isArray(clean.selections) && clean.selections.length
        ? clean.selections
        : ["dr-scottsdale-consult"],
  };

  let upstream;
  try {
    upstream = await fetch(RELAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // CORS allowlist on the relay checks the Origin header.
        Origin: "https://dr-scottsdale-v1.vercel.app",
        "X-Forwarded-For":
          req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "",
        "X-Idempotency-Key":
          req.headers["x-idempotency-key"] ||
          `dsaz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      },
      body: JSON.stringify(relayPayload),
    });
  } catch (e) {
    console.error("[lead] relay fetch failed:", e.message);
    res.status(502).json({ error: "Could not reach lead service" });
    return;
  }

  let upstreamBody;
  try { upstreamBody = await upstream.json(); } catch {
    upstreamBody = { error: "Invalid relay response" };
  }

  const c = (payload && payload.contact) || {};
  console.log(
    `[lead] relay-status=${upstream.status} email=${maskEmail(c.email)} phone=${maskPhone(c.phone)} source=${SITE_SOURCE}`,
  );

  res.status(upstream.status).json(upstreamBody);
};
