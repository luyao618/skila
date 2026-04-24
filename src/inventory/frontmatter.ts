// YAML frontmatter parser/serializer.
// Round-trip preserves key order. Status enum: 4 values.
//
// NOTE (sidecar refactor): SKILL.md no longer stores `skila:` bookkeeping —
// that lives in a sidecar `.skila.json`. The parser still tolerates a legacy
// `skila:` key (for migration); the serializer always strips it so writes
// produce a clean SKILL.md.

import type { SkillFrontmatter, SkillStatus, SkilaMetadata } from "../types.js";
import { normalizeSkila } from "./sidecar.js";

const STATUS_VALUES: SkillStatus[] = ["draft", "staging", "published", "archived"];
const NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

export interface ParsedFrontmatter {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
  /** Present only when the source file still has a legacy `skila:` block. */
  legacySkila?: SkilaMetadata;
}

export function isValidStatus(s: unknown): s is SkillStatus {
  return typeof s === "string" && (STATUS_VALUES as string[]).includes(s);
}

export function isValidName(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 64 && NAME_REGEX.test(s);
}

// Hand-rolled YAML subset parser for our specific frontmatter shape.
// Preserves key order via plain object iteration order.
function parseYamlSubset(yaml: string): Record<string, unknown> {
  const lines = yaml.split("\n");
  const root: Record<string, unknown> = {};
  // stack of {indent, container, lastKey?}
  const stack: { indent: number; container: any; lastKey?: string }[] = [
    { indent: -1, container: root }
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)![0].length;
    const line = rawLine.slice(indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (line.startsWith("- ")) {
      // list item
      const item = line.slice(2);
      const arr = top.container as unknown[];
      if (!Array.isArray(arr)) {
        // attach to lastKey of parent
        const parent = stack[stack.length - 2]?.container as Record<string, unknown> | undefined;
        if (parent && top.lastKey !== undefined) {
          let list = parent[top.lastKey];
          if (!Array.isArray(list)) {
            list = [];
            parent[top.lastKey] = list;
          }
          (list as unknown[]).push(parseInline(item));
        }
      } else {
        arr.push(parseInline(item));
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valuePart = line.slice(colonIdx + 1).trim();

    if (valuePart === "|" || valuePart === ">") {
      // block scalar: collect following indented lines
      const blockLines: string[] = [];
      while (i + 1 < lines.length) {
        const nextRaw = lines[i + 1];
        if (nextRaw.trim() === "") { i++; blockLines.push(""); continue; }
        const nextIndent = nextRaw.match(/^ */)![0].length;
        if (nextIndent <= indent) break;
        i++;
        blockLines.push(nextRaw.slice(indent + 2));
      }
      const blockValue = blockLines.join("\n").trimEnd() + "\n";
      (top.container as Record<string, unknown>)[key] = blockValue;
      top.lastKey = key;
    } else if (valuePart === "") {
      // nested object/array follows
      const obj: Record<string, unknown> = {};
      (top.container as Record<string, unknown>)[key] = obj;
      stack.push({ indent, container: obj, lastKey: key });
      // also remember on parent so list "- " items can find it
      top.lastKey = key;
    } else {
      // force 'version' key to always be a string
      const val = key === "version" ? parseInline(valuePart, true) : parseInline(valuePart);
      (top.container as Record<string, unknown>)[key] = val;
      top.lastKey = key;
    }
  }
  return root;
}

function parseInline(s: string, forceString = false): unknown {
  s = s.trim();
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (!forceString && /^-?\d+$/.test(s)) return parseInt(s, 10);
  if (!forceString && /^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // inline sequence [a, b, c]
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseInline(item.trim()));
  }
  // inline object {a: b, c: d}
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return {};
    const obj: Record<string, unknown> = {};
    // split on top-level commas only (no nesting expected for our schema)
    const parts = inner.split(",");
    for (const p of parts) {
      const ci = p.indexOf(":");
      if (ci === -1) continue;
      const k = p.slice(0, ci).trim().replace(/^["']|["']$/g, "");
      const v = p.slice(ci + 1).trim();
      obj[k] = parseInline(v);
    }
    return obj;
  }
  // strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeYaml(obj: Record<string, unknown>, indent = 0): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      lines.push(`${pad}${k}: null`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${pad}${k}: []`);
      } else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (typeof item === "object" && item !== null) {
            lines.push(`${pad}  - ${serializeInlineObject(item as Record<string, unknown>)}`);
          } else {
            lines.push(`${pad}  - ${formatScalar(item)}`);
          }
        }
      }
    } else if (typeof v === "object") {
      lines.push(`${pad}${k}:`);
      lines.push(serializeYaml(v as Record<string, unknown>, indent + 2));
    } else {
      lines.push(`${pad}${k}: ${formatScalar(v)}`);
    }
  }
  return lines.join("\n");
}

function serializeInlineObject(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(`${k}: ${formatScalar(v)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function formatScalar(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  // Quote if contains special YAML characters that could confuse parsers
  if (/[:\n#\[\]{},&*!|>%@`'"]/.test(s) || s === "" || /^\s/.test(s) || /\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export function parseSkillFile(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---")) {
    throw new Error("missing frontmatter (no leading ---)");
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error("missing frontmatter terminator");
  }
  const yamlSection = raw.slice(3, end).replace(/^\n/, "");
  let bodyStart = end + 4;
  if (raw[bodyStart] === "\n") bodyStart += 1;
  const body = raw.slice(bodyStart);
  const parsedRaw = parseYamlSubset(yamlSection) as Record<string, unknown>;

  // Capture and strip legacy `skila:` block so callers don't accidentally
  // depend on it in the new world.
  let legacySkila: SkilaMetadata | undefined;
  if (parsedRaw.skila && typeof parsedRaw.skila === "object") {
    legacySkila = normalizeSkila(parsedRaw.skila);
    delete parsedRaw.skila;
  }

  return {
    frontmatter: parsedRaw as unknown as SkillFrontmatter,
    body,
    raw,
    legacySkila
  };
}

export function serializeSkillFile(frontmatter: SkillFrontmatter, body: string): string {
  // Defensive: never emit a `skila:` block in SKILL.md anymore.
  const fm = { ...(frontmatter as Record<string, unknown>) };
  delete fm.skila;
  const yaml = serializeYaml(fm);
  return `---\n${yaml}\n---\n${body}`;
}
