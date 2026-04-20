// CLI: skila list [--status ...].
import { scanInventory } from "../inventory/scanner.js";
export function runList(filter) {
    const inv = scanInventory();
    const filtered = filter ? inv.filter((s) => s.status === filter) : inv;
    return filtered.map((s) => ({
        name: s.name,
        status: s.status,
        version: s.frontmatter.skila?.version ?? "?"
    }));
}
//# sourceMappingURL=list.js.map