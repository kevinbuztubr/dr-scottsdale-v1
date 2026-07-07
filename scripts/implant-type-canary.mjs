#!/usr/bin/env node
/**
 * scripts/implant-type-canary.mjs
 * ────────────────────────────────
 * BUILD-TIME CANARY - fails the build if any breast page enumerates specific
 * implant fill types, shells, profiles, placements, incisions, or brand names.
 *
 * Why (Gunn 2026-07-07):
 *   "Just stop listing exactly what type of implants until we get the official
 *   list." Rather than get stale WP claims or fabricated details wrong, remove
 *   implant-type specifics until Dr. Mata dictates the current list.
 *
 * What it scans:
 *   breast-augmentation.html, breast-lift.html, breast-implant*.html at repo root.
 *
 * What it blocks:
 *   saline, silicone (as implant descriptor), smooth/textured/structured saline,
 *   gummy bear, cohesive gel, profile names (ultra-high / high / moderate plus /
 *   moderate / low profile), placement (sub-glandular / sub-muscular / dual-plane),
 *   incisions (inframammary / peri-areolar / trans-axillary / TUBA), size
 *   enumerations (100cc / 800cc), and brand names (Sientra, Mentor, Natrelle,
 *   Motiva, Ideal Implant).
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

const TARGETS = readdirSync(REPO_ROOT)
  .filter((f) => /^breast.*\.html$/.test(f))
  .map((f) => join(REPO_ROOT, f))
  .filter((f) => statSync(f).isFile());

const TERMS = [
  { re: /\bsaline\s+implants?\b/i, tag: "saline implant" },
  { re: /\bsilicone\s+implants?\b/i, tag: "silicone implant" },
  { re: /\bsmooth\s+implants?\b/i, tag: "smooth implant" },
  { re: /\btextured\s+implants?\b/i, tag: "textured implant" },
  { re: /\bstructured\s+saline\b/i, tag: "structured saline" },
  { re: /\bgummy\s+bear\b/i, tag: "gummy bear" },
  { re: /\bcohesive\s+gel\b/i, tag: "cohesive gel" },
  { re: /\bultra[-\s]high\s+profile\b/i, tag: "ultra-high profile" },
  { re: /\bmoderate\s+plus\b/i, tag: "moderate plus" },
  { re: /\bhigh\s+profile\b/i, tag: "high profile" },
  { re: /\blow\s+profile\b/i, tag: "low profile" },
  { re: /\bsub[-\s]glandular\b/i, tag: "sub-glandular" },
  { re: /\bsub[-\s]muscular\b/i, tag: "sub-muscular" },
  { re: /\bdual[-\s]plane\b/i, tag: "dual-plane" },
  { re: /\bbiplanar\b/i, tag: "biplanar" },
  { re: /\binframammary\b/i, tag: "inframammary" },
  { re: /\bperi[-\s]areolar\b/i, tag: "peri-areolar" },
  { re: /\btrans[-\s]axillary\b/i, tag: "trans-axillary" },
  { re: /\bTUBA\b/, tag: "TUBA" },
  { re: /\b100\s*cc\b/i, tag: "100cc" },
  { re: /\b800\s*cc\b/i, tag: "800cc" },
  { re: /\bSientra\b/i, tag: "Sientra" },
  { re: /\bMentor\s+implants?\b/i, tag: "Mentor implants" },
  { re: /\bNatrelle\b/i, tag: "Natrelle" },
  { re: /\bMotiva\b/i, tag: "Motiva" },
  { re: /\bIdeal\s+Implant\b/i, tag: "Ideal Implant" },
];

const hits = [];
for (const file of TARGETS) {
  const rel = file.substring(REPO_ROOT.length + 1);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { re, tag } of TERMS) {
      if (re.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, tag, text: lines[i].trim().slice(0, 160) });
        break;
      }
    }
  }
}

if (hits.length === 0) {
  console.log(`✅ implant-type-canary: clean. ${TARGETS.length} breast page(s) scanned, no implant-type / brand enumerations.`);
  process.exit(0);
}

console.error(`❌ implant-type-canary: ${hits.length} hit(s) found. Build blocked. Remove implant-type / brand enumeration and use consultation-first framing until Dr. Mata provides the approved list.`);
for (const h of hits) console.error(`  ${h.file}:${h.line} [${h.tag}] ${h.text}`);
process.exit(1);
