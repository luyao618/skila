// Shared name + version validators for the storage layer (FIX-H5).
import { StorageAdapterError } from "./types.js";
// Matches lowercase alphanumeric names with optional dots, underscores, hyphens.
// Must start with an alphanumeric character. Max 64 chars.
export const NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
// Strict semver: MAJOR.MINOR.PATCH with optional pre-release identifier.
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
export function assertValidName(name) {
    if (typeof name !== "string" || name.length === 0 || name.length > 64 || !NAME_REGEX.test(name)) {
        throw new StorageAdapterError("E_INVALID_NAME", `invalid skill name: ${JSON.stringify(name)} — must match ${NAME_REGEX} and be 1–64 chars`);
    }
}
export function assertValidVersion(version) {
    if (typeof version !== "string" || !SEMVER_REGEX.test(version)) {
        throw new StorageAdapterError("E_INVALID_VERSION", `invalid version: ${JSON.stringify(version)} — must match strict semver (MAJOR.MINOR.PATCH)`);
    }
}
//# sourceMappingURL=validate.js.map