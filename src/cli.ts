#!/usr/bin/env node
// skila CLI dispatcher (Phase 1 stub).
// Real subcommand implementations land in Phases 2–5. Each subcommand stub
// prints a "not yet implemented (Phase N)" line and exits 0 so that the
// distribution surface (npm + plugin + smithery) is testable end-to-end before
// behaviour exists.

import { parseArgs } from "node:util";

type StubInfo = { phase: number; description: string };

const SUBCOMMANDS: Record<string, StubInfo> = {
  mcp:        { phase: 3, description: "Run skila as a stdio MCP server (smithery transport)." },
  serve:      { phase: 3, description: "Start the web control panel on 127.0.0.1:7777." },
  distill:    { phase: 2, description: "Distill the current session into NEW or UPDATE skill proposals." },
  promote:    { phase: 2, description: "Promote a draft skill to published." },
  graduate:   { phase: 2, description: "Graduate a staging skill to published." },
  archive:    { phase: 3, description: "Move a skill to .archived-skila/." },
  disable:    { phase: 3, description: "Disable a published skill (CC loader skips)." },
  reactivate: { phase: 3, description: "Reactivate a disabled skill." },
  rollback:   { phase: 3, description: "Roll back a skill to a historical version (creates a new current)." },
  feedback:   { phase: 2, description: "Record manual feedback for a skill." },
  lint:       { phase: 6, description: "Lint a skill package against the quality bar." },
  inspect:    { phase: 3, description: "Print a skill (optionally a specific version) to stdout." },
  list:       { phase: 3, description: "List skills grouped by status." },
  doctor:     { phase: 3, description: "Diagnose environment, storage adapter, and config." },
  selftest:   { phase: 5, description: "Run the e2e evolution-path test against a tmpdir HOME." },
  stats:      { phase: 2, description: "Show judge p50/p95 latency, lock contention, staging backlog." }
};

function printHelp(): void {
  const lines: string[] = [
    "skila — self-improving skill inventory controller",
    "",
    "Usage: skila <command> [options]",
    "",
    "Commands:"
  ];
  const width = Math.max(...Object.keys(SUBCOMMANDS).map((s) => s.length));
  for (const [name, info] of Object.entries(SUBCOMMANDS)) {
    lines.push(`  ${name.padEnd(width)}  ${info.description}  (phase ${info.phase})`);
  }
  lines.push("");
  lines.push("Run `skila <command> --help` for command-specific options once implemented.");
  lines.push("Phase 1 ships only the CLI surface + npm/plugin/smithery wiring; commands are stubs.");
  process.stdout.write(lines.join("\n") + "\n");
}

function printVersion(): void {
  // Version is owned by package.json; avoid runtime fs read here in Phase 1.
  process.stdout.write("@yao/skila 0.1.0\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    printHelp();
    return 0;
  }
  if (argv[0] === "-v" || argv[0] === "--version" || argv[0] === "version") {
    printVersion();
    return 0;
  }

  const cmd = argv[0];
  const stub = SUBCOMMANDS[cmd];
  if (!stub) {
    process.stderr.write(`skila: unknown command '${cmd}'\n`);
    process.stderr.write("Run `skila --help` for the command list.\n");
    return 64; // EX_USAGE
  }

  // parseArgs is invoked even though Phase 1 ignores values — this validates
  // the command line surface contract early and keeps NodeNext-resolved deps
  // honest. Pass tokens=true so unknown subcommand args don't crash.
  try {
    parseArgs({
      args: argv.slice(1),
      strict: false,
      allowPositionals: true
    });
  } catch (err) {
    process.stderr.write(`skila ${cmd}: argument parse error: ${(err as Error).message}\n`);
    return 64;
  }

  process.stdout.write(`skila ${cmd}: not yet implemented (Phase ${stub.phase}).\n`);
  return 0;
}

// Entry — only run when invoked as a script (not when imported, e.g. by hooks).
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return argv1.endsWith("cli.js") || argv1.endsWith("cli.ts");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`skila: fatal: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  });
}
