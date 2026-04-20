// StorageAdapter contract (Phase 4 — AC19/AC20/AC21/AC22).
// Implementations: src/storage/git.ts (GitBackedStorage), src/storage/flat.ts (FlatFileStorage).
export class StorageAdapterError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.code = code;
        this.hint = hint;
    }
}
//# sourceMappingURL=types.js.map