import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { shouldApplyMigrations } from "./migration-action.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../workflows/ci.yml", import.meta.url)),
  "utf8",
).replaceAll("\r\n", "\n");

function migrationJob(name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing workflow job ${name}`);
  const nextJob = workflow.slice(start + 1).search(/\n  [a-z][a-z-]+:\n/);
  return workflow.slice(
    start,
    nextJob === -1 ? undefined : start + 1 + nextJob,
  );
}

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
    migrationJob("production-migrations"),
    /if: needs\.migration-scope\.outputs\.run == 'true' && needs\.migration-scope\.outputs\.apply == 'true'/,
  );
  assert.match(
    migrationJob("production-migrations"),
    /needs: \[backend, container, secrets, migration-scope, preview-migrations\]/,
  );
});

test("migration jobs run when migration runner/history code changes", () => {
  assert.equal(
    (workflow.match(/grep -E '\^api\/scripts\/\(migrate/g) ?? []).length,
    2,
  );
  assert.equal((workflow.match(/runner_files="\$\(printf/g) ?? []).length, 2);
});

test("each migration job reports the exact gap and applies it before the normal migration run", () => {
  const stages = [
    ["staging-migrations", "staging"],
    ["preview-migrations", "preview"],
    ["production-migrations", "production"],
  ];
  const targetedStatus =
    "npm run db:migrate:status --workspace @drezivo/api -- --through 0084_session_audit_uniqueness_repair.sql";

  for (const [jobName, environment] of stages) {
    const job = migrationJob(jobName);
    const statusIndex = job.indexOf(targetedStatus);
    const targetedApplyIndex = job.indexOf(
      "npm run db:migrate --workspace @drezivo/api -- --through 0084_session_audit_uniqueness_repair.sql",
    );
    const fullApplyIndex = job.indexOf(
      "npm run db:migrate --workspace @drezivo/api\n",
    );

    assert.notEqual(
      statusIndex,
      -1,
      `${environment} must report the targeted status`,
    );
    assert.ok(
      targetedApplyIndex > statusIndex,
      `${environment} must report before applying`,
    );
    assert.ok(
      fullApplyIndex > targetedApplyIndex,
      `${environment} must apply the target first`,
    );
    assert.match(
      job,
      new RegExp(
        `Verify ${environment} migration status[\\s\\S]*?run: npm run db:migrate:status --workspace @drezivo/api`,
      ),
    );
  }
});
