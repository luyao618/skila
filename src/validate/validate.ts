// BLOCKING validation. Throws SkilaValidationError on first error.

import { parseSkillFile, isValidName, isValidStatus } from "../inventory/frontmatter.js";
import type { SkillFrontmatter } from "../types.js";

export class SkilaValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

export interface ValidateOptions {
  expectedDirName?: string;
}

export function validateSkillContent(raw: string, opts: ValidateOptions = {}): SkillFrontmatter {
  const errors: string[] = [];
  let parsed;
  try {
    parsed = parseSkillFile(raw);
  } catch (e) {
    throw new SkilaValidationError([(e as Error).message]);
  }
  const fm = parsed.frontmatter;
  if (!fm || typeof fm !== "object") errors.push("frontmatter not an object");
  if (!fm.name) errors.push("missing required: name");
  if (!fm.description) errors.push("missing required: description");
  if (fm.name && !isValidName(fm.name)) errors.push(`invalid name: ${fm.name}`);
  if (fm.description && fm.description.length > 1024) errors.push(`description >1024 chars (${fm.description.length})`);
  if (opts.expectedDirName && fm.name && fm.name !== opts.expectedDirName) {
    errors.push(`name '${fm.name}' != parent dir '${opts.expectedDirName}'`);
  }
  if (!fm.skila) errors.push("missing required: skila block");
  else {
    if (!isValidStatus(fm.skila.status)) errors.push(`invalid status: ${fm.skila.status}`);
    if (typeof fm.skila.version !== "string") errors.push("skila.version must be a string");
    if (!Array.isArray(fm.skila.changelog)) errors.push("skila.changelog must be an array");
  }
  // Path safety: name must not contain path separators (already enforced by regex)
  if (fm.name && (fm.name.includes("/") || fm.name.includes("\\") || fm.name.includes(".."))) {
    errors.push("name path-unsafe");
  }
  if (errors.length > 0) throw new SkilaValidationError(errors);
  return fm;
}
