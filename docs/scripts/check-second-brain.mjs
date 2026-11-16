import fs from 'node:fs';
import path from 'node:path';

const vault = path.resolve('second-brain');
const failures = [];
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(item);
    else if (entry.isFile()) files.push(item);
  }
}
walk(vault);
const names = new Set(files.map((file) => path.basename(file, path.extname(file)).toLowerCase()));
const canonical = files.filter((file) => {
  const rel = path.relative(vault, file).replaceAll('\\', '/');
  return rel.startsWith('04-Decisions/ADRs/') ||
    ['01-Product/Drezivo-PRD.md', '01-Product/Drezivo-Market-Research.md',
      '02-Architecture/Drezivo-TRD.md', '02-Architecture/Drezivo-Data-Model.md',
      '02-Architecture/Drezivo-Data-Model-v2.md', '02-Architecture/2026-09-16-api-response-envelope.md',
      '02-Architecture/Tenancy-Onboarding-Migration-Plan.md', '02-Architecture/object-storage-image-delivery-evolution.md',
      '02-Architecture/operator-console-audit.md', '02-Architecture/operator-workspace-repair.md'].includes(rel);
});
for (const file of canonical) {
  const source = fs.readFileSync(file, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  if (!frontmatter) { failures.push(`${path.relative(vault, file)}: missing frontmatter`); continue; }
  for (const key of ['title', 'type', 'status', 'owner', 'source', 'updated', 'tags']) {
    if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(frontmatter)) failures.push(`${path.relative(vault, file)}: missing ${key}`);
  }
}
for (const file of files.filter((item) => item.endsWith('.md'))) {
  const rel = path.relative(vault, file).replaceAll('\\', '/');
  // Archived plans preserve historical links to material that may no longer be present.
  if (rel.startsWith('99-Archive/')) continue;
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, '');
  source = source.replace(/`+[^`\n]*`+/g, '');
  for (const [, raw] of source.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = raw.split('|')[0].split('#')[0].trim();
    if (target && !names.has(path.basename(target, path.extname(target)).toLowerCase())) {
      failures.push(`${rel}: missing wikilink ${target}`);
    }
  }
}
for (const file of files.filter((item) => item.endsWith('.canvas'))) {
  try {
    const canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ids = new Set();
    for (const node of canvas.nodes ?? []) {
      if (!node.id || ids.has(node.id)) failures.push(`${path.relative(vault, file)}: missing or duplicate node id`);
      ids.add(node.id);
      if (node.type === 'file' && node.file && !fs.existsSync(path.resolve(vault, node.file))) {
        failures.push(`${path.relative(vault, file)}: missing canvas file ${node.file}`);
      }
    }
    const edgeIds = new Set();
    for (const edge of canvas.edges ?? []) {
      if (!edge.id || edgeIds.has(edge.id)) failures.push(`${path.relative(vault, file)}: missing or duplicate edge id`);
      edgeIds.add(edge.id);
      if (!ids.has(edge.fromNode) || !ids.has(edge.toNode)) failures.push(`${path.relative(vault, file)}: dangling edge ${edge.id}`);
    }
  } catch (error) { failures.push(`${path.relative(vault, file)}: invalid canvas (${error.message})`); }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${canonical.length} canonical frontmatter blocks, active wikilinks, and Canvas files.`);
