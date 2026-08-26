// Phase 1 postbuild: vendor web assets (esbuild + tailwindcss),
// copy index.html + hooks/feedback.cjs, ensure cli.js is executable
// with a Node shebang. Runs once at build time. No CDN, no runtime bundling.

import { build } from "esbuild";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");
const VENDOR_DIR = join(DIST, "web", "vendor");
const HOOKS_OUT = join(DIST, "hooks");

mkdirSync(VENDOR_DIR, { recursive: true });
mkdirSync(HOOKS_OUT, { recursive: true });
mkdirSync(join(DIST, "web"), { recursive: true });

// 1. esbuild: bundle CodeMirror 6 + marked → dist/web/vendor/cm.js (single ESM, minified)
console.log("[postbuild] esbuild: bundling CodeMirror + marked → dist/web/vendor/cm.js");
const entryShim = join(SRC, "web", "vendor-entry.mjs");
mkdirSync(dirname(entryShim), { recursive: true });
// Always rewrite: this file is gitignored, so a stale copy from an older
// checkout would silently omit newer exports (e.g. the DOMPurify sanitizer)
// from the vendor bundle.
const ENTRY_SHIM_SOURCE = [
  "// Auto-generated vendor entry consumed only by scripts/postbuild.mjs.",
  "export { EditorState, Compartment } from \"@codemirror/state\";",
  "export { EditorView, keymap, lineNumbers, highlightActiveLine } from \"@codemirror/view\";",
  "export { markdown } from \"@codemirror/lang-markdown\";",
  "export { marked } from \"marked\";",
  "export { default as DOMPurify } from \"dompurify\";",
  ""
].join("\n");
writeFileSync(entryShim, ENTRY_SHIM_SOURCE);

await build({
  entryPoints: [entryShim],
  bundle: true,
  format: "esm",
  target: "esnext",
  minify: true,
  outfile: join(VENDOR_DIR, "cm.js"),
  logLevel: "info",
  treeShaking: true,
  legalComments: "none"
});

