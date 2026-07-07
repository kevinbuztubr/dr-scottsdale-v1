#!/usr/bin/env node
/**
 * scripts/clinical-claims-canary.mjs
 * ──────────────────────────────────
 * BUILD-TIME CANARY — fails the build if any forbidden categorical
 * surgical-recovery claim appears in user-facing files on
 * drscottsdaleaz.com.
 *
 * Why:
 *   Mirrors the same HARD RULE enforced on naturalresultsaz.com since
 *   2026-06-22. The claim "75% back to driving/work within a day" (and
 *   its variants) is medically problematic — driving is always tied to
 *   "off prescription pain medication AND surgeon-cleared," never to a
 *   categorical timeframe. A grep canary is the only reliable way to
 *   keep this from re-entering the site via a copy-paste from marketing
 *   or an AI-assisted rewrite.
 *
 * Scan scope: repo root .html, .js, .json (files served by Vercel).
 * Skips node_modules, .git, scripts (canary scripts contain the patterns).
 *
 * Forbidden patterns (case-insensitive):
 *   1. "within a day"           — canonical forbidden phrase
 *   2. "in just a day"          — variant
 *   3. "(75|80|90)% ... back|return" — percent-attached activity-return
 *   4. "three-quarters of ... patients" — fractional patient-return claim
 *   5. "return to (driving|work|normal|activity) (within|in) (a|24|one)
 *      (hour|day)" — categorical activity-return phrasing
 *
 * Deliberately NOT flagged:
 *   - "avoid strenuous exercise for ~24 hours" — standard filler guidance
 *   - Operational SLAs ("we'll reach out within 24 hours")
 *   - Recovery-window descriptions ("First 24 hours: rest with arms up")
 *
 * Exit codes:
 *   0 — clean.
 *   1 — forbidden claim found. Build fails. Output lists every hit.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCAN_EXTENSIONS = new Set([".html", ".js", ".mjs", ".json", ".xml", ".md"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".vercel", "scripts"]);

const FORBIDDEN_PATTERNS = [
  { name: "within a day",     re: /within\s+a\s+day/i },
  { name: "in just a day",    re: /in\s+just\s+a\s+day/i },
  { name: "percent-back",     re: /\b(75|80|85|90)\s*%[^.]{0,50}?\b(back|return)\b/i },
  { name: "three-quarters",   re: /three[\s-]quarters?\s+of\s+(our\s+)?patients?/i },
  { name: "return-to-X-in-N", re: /return\s+to\s+(driving|work|normal|activity)\s+(within|in)\s+(a|24|one)\s+(hour|day)/i },
];

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
const hits = [];

for (const file of files) {
  const rel = file.substring(REPO_ROOT.length + 1);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip HTML comments (safety documentation) and JS/CSS comments
    const trimmed = line.trim();
    if (trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const p of FORBIDDEN_PATTERNS) {
      if (p.re.test(line)) {
        hits.push({ file: rel, line: i + 1, pattern: p.name, text: trimmed.slice(0, 160) });
      }
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ clinical-claims-canary: clean. No forbidden categorical surgical-recovery claims in ${files.length} scanned files.`);
  process.exit(0);
}

console.error(`❌ clinical-claims-canary: ${hits.length} hit(s) found. Build blocked.`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line} [${h.pattern}] ${h.text}`);
}
process.exit(1);
