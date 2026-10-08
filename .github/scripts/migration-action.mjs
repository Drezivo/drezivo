import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function shouldApplyMigrations(eventName, requestedAction) {
  if (eventName === "push") return true;
  if (eventName !== "workflow_dispatch") return false;

  if (requestedAction === "apply") return true;
  if (requestedAction === "status" || requestedAction === "") return false;

  throw new Error('Manual migration action must be "status" or "apply".');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [eventName, requestedAction = ""] = process.argv.slice(2);
    if (!eventName) throw new Error("A workflow event name is required.");
    process.stdout.write(
      `${shouldApplyMigrations(eventName, requestedAction)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
