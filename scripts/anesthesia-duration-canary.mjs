#!/usr/bin/env node
/**
 * scripts/anesthesia-duration-canary.mjs
 * ────────────────────────────────────────
 * BUILD-TIME CANARY - fails the build if any user-facing string on this site
 * mentions an anesthesia type OR a procedure/consult duration.
 *
 * PORTED from nr-website 2026-09-09. Same HARD RULE, same patterns, adapted
 * from that repo's .ts/.tsx tree to this repo's static .html files.
 *
 * Why (Gunn 2026-07-07, enforced on the practice site since then):
 *   "stop putting anesthesia types across the entire website, ive been
 *   telling you this. no duration sitewide."
 *
 * Why it took until 2026-09-09 to reach THIS site:
 *   The 2026-07-13 audit found these violations live here and wrote a fix
 *   plan. Seven canaries were ported afterwards - but NOT this one, which is
 *   the single canary that would have caught them. So the violations stayed
 *   live for eight weeks:
 *     - scottsdale-skinny: "Healthy non-smokers cleared for general anesthesia"
 *     - magic-shot: "local anesthetic block", "in about an hour",
 *                   "last 6 months to 2 years", "can last 2-3 years"
 *     - tummy-tuck / breast-lift / gynecomastia / scottsdale-skinny: anesthesia
 *       type + "N hour procedure" inside the MedicalProcedure JSON-LD
 *   The JSON-LD hits mattered most: structured data is exactly what AI answer
 *   engines quote, so we were feeding them the content our own policy forbids.
 *
 * SCHEMA IS SCANNED ON PURPOSE. Unlike the nr-website original, this canary
 * does NOT skip <script> blocks. Most of what it caught on 2026-09-09 lived in
 * the JSON-LD, not the visible prose.
 *
 * Exemptions:
 *   - HTML comments
 *   - Recovery cadence in days/weeks/months (approved carve-out, same as
 *     nr-website: "6 weeks", "3 months" etc. describe aftercare, not duration
 *     of a procedure)
 *
 * Exit codes:
 *   0 - clean.
 *   1 - hit found. Build fails.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const TARGETS = [];
for (const e of readdirSync(REPO_ROOT)) {
  if (["node_modules", ".git", "images", "scripts", "api"].includes(e)) continue;
  const full = join(REPO_ROOT, e);
  try {
    if (statSync(full).isFile() && /\.html$/.test(e)) TARGETS.push(full);
  } catch {}
}

const ANESTHESIA = [
  { re: /\bgeneral\s+anesthesia\b/i, tag: "general anesthesia" },
  { re: /\blocal\s+anesthesia\b/i, tag: "local anesthesia" },
  { re: /\blocal\s+anesthetic\b/i, tag: "local anesthetic" },
  { re: /\bIV\s+conscious\s+sedation\b/i, tag: "IV conscious sedation" },
  { re: /\bIV\s+sedation\b/i, tag: "IV sedation" },
  { re: /\bdeep\s+sedation\b/i, tag: "deep sedation" },
  { re: /\btwilight\s+sedation\b/i, tag: "twilight sedation" },
  { re: /\bconscious\s+sedation\b/i, tag: "conscious sedation" },
  { re: /\blight\s+sedation\b/i, tag: "light sedation" },
  { re: /\bMAC\s+anesthesia\b/, tag: "MAC anesthesia" },
  { re: /\bunder\s+sedation\b/i, tag: "under sedation" },
  { re: /\bunder\s+anesthesia\b/i, tag: "under anesthesia" },
  { re: /\banesthesia\b/i, tag: "anesthesia (bare)" },
  { re: /\banesthetic\b/i, tag: "anesthetic (bare)" },
  { re: /\banesthesiologist\b/i, tag: "anesthesiologist" },
  { re: /\bepidural\b/i, tag: "epidural" },
  { re: /\bnerve\s+block\b/i, tag: "nerve block" },
  { re: /\bspinal\s+block\b/i, tag: "spinal block" },
];

const DURATION = [
  { re: /\b\d+\s*hour\s+procedure\b/i, tag: "N hour procedure" },
  { re: /\b\d+\s*[-–]\s*\d*\s*hour\s+(procedure|outpatient)\b/i, tag: "N-hour procedure" },
  { re: /\b\d+\s*[-–]\s*\d+\s+hours?\b/i, tag: "N-N hours" },
  { re: /\b\d+\s*[-–]\s*\d+\s+years?\b/i, tag: "N-N years" },
  { re: /\b\d+[-–]minute\s+session\b/i, tag: "N-minute session" },
  { re: /\b\d+\s+minute\s+session\b/i, tag: "N minute session" },
  { re: /\b\d+[-–]minute\s+(consultation|consult|visit)\b/i, tag: "N-minute consult" },
  { re: /\b\d+\s+minutes?\s+to\s+\d+\s+hours?\b/i, tag: "X minutes to Y hours" },
  { re: /\b\d+\s+to\s+\d+\s+minutes?\b/i, tag: "X to Y minutes" },
  { re: /\b\d+\s+to\s+\d+\s+hours?\b/i, tag: "X to Y hours" },
  { re: /\blasts?\s+from\s+\d+/i, tag: "lasts from N" },
  { re: /\blasts?\s+\d+\s*[-–]\s*\d+\s*(hour|day|week|month|year)/i, tag: "lasts N-N units" },
  { re: /\b(lasts?|last)\s+\d+\s+(months?|years?)\s+to\s+\d+\s+(months?|years?)/i, tag: "lasts N to N units" },
  { re: /\bcan\s+lasts?\s+\d+/i, tag: "can last N" },
  { re: /\btakes?\s+about\s+\d+\s+(hour|minute)/i, tag: "takes about N hour/minute" },
  { re: /\bprocedure\s+duration\b/i, tag: "procedure duration" },
  { re: /\bruns?\s+\d+[-–]\d+\s+(minute|hour)/i, tag: "runs N-N minutes/hours" },
  { re: /\bin\s+the\s+OR\s+for\s+\d+/i, tag: "in the OR for N" },
  { re: /\b(about|around|within|under|approximately|roughly|nearly|almost|only|just)\s+(an|one)\s+hour\b/i, tag: "~an hour" },
  { re: /\b(an|one)\s+hour\s+long\b/i, tag: "an hour long" },
  { re: /\blasts?\s+(?:about\s+|around\s+)?(an|one)\s+hour\b/i, tag: "lasts an hour" },
  { re: /\btakes?\s+(?:about\s+|around\s+|only\s+)?(an|one)\s+hour\b/i, tag: "takes an hour" },
  { re: /\bcompleted\s+with?in\s+(an|one)\s+hour\b/i, tag: "completed in an hour" },
  { re: /~\s*\d+\s*hour/i, tag: "~N hour" },
  // Dangling duration-redaction artifacts - both a grammar bug and a signal
  // that a previous scrub was incomplete.
  { re: /\btypically\s+lasts?\s*\./i, tag: "dangling 'typically last.'" },
  { re: /\btypically\s+lasts?\s+between\s*[.,]/i, tag: "dangling 'last between'" },
];

/**
 * Recovery cadence carve-out, same intent as nr-website: aftercare intervals in
 * days, weeks and months are APPROVED, because they describe when a patient is
 * seen, not how long a procedure takes or how long a result lasts.
 *
 * IT IS EVALUATED ON THE MATCHED TEXT, NEVER ON THE LINE. Two reasons, both
 * learned the hard way while writing this canary on 2026-09-09:
 *
 *   1. This site's JSON-LD is minified onto ONE line per page - tummy-tuck.html
 *      line 23 is 3,479 characters. A line-level exemption meant a single
 *      "6 weeks" anywhere in that blob exempted the ENTIRE page's structured
 *      data, which is precisely where the real violations live.
 *   2. The nr-website original guards its carve-out with
 *      /\b(anesthes|anesthet|...)\b/ - a word boundary after a PREFIX, so
 *      `\banesthes\b` can never match "anesthesia". The guard silently never
 *      fires. Do not copy that pattern back.
 *
 * Verified by seeding "General anesthesia, 3-4 hours." into the tummy-tuck
 * JSON-LD: the line-level version reported CLEAN, this version fails.
 *
 * Anesthesia is never exempt under any circumstance - there is no cadence
 * nuance to it. Only duration matches can be excused, and only when the match
 * itself is a day/week/month interval.
 */
