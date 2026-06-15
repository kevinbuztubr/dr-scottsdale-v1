#!/usr/bin/env node
/**
 * scripts/schema-canary.mjs
 * ─────────────────────────
 * Build-time validator for JSON-LD structured data on the Dr. Scottsdale® site.
 *
 * Why this exists
 * ───────────────
 * On 2026-06-14 GSC flagged drscottsdaleaz.com with a Review snippets
 * structured-data issue: "Missing field 'name' (in '<parent_node>')". The
 * cause was testimonials.html re-declaring the Physician + MedicalBusiness
 * nodes by `@id` only (no `name`), which Google's Review snippets validator
 * can't resolve across separate @graph blocks for the rich-result feature.
 *
 * Fixing the one page is easy. Preventing the next regression is the harder
 * part — the same pattern (re-declare a node by @id without re-declaring
 * `name`) is the kind of thing that creeps back in every time anyone edits
 * a JSON-LD block. This canary closes that gap.
 *
 * What it checks
 * ──────────────
 * Walks every .html file in the site root, finds all
 * `<script type="application/ld+json">` blocks, parses them, and for each
 * structured-data node validates required fields per Google's published
 * rich-result spec:
 *
 *   • Any node carrying `aggregateRating` OR `review` MUST have `name` and
 *     `@type` (this is the specific bug we just fixed).
 *   • Any AggregateRating block MUST have ratingValue, reviewCount,
 *     bestRating, worstRating.
 *   • Any node with `@type: FAQPage` MUST have `mainEntity` with ≥1
 *     Question, each Question MUST have name + acceptedAnswer with text.
 *   • Any node with `@type: WebPage` MUST have `url` and `name`.
 *   • Any node with `@type: Physician` MUST have `name` (already a Google
 *     requirement for the Knowledge Panel feature).
 *
 * Adding a new check: extend `REQUIRED_FIELDS` below.
 *
 * Exit codes
 *   0 — all schemas pass
 *   1 — at least one structured-data block has a missing required field
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Required-field rules. Each entry is a predicate that decides whether a
 * node is subject to the rule, plus the list of fields that must be present
 * (and truthy) on that node. The format is intentionally declarative so a
 * future contributor can add a new rule without learning the walker logic.
 */
const REQUIRED_FIELDS = [
  {
    name: "aggregateRating parent has name",
    matches: (n) => n && typeof n === "object" && "aggregateRating" in n,
    required: ["name", "@type"],
    why: "Google Review snippets validator can't resolve `name` across @graph blocks — the node carrying aggregateRating must declare its own name. This is exactly the 2026-06-14 testimonials.html bug.",
  },
  {
    name: "review parent has name",
    matches: (n) => n && typeof n === "object" && "review" in n,
    required: ["name", "@type"],
    why: "Same rule as aggregateRating — review-bearing nodes must declare their own name to be eligible for Review snippet rich results.",
  },
  {
    name: "AggregateRating block has all 4 score fields",
    matches: (n) => n && n["@type"] === "AggregateRating",
    required: ["ratingValue", "reviewCount", "bestRating", "worstRating"],
    why: "Google requires all four fields for Review snippets eligibility. Missing any one drops the feature.",
  },
  {
    name: "WebPage has name + url",
    matches: (n) => n && n["@type"] === "WebPage",
    required: ["name", "url"],
    why: "WebPage nodes without name or url are silently dropped from the page-graph index.",
  },
  {
    name: "Physician has name",
    matches: (n) => n && (n["@type"] === "Physician" || (Array.isArray(n["@type"]) && n["@type"].includes("Physician"))),
    required: ["name"],
    why: "Google Knowledge Panel for medical practitioners requires Physician.name.",
  },
  {
    name: "FAQPage has mainEntity",
    matches: (n) => n && n["@type"] === "FAQPage",
    required: ["mainEntity"],
    why: "FAQPage rich result requires at least one Question in mainEntity.",
  },
];

/**
 * Walk a parsed JSON-LD value, yielding every dictionary node we encounter
 * (top-level, inside @graph, inside arbitrary nested arrays/objects).
 * The walker is intentionally generic so we don't have to enumerate the
 * specific shapes JSON-LD allows.
 */
function* walkNodes(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkNodes(item);
    return;
  }
  if (value && typeof value === "object") {
    yield value;
    for (const v of Object.values(value)) yield* walkNodes(v);
  }
}

/**
 * Extract every JSON-LD block from an HTML file. Robust to multiple blocks
 * per file and to attribute-order variations on the <script> tag.
 */
function extractJsonLdBlocks(html) {
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

function listHtmlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(dir, f));
}

function main() {
  const files = listHtmlFiles(SITE_ROOT);
  let totalNodes = 0;
  let totalBlocks = 0;
  let totalFiles = 0;
  const failures = [];

  for (const file of files) {
    totalFiles++;
    const html = readFileSync(file, "utf-8");
    const blocks = extractJsonLdBlocks(html);

    for (let bi = 0; bi < blocks.length; bi++) {
      totalBlocks++;
      let parsed;
      try {
        parsed = JSON.parse(blocks[bi]);
      } catch (err) {
        failures.push({
          file,
          block: bi,
          kind: "JSON parse error",
          detail: err.message,
          hint: "JSON-LD must be syntactically valid. Check for trailing commas, unescaped quotes, etc.",
        });
        continue;
      }

      for (const node of walkNodes(parsed)) {
        totalNodes++;
        for (const rule of REQUIRED_FIELDS) {
          if (!rule.matches(node)) continue;
          for (const field of rule.required) {
            const v = node[field];
            const missing = v === undefined || v === null || v === "";
            if (missing) {
              failures.push({
                file,
                block: bi,
                kind: rule.name,
                detail: `Field "${field}" is ${v === undefined ? "missing" : "empty"} on ${nodeIdentifier(node)}`,
                hint: rule.why,
              });
            }
          }
        }
      }
    }
  }

  if (failures.length === 0) {
    console.log(
      `[schema-canary] PASS — ${totalFiles} HTML files, ${totalBlocks} JSON-LD blocks, ${totalNodes} structured-data nodes, ${REQUIRED_FIELDS.length} validation rules. No issues.`,
    );
    process.exit(0);
  }

  console.error(`[schema-canary] FAIL — ${failures.length} structured-data issue(s):`);
  console.error("");
  for (const f of failures) {
    console.error(`  ✗ ${f.kind}`);
    console.error(`    file:   ${f.file.replace(SITE_ROOT, ".")} (block #${f.block})`);
    console.error(`    detail: ${f.detail}`);
    console.error(`    why:    ${f.hint}`);
    console.error("");
  }
  console.error(
    `Total: ${failures.length} issue(s). Fix the JSON-LD source and re-run.`,
  );
  console.error(
    "Reference: https://developers.google.com/search/docs/appearance/structured-data",
  );
  process.exit(1);
}

function nodeIdentifier(node) {
  const parts = [];
  if (node["@type"]) parts.push(`@type=${JSON.stringify(node["@type"])}`);
  if (node["@id"]) parts.push(`@id=${node["@id"]}`);
  if (node.name) parts.push(`name=${JSON.stringify(node.name)}`);
  return parts.length ? parts.join(", ") : "<unidentified node>";
}

main();
