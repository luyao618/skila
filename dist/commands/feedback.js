// CLI: skila feedback <name> --outcome success|failure|unknown.
import { recordInvocation } from "../feedback/store.js";
import { maybeAutoPromote } from "../promote/auto.js";
export async function runFeedback(name, outcome) {
    await recordInvocation(name, outcome);
    await maybeAutoPromote(name);
}
//# sourceMappingURL=feedback.js.map