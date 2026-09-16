/**
 * Conventional Commits, enforced locally by the commit-msg hook and again in CI.
 * Scopes mirror the domain modules in TRD §2 so the vocabulary is identical in every repo.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'tenancy', 'catalogue', 'availability', 'reservations', 'finance', 'storefront',
        'files', 'billing', 'jobs', 'audit', 'auth', 'db', 'config', 'ui', 'deps',
      ],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [1, 'always', 72],
  },
};
