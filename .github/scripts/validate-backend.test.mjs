import assert from 'node:assert/strict';
import test from 'node:test';

import { getValidationSteps, runValidation } from './validate-backend.mjs';

test('local validation runs the quick contracts and API checks without integration tests', () => {
  const labels = getValidationSteps('local').map(({ label }) => label);

  assert.deepEqual(labels, [
    'Validate this command',
    'Build shared contracts',
    'Lint shared contracts',
    'Test shared contracts',
    'Type-check API',
    'Lint API',
    'Run API unit tests',
    'Build API',
  ]);
  assert.equal(labels.some((label) => label.includes('integration')), false);
});

test('CI validation adds PostgreSQL integration tests before the API build', () => {
  const local = getValidationSteps('local').map(({ label }) => label);
  const ci = getValidationSteps('ci').map(({ label }) => label);

  assert.deepEqual(ci, [
    ...local.slice(0, -1),
    'Run API PostgreSQL integration tests',
    'Build API',
  ]);
});

test('validation stops at the first failed command and names that check', () => {
  const executed = [];
  const errors = [];
  const exitCode = runValidation('local', {
    runCommand(args) {
      executed.push(args);
      return { status: executed.length === 3 ? 7 : 0 };
    },
    log() {},
    error(message) { errors.push(message); },
  });

  assert.equal(exitCode, 7);
  assert.equal(executed.length, 3);
  assert.deepEqual(executed[2], ['run', 'lint', '--workspace', '@drezivo/contracts']);
  assert.match(errors[0], /Lint shared contracts.*exit code 7/);
});

test('local success explicitly says it is not the full GitHub workflow', () => {
  const messages = [];
  const exitCode = runValidation('local', {
    runCommand: () => ({ status: 0 }),
    log(message) { messages.push(message); },
    error() {},
  });

  assert.equal(exitCode, 0);
  assert.match(messages.join('\n'), /integration tests and the container image are not run/);
  assert.match(messages.join('\n'), /full GitHub workflow before opening a backend PR/);
});

test('CI success identifies PostgreSQL coverage and the separate container job', () => {
  const messages = [];
  const exitCode = runValidation('ci', {
    runCommand: () => ({ status: 0 }),
    log(message) { messages.push(message); },
    error() {},
  });

  assert.equal(exitCode, 0);
  assert.match(messages.join('\n'), /PostgreSQL integration tests are included/);
  assert.match(messages.join('\n'), /container image is built by the separate workflow job/);
});
