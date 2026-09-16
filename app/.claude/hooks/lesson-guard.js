#!/usr/bin/env node
/**
 * lesson-guard.js — Stop hook for the self-improving-memory system.
 *
 * Purpose: when a session changed code but did NOT record a lesson, block the
 * stop ONCE and ask the model to record any durable lesson (bug, gotcha, wrong
 * assumption) it learned.
 *
 * Detection:
 *  - "code changed" → `git status` working-tree changes to code-like files.
 *  - "lesson recorded" → `.claude/rules/lessons.md` modification time is at or
 *    after the newest changed code file's mtime. We use mtime, NOT git, on
 *    purpose: many repos gitignore markdown (e.g. a blanket `*.md`), which would
 *    make a git-based check blind to lessons.md and block forever.
 *
 * Why it terminates cleanly: once the model edits lessons.md, its mtime moves
 * past the code files', so the next stop passes. Exactly one reflection per
 * code-changing session.
 *
 * Silent no-op when: not a git repo, git missing, or no code changed.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CODE_EXT = /\.(js|cjs|mjs|ts|tsx|jsx|dart|py|go|rs|java|kt|php|rb|c|h|cpp|hpp|cs|swift|vue|svelte|sql|sh)$/i;
const LESSONS_REL = path.join('.claude', 'rules', 'lessons.md');

function changedFiles() {
  try {
    const out = execSync('git status --porcelain --untracked-files=all', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, ''));
  } catch (_e) {
    return null; // not a git repo / git unavailable
  }
}

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_e) {
    return null;
  }
}

function block() {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'Self-improving memory check: code changed this session but ' +
        '.claude/rules/lessons.md was not updated afterward. If you fixed a bug, ' +
        'hit a gotcha, or corrected a wrong assumption, append a concise lesson ' +
        '(newest on top, dated) to .claude/rules/lessons.md so it never repeats. ' +
        'If there is genuinely no durable lesson, append a one-line note under ' +
        "today's date saying so. Either way, save lessons.md and then stop — this " +
        'check passes once that file is newer than the changed code.',
    }),
  );
  process.exit(0);
}

function main() {
  const files = changedFiles();
  if (files === null) process.exit(0);

  const codeFiles = files.filter((f) => {
    const norm = f.replace(/\\/g, '/');
    return !norm.includes('.claude/') && !norm.includes('.codex/') && CODE_EXT.test(norm);
  });
  if (codeFiles.length === 0) process.exit(0);

  const lessonsMtime = mtime(LESSONS_REL);
  if (lessonsMtime === null) block(); // no lessons file yet → ask to create one

  const newestCode = codeFiles
    .map((f) => mtime(f))
    .filter((m) => m !== null)
    .reduce((a, b) => Math.max(a, b), 0);

  // Lesson recorded at/after the last code edit → satisfied. Small negative skew
  // tolerance for filesystem timestamp granularity.
  if (lessonsMtime + 1000 >= newestCode) process.exit(0);

  block();
}

main();
