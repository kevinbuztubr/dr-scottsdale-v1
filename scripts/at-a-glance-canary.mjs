#!/usr/bin/env node
/**
 * scripts/at-a-glance-canary.mjs
 * ──────────────────────────────
 * BUILD-TIME CANARY - fails the build if any procedure page renders an
 * "At a Glance" fact card. This card previously exposed categorical
 * clinical claims (Anesthesia, Hospital stay, Return to exercise) in a
 * highly-visible summary block, which conflicts with the WP-only-source
 * HARD RULE and the "when uncertain, remove the section" principle.
 *
 * Why (2026-07-07):
 *   Gunn reviewed the drscottsdale breast-augmentation page and
 *   flagged the At-a-Glance card as "way too sensitive." The clinical
 *   claims inside are individually WP-sourced, but presenting them as
 *   a distilled bullet-list makes them read as categorical promises,
 *   which the [feedback-nrps-content-policy] rule explicitly forbids.
 *   This canary prevents the card from creeping back into procedure
 *   pages via later edits or new procedure builds.
 *
 * What it scans:
 *   All .html files at repo root (procedure and non-procedure).
 *
 * What it blocks:
 *   The literal user-facing pattern `<h4>At a Glance</h4>`.
 *
 * What it EXPLICITLY allows:
 *   Other fact-card uses that don't carry the At-a-Glance header -
 *   currently `<h4>Credentials</h4>`, `<h4>Recognition</h4>` on
 *   about.html and scottsdale-plastic-surgeon.html. Those are
 *   physician-credential cards, not clinical procedure claims, and
 *   they're categorically different from the sensitive procedure
 *   summary card.
 *
 * Exit codes:
 *   0 - clean. Build proceeds.
 *   1 - hit found. Build fails.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const AT_A_GLANCE_RE = /<h4[^>]*>\s*At\s+a\s+Glance\s*<\/h4>/i;

const files = readdirSync(REPO_ROOT)
  .filter((f) => f.endsWith(".html"))
  .map((f) => join(REPO_ROOT, f))
  .filter((f) => statSync(f).isFile());

const hits = [];
for (const file of files) {
  const rel = file.substring(REPO_ROOT.length + 1);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (AT_A_GLANCE_RE.test(lines[i])) {
      hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 140) });
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ at-a-glance-canary: clean. ${files.length} HTML files scanned, no At-a-Glance fact card found.`);
  process.exit(0);
}

console.error(`❌ at-a-glance-canary: ${hits.length} hit(s) found. Build blocked. Remove the At-a-Glance fact card entirely (do not soften individual rows).`);
for (const h of hits) console.error(`  ${h.file}:${h.line} ${h.text}`);
process.exit(1);
