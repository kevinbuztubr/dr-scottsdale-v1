/**
 * /api/catalog — Server-side proxy for the live Dr. Mata procedure catalog.
 *
 * Why a proxy (vs. fetching nr-website directly from the browser):
 *   - Same-origin from the browser's POV — no CORS, no preflight, no
 *     "Origin not allowed" failure modes when Vercel routes are in
 *     between us and the upstream.
 *   - The widget needs to load fast on every page view; a server-side
 *     fetch lets us cache at the edge (s-maxage=60) without
 *     fighting Vary: Origin semantics on the upstream side.
 *   - Mirrors the existing /api/lead and /api/chat pattern — every
 *     cross-property call goes through a thin same-origin proxy.
 *
 * Filter:
 *   We strip medspa entries server-side so the Dr. Scottsdale brand site
 *   (surgical practice) only ever sees Dr. Mata's procedures.
 */

const UPSTREAM = "https://naturalresultsaz.com/api/widget-services";
const FETCH_TIMEOUT_MS = 8000;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.error("[catalog] upstream fetch failed:", e.message);
    res.status(502).json({ error: "Catalog upstream unavailable" });
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    console.error("[catalog] upstream status:", upstream.status);
    res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    return;
  }

  let services;
  try {
    services = await upstream.json();
  } catch (e) {
    res.status(502).json({ error: "Bad upstream response" });
    return;
  }

  if (!Array.isArray(services)) {
    res.status(502).json({ error: "Bad catalog shape" });
    return;
  }

  // Filter to Dr. Mata only — this is the surgical brand site.
  const drMataOnly = services.filter((s) => s && s.provider === "dr-mata");

  // Cache at the edge for 60s; widget UX doesn't need second-by-second
  // pricing freshness. Stale-while-revalidate keeps it snappy.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(JSON.stringify(drMataOnly));
};
