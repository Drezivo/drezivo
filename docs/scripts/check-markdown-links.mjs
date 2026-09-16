import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['node_modules', 'archive', '.claude', '.codex']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
}
walk(root);
const headings = new Map();
for (const file of files) {
  const ids = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (match) ids.add(match[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  headings.set(file, ids);
}
const failures = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const [, raw] of text.matchAll(re)) {
    if (/^(?:https?:|mailto:|tel:|data:)/i.test(raw)) continue;
    const [target, anchor] = raw.split('#', 2);
    const resolved = target ? path.resolve(path.dirname(file), target) : file;
    if (!fs.existsSync(resolved) || (fs.statSync(resolved).isDirectory() && !fs.existsSync(path.join(resolved, 'README.md')))) {
      failures.push(`${path.relative(root, file)}: missing ${raw}`); continue;
    }
    if (anchor && resolved.endsWith('.md') && !headings.get(resolved)?.has(anchor.toLowerCase()))
      failures.push(`${path.relative(root, file)}: missing anchor ${raw}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${files.length} markdown files; all local links resolve.`);
