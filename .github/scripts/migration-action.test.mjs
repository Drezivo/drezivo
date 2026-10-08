import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { shouldApplyMigrations } from "./migration-action.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../workflows/ci.yml", import.meta.url)),
  "utf8",
);

test("automatic migration pushes continue to apply pending files", () => {
  assert.equal(shouldApplyMigrations("push", ""), true);
});

test("manual dispatch defaults to read-only status mode", () => {
  assert.equal(shouldApplyMigrations("workflow_dispatch", ""), false);
  assert.equal(shouldApplyMigrations("workflow_dispatch", "status"), false);
});

test("manual apply mode requires an explicit apply choice", () => {
  assert.equal(shouldApplyMigrations("workflow_dispatch", "apply"), true);
});

test("unknown manual actions fail closed", () => {
  assert.throws(
    () => shouldApplyMigrations("workflow_dispatch", "other"),
    /must be "status" or "apply"/,
  );
});

test("workflow defaults manual dispatch to status and gates every apply step", () => {
  assert.match(
    workflow,
    /workflow_dispatch:[\s\S]*?default: status[\s\S]*?options:[\s\S]*?- status[\s\S]*?- apply/,
  );
  assert.match(
    workflow,
    /- name: Apply staging migrations\r?\n\s+if: needs\.staging-migration-scope\.outputs\.apply == 'true'\r?\n\s+run: npm run db:migrate/,
  );
  assert.match(
    workflow,
    /- name: Apply preview migrations\r?\n\s+if: needs\.migration-scope\.outputs\.apply == 'true'\r?\n\s+run: npm run db:migrate/,
  );
  assert.match(
    workflow,
    /production-migrations:[\s\S]*?if: needs\.migration-scope\.outputs\.run == 'true' && needs\.migration-scope\.outputs\.apply == 'true'/,
  );
});
