// StorageAdapter contract (Phase 4 — AC19/AC20/AC21/AC22).
// Implementations: src/storage/git.ts (GitBackedStorage), src/storage/flat.ts (FlatFileStorage).

import type { SkillStatus, SkilaMetadata } from "../types.js";

export interface VersionRecord {
  version: string;
  date: string;
  message: string;
}

export interface WriteSkillMetadata {
  message: string;
  status: SkillStatus;
  /** Optional sidecar metadata; written atomically next to SKILL.md when present. */
  sidecar?: SkilaMetadata;
}

export interface StorageAdapter {
  readonly mode: "git" | "flat";
  init(): Promise<void>;
  writeSkill(name: string, version: string, content: string, metadata: WriteSkillMetadata): Promise<void>;
  moveSkill(name: string, fromStatus: SkillStatus, toStatus: SkillStatus): Promise<void>;
  readSkill(name: string, status: SkillStatus): Promise<string>;
  getVersion(name: string, version: string): Promise<string>;
  listVersions(name: string): Promise<VersionRecord[]>;
  diff(name: string, from: string, to: string): Promise<string>;
  /**
   * Write a supporting file (anything other than SKILL.md) inside a skill directory.
   * Git adapter records a commit; flat adapter just writes the file.
   * @param name the skill name (used to locate the skill dir)
   * @param relativePath path relative to the skill dir (e.g. "scripts/foo.ts")
   * @param content new file contents
   * @param opts.message optional git commit message (git adapter only)
   */
  writeFile(name: string, relativePath: string, content: string, opts?: { message?: string }): Promise<void>;
}

export class StorageAdapterError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}
