/**
 * /api/chat — Dr. Scottsdale® → nr-website /api/ask-dr-mata streaming proxy.
 *
 * Why a proxy instead of having the static HTML call nr-website directly:
 *   1. Avoid the cross-origin streaming headache. The ask-dr-mata endpoint
 *      streams SSE-style text. Cross-origin streaming with credentials
 *      + CORS preflights is brittle across browsers; same-origin is bulletproof.
 *   2. Force siteSource server-side so a hostile caller can't impersonate
 *      Natural Results' chat attribution to game the per-property insights.
 *   3. Future-proof: we can swap to a dedicated dr-scottsdale persona
 *      endpoint here without touching the static HTML.
 *
 * Streams the upstream response 1:1 to the client (same Content-Type,
 * same chunked transfer). The widget on the page reads chunks as they
 * arrive — identical UX to nr-website's chat.
 */

const NR_WEBSITE_URL = "https://naturalresultsaz.com";
const ENDPOINT = "/api/ask-dr-mata";
const SITE_SOURCE = "drscottsdaleaz.com";

const MAX_BODY_BYTES = 64 * 1024;

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read body
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
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Force the brand persona server-side. Client cannot spoof.
  payload.siteSource = SITE_SOURCE;

  // Sane default page context if the client didn't send one.
  if (!payload.context) {
    payload.context = "The visitor is browsing Dr. Scottsdale's brand site (drscottsdaleaz.com). Dr. Scottsdale is the brand name of Dr. Carlos Mata, board-certified plastic surgeon. The home practice is Natural Results Plastic Surgery in Scottsdale, AZ. Signature trademarked procedures: Scottsdale Skinny® (full-body Vaser lipo + fat transfer + muscle etching), Gladiator® (male makeover), Magic Shot® (non-surgical penile enhancement).";
  }
  if (!payload.procedureName) {
    payload.procedureName = "Dr. Scottsdale's signature procedures";
  }

  const upstreamBody = JSON.stringify(payload);

  let upstream;
  try {
    upstream = await fetch(`${NR_WEBSITE_URL}${ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass real client IP for rate-limit accuracy on the upstream.
        "X-Forwarded-For":
          req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "",
        Referer: req.headers.referer || "https://drscottsdaleaz.com/",
        // Origin must be forwarded so nr-website's /api/ask-dr-mata can
        // attach it to its log-chat POST. The admin's /api/public/log-chat
        // origin-gates on this header — without it, chat-logging silently
        // 403s and Dr. Scottsdale conversations never reach the admin
        // /chat-logs Insights view. Same-origin NRPS chats get this for
        // free from the browser; this proxy hop doesn't.
        Origin: "https://drscottsdaleaz.com",
      },
      body: upstreamBody,
    });
  } catch (e) {
    console.error("[chat] upstream fetch failed:", e.message);
    res.status(502).json({ error: "Could not reach assistant" });
    return;
  }

  // Pass through status + content type. For streaming text, we read the
  // body as a stream and pipe it to the response.
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (e) {
    console.error("[chat] stream relay error:", e.message);
  } finally {
    res.end();
  }
};
/**
 * /api/chat — Dr. Scottsdale® → nr-website /api/ask-dr-mata streaming proxy.
 *
 * Why a proxy instead of having the static HTML call nr-website directly:
 *   1. Avoid the cross-origin streaming headache. The ask-dr-mata endpoint
 *      streams SSE-style text. Cross-origin streaming with credentials
 *      + CORS preflights is brittle across browsers; same-origin is bulletproof.
 *   2. Force siteSource server-side so a hostile caller can't impersonate
 *      Natural Results' chat attribution to game the per-property insights.
 *   3. Future-proof: we can swap to a dedicated dr-scottsdale persona
 *      endpoint here without touching the static HTML.
 *
 * Streams the upstream response 1:1 to the client (same Content-Type,
 * same chunked transfer). The widget on the page reads chunks as they
 * arrive — identical UX to nr-website's chat.
 */

const NR_WEBSITE_URL = "https://naturalresultsaz.com";
const ENDPOINT = "/api/ask-dr-mata";
const SITE_SOURCE = "drscottsdaleaz.com";

const MAX_BODY_BYTES = 64 * 1024;

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read body
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
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Force the brand persona server-side. Client cannot spoof.
  payload.siteSource = SITE_SOURCE;

  // Sane default page context if the client didn't send one.
  if (!payload.context) {
    payload.context = "The visitor is browsing Dr. Scottsdale's brand site (drscottsdaleaz.com). Dr. Scottsdale is the brand name of Dr. Carlos Mata, board-certified plastic surgeon. The home practice is Natural Results Plastic Surgery in Scottsdale, AZ. Signature trademarked procedures: Scottsdale Skinny® (full-body Vaser lipo + fat transfer + muscle etching), Gladiator® (male makeover), Magic Shot® (non-surgical penile enhancement).";
  }
  if (!payload.procedureName) {
    payload.procedureName = "Dr. Scottsdale's signature procedures";
  }

  const upstreamBody = JSON.stringify(payload);

  let upstream;
  try {
    upstream = await fetch(`${NR_WEBSITE_URL}${ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass real client IP for rate-limit accuracy on the upstream.
        "X-Forwarded-For":
          req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "",
        Referer: req.headers.referer || "https://dr-scottsdale-v1.vercel.app/",
      },
      body: upstreamBody,
    });
  } catch (e) {
    console.error("[chat] upstream fetch failed:", e.message);
    res.status(502).json({ error: "Could not reach assistant" });
    return;
  }

  // Pass through status + content type. For streaming text, we read the
  // body as a stream and pipe it to the response.
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (e) {
    console.error("[chat] stream relay error:", e.message);
  } finally {
    res.end();
  }
};
