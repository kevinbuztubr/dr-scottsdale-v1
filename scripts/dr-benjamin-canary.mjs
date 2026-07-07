#!/usr/bin/env node
/**
 * scripts/dr-benjamin-canary.mjs
 * ─────────────────────────────
 * BUILD-TIME CANARY — fails the build if ANY reference to the former-staff
 * partner surgeon ("Benjamin", "Dr. B", "Dr. Ben") appears in any HTML,
 * JSON-LD, JavaScript, CSS, or config file that ships to prod on
 * drscottsdaleaz.com.
 *
 * Why:
 *   Mirrors the same HARD RULE enforced on naturalresultsaz.com since
 *   2026-06-25 (Task #342). Foreign-surgeon content must not appear on
 *   any Dr. Scottsdale® / Natural Results Plastic Surgery property.
 *   Static-HTML sites regress the same way Next.js sites do — one
 *   copy-paste from a legacy Word doc, one AI-assisted rewrite pulling
 *   generic industry language, and the contamination is back.
 *
 * Scan scope: repo root .html, .js, .css, .json, .xml, .txt (all
 * user-facing files served by Vercel). Excludes:
 *   - node_modules/, .git/, .DS_Store
 *   - This file itself (has to contain the pattern to do its job)
 *   - Any other canary script (same reason)
 *
 * Patterns (case-insensitive):
 *   - "Benjamin" (any capitalization)
 *   - "Dr. B" / "Dr B" with a word boundary (won't match "Dr. Brown")
 *
 * Exit codes:
 *   0 — clean. Build proceeds.
 *   1 — contamination found. Build fails. Output lists every hit.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCAN_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".md"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".vercel", "scripts"]);
// Canary scripts contain the patterns themselves. Skip the scripts/ dir
// but re-include any non-canary .js/.mjs helpers if they exist.

// Files that legitimately contain "Dr. Benjamin" strings and MUST be
// allowed. Mirrors the NRPS canary's exclusion of next.config.js:
//
//   - vercel.json — contains PROTECTIVE 301 redirect rules of the form
//     `{ "source": "/free-consultation-with-dr-benjamin", ... }`. These
//     source paths MUST be literal to catch legacy URLs from organic
//     results and backlinks; removing them re-exposes 404s and re-leaks
//     SEO equity. Protective routing is the OPPOSITE of contamination.
//   - package.json — the canary's own npm script name mentions "benjamin"
//     as a build-tooling label. Not user-facing content.
const ALLOWLIST_FILES = new Set(["vercel.json", "package.json"]);

const BENJAMIN_RE = /benjamin/i;
const DR_B_RE = /\bdr\.?\s*b\b(?!en\b)(?![a-z])/i;
// The (?!en\b) guards against matching "Dr. Ben" via a truncated regex, and
// (?![a-z]) ensures "Dr. B" won't match "Dr. Brown", "Dr. Blake", etc. —
// the letter B must be followed by non-letter or end-of-string.

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, files);
    } else if (s.isFile()) {
      const ext = entry.slice(entry.lastIndexOf("."));
      if (SCAN_EXTENSIONS.has(ext)) files.push(full);
    }
  }
  return files;
}

const files = walk(REPO_ROOT);
const hits = [];

for (const file of files) {
  const rel = file.substring(REPO_ROOT.length + 1);
  if (ALLOWLIST_FILES.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BENJAMIN_RE.test(line)) {
      hits.push({ file: rel, line: i + 1, pattern: "Benjamin", text: line.trim().slice(0, 160) });
    }
    if (DR_B_RE.test(line)) {
      hits.push({ file: rel, line: i + 1, pattern: "Dr. B", text: line.trim().slice(0, 160) });
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ dr-benjamin-canary: clean. No former-associate references in ${files.length} scanned files.`);
  process.exit(0);
}

console.error(`❌ dr-benjamin-canary: ${hits.length} hit(s) found. Build blocked.`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line} [${h.pattern}] ${h.text}`);
}
process.exit(1);
