// Phase 1 postbuild: vendor web assets (esbuild + tailwindcss),
// copy index.html + hooks/feedback.cjs, ensure cli.js is executable
// with a Node shebang. Runs once at build time. No CDN, no runtime bundling.

import { build } from "esbuild";
import { execFile } from "node:child_process";
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
writeFileSync(
  entryShim,
  [
    "// Auto-generated vendor entry consumed only by scripts/postbuild.mjs.",
    "export { EditorState, Compartment } from \"@codemirror/state\";",
    "export { EditorView, keymap, lineNumbers, highlightActiveLine } from \"@codemirror/view\";",
    "export { markdown } from \"@codemirror/lang-markdown\";",
    "export { marked } from \"marked\";",
    ""
  ].join("\n")
);

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

console.log("[postbuild] done.");