function isApprovedCadenceMatch(matched) {
  return /^\s*(lasts?\s+)?\d+\s*[-–]?\s*\d*\s*(days?|weeks?|months?)\b/i.test(matched);
}

const violations = [];

for (const file of TARGETS) {
  const rel = relative(REPO_ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*<!--/.test(line)) return;
    for (const { re, tag, kind } of [
      ...ANESTHESIA.map((p) => ({ ...p, kind: "anesthesia" })),
      ...DURATION.map((p) => ({ ...p, kind: "duration" })),
    ]) {
      const m = line.match(re);
      if (!m) continue;
      if (kind === "duration" && isApprovedCadenceMatch(m[0])) continue;
      const at = line.indexOf(m[0]);
      violations.push({
        file: rel,
        line: i + 1,
        tag,
        snippet: line.slice(Math.max(0, at - 60), at + m[0].length + 60).trim(),
      });
      break; // one report per line is enough to force a fix
    }
  });
}

if (violations.length) {
  console.error(`\n❌ anesthesia-duration-canary: ${violations.length} violation(s).\n`);
  console.error("   HARD RULE: no anesthesia types and no procedure/consult durations,");
  console.error("   in visible copy OR in JSON-LD. Delete the clause; do not reword it\n");
  console.error("   into an approximation.\n");
  for (const v of violations) {
    console.error(`   ${v.file}:${v.line}  [${v.tag}]`);
    console.error(`      …${v.snippet}…`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `✅ anesthesia-duration-canary: clean. ${TARGETS.length} HTML files scanned (visible copy + JSON-LD), no anesthesia types / procedure durations found.`,
);