// 2. tailwindcss CLI → dist/web/vendor/tw.css (purged, minified)
console.log("[postbuild] tailwindcss: building dist/web/vendor/tw.css");
const tailwindConfigPath = join(ROOT, "tailwind.config.cjs");
if (!existsSync(tailwindConfigPath)) {
  writeFileSync(
    tailwindConfigPath,
    [
      "/** @type {import('tailwindcss').Config} */",
      "module.exports = {",
      "  content: [\"./src/web/**/*.html\", \"./src/web/**/*.ts\"],",
      "  theme: { extend: {} },",
      "  plugins: []",
      "};",
      ""
    ].join("\n")
  );
}
const tailwindInput = join(SRC, "web", "tw-input.css");
if (!existsSync(tailwindInput)) {
  writeFileSync(
    tailwindInput,
    "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n"
  );
}
const twBin = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss");
try {
  const { stdout, stderr } = await execFileP(twBin, [
    "-c", tailwindConfigPath,
    "-i", tailwindInput,
    "-o", join(VENDOR_DIR, "tw.css"),
    "--minify"
  ]);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (err) {
  console.error("[postbuild] tailwindcss build failed:", err.message);
  throw err;
}

// 2b. esbuild: bundle echarts → dist/web/vendor/echarts.js (IIFE, minified, global 'echarts')
console.log("[postbuild] esbuild: bundling echarts → dist/web/vendor/echarts.js");
await build({
  entryPoints: [join(ROOT, "node_modules", "echarts", "index.js")],
  bundle: true,
  format: "iife",
  globalName: "echarts",
  target: "esnext",
  minify: true,
  outfile: join(VENDOR_DIR, "echarts.js"),
  logLevel: "info",
  treeShaking: true,
  legalComments: "none",
});

// 3. Copy index.html → dist/web/index.html
console.log("[postbuild] copying src/web/index.html → dist/web/index.html");
copyFileSync(join(SRC, "web", "index.html"), join(DIST, "web", "index.html"));
// Copy any additional .html siblings (e.g. partials)
for (const f of readdirSync(join(SRC, "web"))) {
  if (f.endsWith(".html") && f !== "index.html") {
    copyFileSync(join(SRC, "web", f), join(DIST, "web", f));
  }
}

// 4. Copy src/hooks/feedback.cjs → dist/hooks/feedback.cjs
console.log("[postbuild] copying src/hooks/feedback.cjs → dist/hooks/feedback.cjs");
copyFileSync(join(SRC, "hooks", "feedback.cjs"), join(HOOKS_OUT, "feedback.cjs"));

// FIX-H23: esbuild: bundle src/feedback/collector.ts → dist/hooks/feedback-entry.cjs
// CommonJS output, tree-shaken, target Node 20+.
console.log("[postbuild] esbuild: bundling src/feedback/collector.ts → dist/hooks/feedback-entry.cjs");
await build({
  entryPoints: [join(SRC, "feedback", "collector.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: true,
  treeShaking: true,
  legalComments: "none",
  outfile: join(HOOKS_OUT, "feedback-entry.cjs"),
  logLevel: "info",
});

// 5. Ensure dist/cli.js has shebang + is executable
const cliPath = join(DIST, "cli.js");
if (existsSync(cliPath)) {
  let body = readFileSync(cliPath, "utf8");
  if (!body.startsWith("#!")) {
    body = "#!/usr/bin/env node\n" + body;
    writeFileSync(cliPath, body);
  }
  chmodSync(cliPath, 0o755);
  console.log("[postbuild] dist/cli.js: shebang + chmod +x");
} else {
  console.warn("[postbuild] WARNING: dist/cli.js not found — did tsc run?");
}

// FIX-M12: AC16 CDN check — dist/web/index.html must not contain any https:// URLs
const indexHtmlPath = join(DIST, "web", "index.html");
if (existsSync(indexHtmlPath)) {
  const indexContent = readFileSync(indexHtmlPath, "utf8");
  const cdnMatches = indexContent.match(/https:\/\//g);
  if (cdnMatches && cdnMatches.length > 0) {
    console.error(`[postbuild] AC16 violation: dist/web/index.html contains ${cdnMatches.length} https:// reference(s). Remove all CDN links.`);
    process.exit(1);
  }
  console.log("[postbuild] AC16 CDN check passed: no https:// in dist/web/index.html");
} else {
  console.warn("[postbuild] WARNING: dist/web/index.html not found — skipping AC16 CDN check");
}

// CSP inline-script hashes. Computed from the FINAL dist/web/index.html — the
// same bytes the browser will execute — so the header can never drift from the
// served page. Any inline handler (onclick=) would need 'unsafe-hashes' to run,
// which defeats the point, so bail instead: use addEventListener.
const cspHashesPath = join(DIST, "web", "csp-hashes.json");
if (existsSync(indexHtmlPath)) {
  const html = readFileSync(indexHtmlPath, "utf8");

  const inlineHandlers = html.match(/\son[a-z]+\s*=\s*["']/gi);
  if (inlineHandlers) {
    console.error(
      `[postbuild] CSP violation: dist/web/index.html has ${inlineHandlers.length} inline event handler(s) ` +
      `(${[...new Set(inlineHandlers.map(h => h.trim().split(/[\s=]/)[0]))].join(", ")}). ` +
      `Use addEventListener — inline handlers would require 'unsafe-hashes'.`
    );
    process.exit(1);
  }

  const hashes = [];
  // Only bodyless <script> blocks are inline; <script src=...> is covered by 'self'.
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1];
    if (body.trim() === "") continue;
    hashes.push(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`);
  }

  const styleHashes = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = m[1];
    if (body.trim() === "") continue;
    styleHashes.push(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`);
  }

  // styleSrc is recorded for reference only — server.ts does not use it. CSP
  // hashes cannot authorise `style="..."` attributes (18 of them in the markup)
  // and ECharts injects styles at runtime, so style-src keeps 'unsafe-inline'.
  writeFileSync(cspHashesPath, JSON.stringify({ scriptSrc: hashes, styleSrc: styleHashes }, null, 2) + "\n");
  console.log(`[postbuild] CSP hashes: ${hashes.length} inline script(s) → dist/web/csp-hashes.json`);
} else {
  console.warn("[postbuild] WARNING: dist/web/index.html not found — skipping CSP hash generation");
}

console.log("[postbuild] done.");
