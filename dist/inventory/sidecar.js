// Sidecar I/O for `.skila.json` — bookkeeping that used to live in SKILL.md
// frontmatter. Plain JSON next to each SKILL.md so disk content stays clean.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { atomicWriteFileSync } from "../storage/atomic.js";
export const SIDECAR_FILENAME = ".skila.json";
export function sidecarPathFor(skillMdPath) {
    return join(dirname(skillMdPath), SIDECAR_FILENAME);
}
export function defaultSkila(status = "published") {
    return {
        version: "0.0.0",
        status,
        parentVersion: null,
        revisionCount: 0,
        lastImprovedAt: "",
        changelog: [],
    };
}
/** Coerce arbitrary input (legacy YAML or JSON) into a SkilaMetadata. */
export function normalizeSkila(raw, fallbackStatus = "published") {
    const r = (raw ?? {});
    const d = defaultSkila(fallbackStatus);
    const status = r.status ?? d.status;
    return {
        version: typeof r.version === "string" ? r.version : d.version,
        status,
        parentVersion: r.parentVersion ?? null,
        revisionCount: typeof r.revisionCount === "number" ? r.revisionCount : 0,
        lastImprovedAt: typeof r.lastImprovedAt === "string" ? r.lastImprovedAt : "",
        changelog: Array.isArray(r.changelog) ? r.changelog : [],
        source: r.source ?? undefined,
    };
}
export function readSidecarIfExists(skillMdPath) {
    const p = sidecarPathFor(skillMdPath);
    if (!existsSync(p))
        return undefined;
    try {
        return normalizeSkila(JSON.parse(readFileSync(p, "utf8")));
    }
    catch {
        return undefined;
    }
}
export function readSidecar(skillMdPath, fallbackStatus = "published") {
    return readSidecarIfExists(skillMdPath) ?? defaultSkila(fallbackStatus);
}
export function writeSidecar(skillMdPath, meta) {
    atomicWriteFileSync(sidecarPathFor(skillMdPath), JSON.stringify(meta, null, 2) + "\n");
}
export function serializeSidecar(meta) {
    return JSON.stringify(meta, null, 2) + "\n";
}
function bumpPatch(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m)
        return "0.0.1";
    return `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`;
}
/** Pure helper: bump patch and append a changelog entry. */
export function bumpAndAppend(meta, change, source) {
    const prev = meta.version || "0.0.0";
    const next = bumpPatch(prev);
    const date = new Date().toISOString();
    return {
        ...meta,
        version: next,
        parentVersion: prev,
        revisionCount: (meta.revisionCount ?? 0) + 1,
        lastImprovedAt: date,
        source: source ?? meta.source,
        changelog: [...(meta.changelog ?? []), { version: next, date, change }],
    };
}
//# sourceMappingURL=sidecar.js.map