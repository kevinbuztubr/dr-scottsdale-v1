#!/usr/bin/env node
/**
 * scripts/em-dash-canary.mjs
 * ─────────────────────────
 * BUILD-TIME CANARY — fails the build if any em-dash (—), en-dash (–),
 * minus sign (−), HTML entity (&mdash;/&ndash;), or JSON-escaped
 * equivalent (—/–) appears in any user-facing file.
 *
 * Why:
 *   Gunn directive: no em/en dashes anywhere across either brand site.
 *   These characters cause inconsistent rendering across email clients,
 *   feed readers, some browser configurations, and copy-paste flows,
 *   and they visually clash with the site typography.
 *
 *   Replacement rule: any em-dash / en-dash / minus / entity / escape
 *   becomes a plain ASCII hyphen `-`.
 *
 * Scan scope: repo root .html, .js, .css, .json, .xml, .txt, .md.
 * Excludes: node_modules, .git, .vercel, scripts (canary scripts contain
 * the patterns themselves).
 *
 * Exit codes:
 *   0 — clean.
 *   1 — dash found. Build fails. Output lists every hit.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCAN_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".md"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".vercel", "scripts"]);

// Patterns to detect (both literal Unicode characters and encoded forms):
//   U+2014  — em-dash
//   U+2013  – en-dash
//   U+2212  − minus sign
//   —  JSON-escaped em-dash (6 literal chars in source)
//   –  JSON-escaped en-dash
//   &mdash; HTML entity
//   &ndash; HTML entity
//   &#8212; numeric entity for em-dash
//   &#8211; numeric entity for en-dash
const DASH_RE = /—|–|−|\\u2014|\\u2013|&mdash;|&ndash;|&#8212;|&#8211;/;

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
    if (DASH_RE.test(lines[i])) {
      hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) });
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ em-dash-canary: clean. ${files.length} files scanned, no em-dash / en-dash / minus / entity references.`);
  process.exit(0);
}

console.error(`❌ em-dash-canary: ${hits.length} hit(s) found. Build blocked. Replace with plain ASCII hyphen '-'.`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line} ${h.text}`);
}
process.exit(1);
