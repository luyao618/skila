#!/usr/bin/env node
// skila CLI dispatcher (Phase 2 — real implementations).
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
// Custom error class for user-facing errors (FIX-H20)
export class SkilaError extends Error {
    hint;
    constructor(message, hint) {
        super(message);
        this.name = "SkilaError";
        this.hint = hint;
    }
}
const VALID_OUTCOMES = new Set(["success", "failure", "unknown"]);
const VALID_STATUSES = new Set(["draft", "staging", "published", "archived", "disabled"]);
async function dispatch(argv) {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
        process.stdout.write("skila — self-improving skill inventory controller\n\nCommands: distill, promote, graduate, reject, archive, disable, reactivate, rollback, feedback, lint, inspect, list, mcp, serve, doctor, stats\n");
        return 0;
    }
    if (argv[0] === "-v" || argv[0] === "--version" || argv[0] === "version") {
        process.stdout.write("@luyao618/skila 0.0.1\n");
        return 0;
    }
    const cmd = argv[0];
    const rest = argv.slice(1);
    let parsed;
    try {
        parsed = parseArgs({
            args: rest,
            strict: false,
            allowPositionals: true,
            options: {
                "from-fixture": { type: "string" },
                "dry-run": { type: "boolean" },
                "outcome": { type: "string" },
                "to": { type: "string" },
                "version": { type: "string" },
                "status": { type: "string" },
                "fix-storage": { type: "boolean" },
                "yes": { type: "boolean" },
                "port": { type: "string" },
                "content-file": { type: "string" }
            }
        });
    }
    catch (err) {
        process.stderr.write(`skila ${cmd}: argument parse error: ${err.message}\n`);
        return 64;
    }
    const positionals = parsed.positionals;
    const values = parsed.values;
    // FIX-H21: enum validation
    if (values["outcome"] !== undefined && !VALID_OUTCOMES.has(values["outcome"])) {
        process.stderr.write(`skila: invalid --outcome '${values["outcome"]}' (must be one of: success, failure, unknown)\n`);
        return 64;
    }
    if (values["status"] !== undefined && !VALID_STATUSES.has(values["status"])) {
        process.stderr.write(`skila: invalid --status '${values["status"]}' (must be one of: draft, staging, published, archived, disabled)\n`);
        return 64;
    }
    switch (cmd) {
        case "distill": {
            const { runDistill } = await import("./commands/distill.js");
            const fromFixture = values["from-fixture"];
            const dryRun = values["dry-run"] === true || values["dry-run"] === "true";
            const result = await runDistill({ fromFixture, dryRun });
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            return 0;
        }
        case "promote": {
            const { runPromote } = await import("./commands/promote.js");
            const r = await runPromote(positionals[0]);
            process.stdout.write(JSON.stringify(r) + "\n");
            return 0;
        }
        case "graduate": {
            const { runGraduate } = await import("./commands/graduate.js");
            process.stdout.write(JSON.stringify(await runGraduate(positionals[0])) + "\n");
            return 0;
        }
        case "reject": {
            const { runReject } = await import("./commands/reject.js");
            process.stdout.write(JSON.stringify(await runReject(positionals[0])) + "\n");
            return 0;
        }
        case "archive": {
            const { runArchive } = await import("./commands/archive.js");
            process.stdout.write(JSON.stringify(await runArchive(positionals[0])) + "\n");
            return 0;
        }
        case "disable": {
            const { runDisable } = await import("./commands/disable.js");
            process.stdout.write(JSON.stringify(await runDisable(positionals[0])) + "\n");
            return 0;
        }
        case "reactivate": {
            const { runReactivate } = await import("./commands/reactivate.js");
            process.stdout.write(JSON.stringify(await runReactivate(positionals[0])) + "\n");
            return 0;
        }
        case "rollback": {
            const { runRollback } = await import("./commands/rollback.js");
            const to = values["to"] ?? positionals[1];
            process.stdout.write(JSON.stringify(await runRollback(positionals[0], to)) + "\n");
            return 0;
        }
        case "feedback": {
            const { runFeedback } = await import("./commands/feedback.js");
            const outcome = (values["outcome"] ?? "success");
            await runFeedback(positionals[0], outcome);
            return 0;
        }
        case "lint": {
            const { runLint } = await import("./commands/lint.js");
            const out = runLint(positionals[0] ?? ".");
            process.stdout.write(JSON.stringify(out, null, 2) + "\n");
            return out.errors.length > 0 ? 1 : 0;
        }
        case "inspect": {
            const { runInspect } = await import("./commands/inspect.js");
            const out = await runInspect(positionals[0], values["version"]);
            process.stdout.write(out.content);
            return 0;
        }
        case "list": {
            const { runList } = await import("./commands/list.js");
            const out = runList(values["status"]);
            process.stdout.write(JSON.stringify(out, null, 2) + "\n");
            return 0;
        }
        case "mcp": {
            const { runMcpServer } = await import("./commands/mcp.js");
            await runMcpServer();
            return 0;
        }
        case "serve": {
            const { runServe } = await import("./commands/serve.js");
            const portArg = values["port"] ? parseInt(values["port"], 10) : undefined;
            await runServe({ port: portArg });
            return 0; // unreachable
        }
        case "migrate-sidecar": {
            const { runMigrateSidecar } = await import("./inventory/migrate.js");
            const r = runMigrateSidecar();
            process.stdout.write(JSON.stringify(r, null, 2) + "\n");
            return r.errors.length > 0 ? 1 : 0;
        }
        case "install-hooks": {
            const { runInstallHooks } = await import("./commands/install-hooks.js");
            runInstallHooks();
            return 0;
        }
        case "stats":
            process.stdout.write(`skila stats: not yet implemented (Phase 3+)\n`);
            return 0;
        case "doctor": {
            if (positionals[0] === "storage" || values["fix-storage"] !== undefined) {
                const { runFixStorage } = await import("./commands/doctor.js");
                const yes = values["yes"] === true || values["yes"] === "true";
                const r = await runFixStorage({ yes });
                process.stdout.write(JSON.stringify(r, null, 2) + "\n");
                return 0;
            }
            const { runDoctor } = await import("./commands/doctor.js");
            const report = await runDoctor();
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
            return report.ok ? 0 : 1;
        }
        case "selftest": {
            const { runSelftest } = await import("./commands/doctor.js");
            const r = await runSelftest();
            process.stdout.write(JSON.stringify(r, null, 2) + "\n");
            return r.ok ? 0 : 1;
        }
        case "storage":
            process.stderr.write(`skila: unknown command 'storage' (use 'skila doctor --fix-storage' to reconcile storage)\n`);
            return 64;
        case "files": {
            const { runFilesList, runFilesWrite, runFilesRemove } = await import("./commands/files.js");
            const sub = positionals[0]; // list, write, remove
            const skillName = positionals[1];
            if (!sub || !skillName) {
                process.stderr.write("Usage: skila files <list|write|remove> <skill-name> [file-path] [--content-file <path>]\n");
                return 64;
            }
            let result;
            switch (sub) {
                case "list":
                    result = runFilesList(skillName);
                    break;
                case "write": {
                    const fp = positionals[2];
                    if (!fp) {
                        process.stderr.write("skila files write: file-path required\n");
                        return 64;
                    }
                    const contentFile = values["content-file"];
                    result = runFilesWrite(skillName, fp, contentFile);
                    break;
                }
                case "remove": {
                    const fp = positionals[2];
                    if (!fp) {
                        process.stderr.write("skila files remove: file-path required\n");
                        return 64;
                    }
                    result = runFilesRemove(skillName, fp);
                    break;
                }
                default:
                    process.stderr.write(`skila files: unknown subcommand '${sub}'\n`);
                    return 64;
            }
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            return result.success ? 0 : 1;
        }
        default:
            process.stderr.write(`skila: unknown command '${cmd}'\n`);
            return 64;
    }
}
// Bridge for hook to call collectFeedback synchronously.
export { collectFeedback } from "./feedback/collector.js";
export async function main(argv = process.argv.slice(2)) {
    try {
        return await dispatch(argv);
    }
    catch (err) {
        if (err instanceof SkilaError) {
            process.stderr.write(`skila: ${err.message}\n`);
            if (err.hint)
                process.stderr.write(`hint: ${err.hint}\n`);
            if (process.env.SKILA_DEBUG === "1")
                process.stderr.write((err.stack ?? "") + "\n");
            return 1;
        }
        throw err;
    }
}
// FIX-H19: Detect direct invocation via import.meta.url
// Resolve symlinks so npm global bin symlinks still match import.meta.url.
const invokedDirectly = (() => {
    try {
        const argv1 = process.argv[1] ?? "";
        const resolved = realpathSync(argv1);
        const fileUrl = pathToFileURL(resolved).href;
        return import.meta.url === fileUrl;
    }
    catch {
        return false;
    }
})();
if (invokedDirectly) {
    main().then((code) => process.exit(code)).catch((err) => {
        if (err instanceof SkilaError) {
            process.stderr.write(`skila: ${err.message}\n`);
            if (err.hint)
                process.stderr.write(`hint: ${err.hint}\n`);
            if (process.env.SKILA_DEBUG === "1")
                process.stderr.write(err.stack + "\n");
        }
        else {
            process.stderr.write(`skila: fatal: ${err.stack ?? err}\n`);
        }
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map