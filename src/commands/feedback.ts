// CLI: skila feedback <name> --outcome success|failure|unknown.
import { recordInvocation } from "../feedback/store.js";
import { maybeAutoPromote } from "../promote/auto.js";

export async function runFeedback(name: string, outcome: "success" | "failure" | "unknown"): Promise<void> {
  await recordInvocation(name, outcome);
  await maybeAutoPromote(name);
}
