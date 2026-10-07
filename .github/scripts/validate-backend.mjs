import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const commonSteps = [
  { label: 'Validate this command', args: ['run', 'test:backend-validation'] },
  { label: 'Build shared contracts', args: ['run', 'build', '--workspace', '@drezivo/contracts'] },
  { label: 'Lint shared contracts', args: ['run', 'lint', '--workspace', '@drezivo/contracts'] },
  { label: 'Test shared contracts', args: ['run', 'test', '--workspace', '@drezivo/contracts'] },
  { label: 'Type-check API', args: ['run', 'typecheck', '--workspace', '@drezivo/api'] },
  { label: 'Lint API', args: ['run', 'lint', '--workspace', '@drezivo/api'] },
  { label: 'Run API unit tests', args: ['run', 'test', '--workspace', '@drezivo/api'] },
];

const apiBuild = { label: 'Build API', args: ['run', 'build', '--workspace', '@drezivo/api'] };

const validationPlans = {
  local: commonSteps.concat(apiBuild),
  ci: commonSteps.concat(
    { label: 'Run API PostgreSQL integration tests', args: ['run', 'test:integration', '--workspace', '@drezivo/api'] },
    apiBuild,
  ),
};

export function getValidationSteps(mode) {
  const steps = validationPlans[mode];
  if (!steps) throw new Error(`Unknown backend validation mode "${mode}". Use "local" or "ci".`);
  return steps;
}

export function runValidation(mode, { runCommand = runNpmCommand, log = console.log, error = console.error } = {}) {
  const steps = getValidationSteps(mode);

  if (mode === 'local') {
    log('Local backend preflight: PostgreSQL integration tests and the container image are not run here.');
  } else {
    log('CI backend validation: PostgreSQL integration tests are included; the container image is built by the separate workflow job.');
  }

  for (const [index, step] of steps.entries()) {
    const command = `npm ${step.args.join(' ')}`;
    log(`\n[${index + 1}/${steps.length}] ${step.label}\n> ${command}`);

    const result = runCommand(step.args);
    if (result.error) {
      error(`Backend validation stopped at "${step.label}": ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      const exitCode = result.status ?? 1;
      error(`Backend validation stopped at "${step.label}" with exit code ${exitCode}.`);
      return exitCode;
    }
  }

  if (mode === 'local') {
    log('\nLocal backend preflight passed. Run the full GitHub workflow before opening a backend PR.');
  } else {
    log('\nBackend checks passed. The workflow container job remains a separate required check.');
  }

  return 0;
}

function runNpmCommand(args) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    return {
      error: new Error('Run this script through `npm run validate:backend:local` or `npm run validate:backend:ci`.'),
      status: 1,
    };
  }

  return spawnSync(process.execPath, [npmCliPath, ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  try {
    process.exitCode = runValidation(mode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
