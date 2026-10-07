import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const check = process.argv.includes('--check');
const workspaces = process.argv.slice(2).filter((arg) => arg !== '--check');
const names = workspaces.length ? workspaces : ['api', 'app', 'web', 'docs', 'contracts'];
const allowed = new Set(['root', 'api', 'app', 'web', 'docs', 'contracts']);
if (names.some((name) => !allowed.has(name))) throw new Error(`target must be one of: ${[...allowed].join(', ')}`);
let drift = false;
for (const name of names) {
  const repo = name === 'root' ? root : path.resolve(root, name);
  const source = path.join(repo, '.claude');
  const target = path.join(repo, '.codex');
  if (!fs.existsSync(source)) { console.warn(`skip ${name}: no .claude`); continue; }
  const entries = [];
  function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else entries.push(p); } }
  walk(source);
  for (const file of entries) {
    const rel = path.relative(source, file);
    if (['settings.json', 'README.md', 'AGENTS.md'].includes(rel) || rel.endsWith('.local.json')) continue;
    const out = path.join(target, rel.replace(/\.js$/, '.cjs'));
    let content = fs.readFileSync(file);
    content = Buffer.from(content.toString().replaceAll('.claude', '.codex'));
    if (check) { if (!fs.existsSync(out) || !content.equals(fs.readFileSync(out))) { console.error(`drift: ${name}/${rel}`); drift = true; } }
    else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, content); }
  }
  const metadata = {
    settings: fs.existsSync(path.join(source, 'settings.json'))
      ? fs.readFileSync(path.join(source, 'settings.json'), 'utf8').replaceAll('.claude', '.codex').replace(/\.js(?=[\\"\s]|$)/g, '.cjs')
      : '{\n  "note": "Reference only; configure native Codex settings separately."\n}\n',
    readme: '# Codex configuration mirror\n\nGenerated from `.claude`; this directory is reference material. Hooks are not auto-executed by Codex.\nSee `settings.reference.json` for adapted settings examples.\n',
    agents: '# Agent instructions\n\nRead the mirrored guidance in `.codex/` and the canonical `.claude/` rules.\n',
  };
  const generated = new Map([
    ['settings.reference.json', Buffer.from(metadata.settings)],
    ['README.md', Buffer.from(metadata.readme)],
    ['AGENTS.md', Buffer.from(metadata.agents)],
  ]);
  for (const [rel, content] of generated) {
    const out = path.join(target, rel);
    if (check) { if (!fs.existsSync(out) || !content.equals(fs.readFileSync(out))) { console.error(`drift: ${name}/.codex/${rel}`); drift = true; } }
    else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, content); }
  }
}
if (check && drift) process.exitCode = 1;
else console.log(`${check ? 'checked' : 'synced'} ${names.length} repo configuration mirrors`);

