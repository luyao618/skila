// src/commands/serve.ts — CLI entry for `skila serve` (AC13).
// Starts web server, auto-increments on EADDRINUSE, prints chosen port.
// SIGINT exits cleanly (no orphan handles).

import { loadConfig } from "../config/config.js";

export async function runServe(opts: { port?: number } = {}): Promise<never> {
  const cfg = loadConfig();
  const basePort = opts.port ?? cfg.port ?? 7777;

  const { startServer } = await import("../web/server.js");
  const { port, close, token } = await startServer({ port: basePort });

  process.stdout.write(`skila serve: listening on http://127.0.0.1:${port}\n`);
  process.stdout.write(`skila serve: token=${token}\n`);

  // Clean SIGINT exit (AC13: no orphan handles)
  const shutdown = async () => {
    process.stdout.write("\nskila serve: shutting down…\n");
    await close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Park forever
  await new Promise<never>(() => { /* intentionally never resolves */ });
  // TypeScript needs this — never reached
  process.exit(0);
}
