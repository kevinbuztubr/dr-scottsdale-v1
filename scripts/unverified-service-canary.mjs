#!/usr/bin/env node
/**
 * scripts/unverified-service-canary.mjs
 * -------------------------------------
 * BUILD-TIME CANARY — fails the build if any brand/device/service the
 * practice does NOT offer appears in user-facing files on
 * drscottsdaleaz.com.
 *
 * Why:
 *   Mirrors Task #405 on naturalresultsaz.com. On 2026-06-25 an urgent
 *   scrub of lip-augmentation services (Advanta Lip, PermaLip, fat
 *   transfer to lips) was shipped because the site was implying we
 *   offered them via legacy WP content. Without a canary, the same
 *   class of error can re-appear whenever a new procedure page is
 *   added or an AI-assisted rewrite pulls in generic industry language.
 *
 * Scan scope: repo root .html, .js, .json (files served by Vercel).
 * Skips node_modules, .git, scripts, .DS_Store.
 *
 * MAINTENANCE: keep UNAPPROVED_BRANDS in sync with the drscottsdale
 * service menu. Add a brand when Gunn confirms it's NOT offered. Remove
 * it when the practice adds it (and update the corresponding page).
 *
 * Exit codes:
 *   0 — clean.
 *   1 — unapproved brand mention found. Build fails.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ─────────────────────────────────────────────────────────────────────
// Brands / services the practice does NOT offer. Case-insensitive.
//
// Sourced from:
//   - naturalresultsaz.com's unverified-service-canary (parity)
//   - Gunn's explicit confirmations across Batch 4 (Task #457)
// Keep this list in sync with the NRPS canary except where drscottsdale
// intentionally offers a service NRPS does not (none as of 2026-07-07).
// ─────────────────────────────────────────────────────────────────────
const UNAPPROVED_BRANDS = [
  // Lip augmentation surgical implants — discontinued, practice does not offer
  "Advanta Lip",
  "PermaLip",
  "Perma Lip",
  "Advantalip",
  // Lip fat transfer — practice does not offer as standalone service
  "lip fat transfer",
  "fat transfer to lips",
  "lip fat grafting",
];

const SCAN_EXTENSIONS = new Set([".html", ".js", ".mjs", ".json", ".xml", ".md"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".vercel", "scripts"]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, files);
    else if (s.isFile()) {
      const ext = entry.slice(entry.lastIndexOf("."));
      if (SCAN_EXTENSIONS.has(ext)) files.push(full);
    }
  }
  return files;
}

const files = walk(REPO_ROOT);
const brandRes = UNAPPROVED_BRANDS.map((b) => ({
  name: b,
  re: new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
}));

const hits = [];
for (const file of files) {
  const rel = file.substring(REPO_ROOT.length + 1);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const b of brandRes) {
      if (b.re.test(line)) {
        hits.push({ file: rel, line: i + 1, brand: b.name, text: line.trim().slice(0, 160) });
      }
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ unverified-service-canary: clean. ${files.length} files scanned for ${UNAPPROVED_BRANDS.length} unapproved brand pattern(s), zero references.`);
  process.exit(0);
}

console.error(`❌ unverified-service-canary: ${hits.length} hit(s) found. Build blocked.`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line} [${h.brand}] ${h.text}`);
}
process.exit(1);
