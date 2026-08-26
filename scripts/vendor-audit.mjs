#!/usr/bin/env node
// Bundled vendor security tracking.
//
// Why this exists: `npm audit --omit=dev` is the release gate, but it only sees
// the dependency tree. Several devDependencies are *bundled by esbuild into
// dist/web/vendor/* at build time* and therefore ship to users inside the npm
// tarball and the Claude Code plugin. Their advisories are invisible to the
// production audit — a structural blind spot, not a configuration mistake.
//
// This script audits exactly those packages and reports what actually ships.
// It is advisory by default (upstream fixes are not always available); pass
// --strict to fail the build on any advisory.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

// package -> the shipped artifact it is bundled into.
const BUNDLED = {
  echarts: "dist/web/vendor/echarts.js",
  marked: "dist/web/vendor/cm.js",
  dompurify: "dist/web/vendor/cm.js",
  "@codemirror/state": "dist/web/vendor/cm.js",
  "@codemirror/view": "dist/web/vendor/cm.js",
  "@codemirror/lang-markdown": "dist/web/vendor/cm.js",
};

const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const versionOf = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? "unknown";

let report;
try {
  report = JSON.parse(
    execFileSync("npm", ["audit", "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  );
} catch (err) {
  // npm audit exits non-zero when it finds advisories; the JSON is still on stdout.
  try {
    report = JSON.parse(err.stdout || "{}");
  } catch {
    console.error("[vendor-audit] could not parse `npm audit --json` output");
    process.exit(STRICT ? 1 : 0);
  }
}

const vulns = report.vulnerabilities ?? {};
const findings = [];
for (const name of Object.keys(BUNDLED)) {
  const v = vulns[name];
  if (!v) continue;
  const via = (v.via ?? [])
    .map((x) => (typeof x === "string" ? x : `${x.title} (${x.url})`))
    .filter(Boolean);
  findings.push({ name, severity: v.severity, range: v.range, via });
}

console.log("Bundled vendor code shipped to users:\n");
for (const [name, artifact] of Object.entries(BUNDLED)) {
  const abs = join(ROOT, artifact);
  const size = existsSync(abs) ? `${(statSync(abs).size / 1024).toFixed(0)} KB` : "not built";
  console.log(`  ${name.padEnd(28)} ${versionOf(name).padEnd(10)} -> ${artifact} (${size})`);
}

if (findings.length === 0) {
  console.log("\n[vendor-audit] no advisories affecting bundled vendor code.");
  process.exit(0);
}

console.log(`\n[vendor-audit] ${findings.length} bundled package(s) with advisories:\n`);
for (const f of findings) {
  console.log(`  ${f.name} (${f.severity}) ${f.range}`);
  for (const v of f.via) console.log(`      - ${v}`);
  console.log(`      ships in: ${BUNDLED[f.name]}`);
}
console.log(
  "\nThese do NOT appear in `npm audit --omit=dev` because the packages are\n" +
  "devDependencies that esbuild inlines into the published bundle.\n"
);

if (STRICT) {
  console.error("[vendor-audit] --strict: failing due to the advisories above.");
  process.exit(1);
}
process.exit(0);
