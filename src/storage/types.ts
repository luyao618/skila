// StorageAdapter contract (Phase 4 — AC19/AC20/AC21/AC22).
// Implementations: src/storage/git.ts (GitBackedStorage), src/storage/flat.ts (FlatFileStorage).

import type { SkillStatus } from "../types.js";

export interface VersionRecord {
  version: string;
  date: string;
  message: string;
}

export interface WriteSkillMetadata {
  message: string;
  status: SkillStatus;
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
