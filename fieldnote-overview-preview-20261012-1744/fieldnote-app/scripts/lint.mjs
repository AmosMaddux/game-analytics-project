import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!/\.(tsx?|mjs)$/.test(entry.name)) continue;
    const source = await readFile(path, 'utf8');
    if (/\b(?:eval|Function)\s*\(/.test(source)) errors.push(`${path}: dynamic execution is forbidden`);
    if (!path.endsWith('/scripts/lint.mjs') && /dangerouslySetInnerHTML|@ts-(?:ignore|nocheck)/.test(source)) errors.push(`${path}: unsafe HTML or suppressed type checking`);
    if (path.includes('/src/') && /\b(?:localStorage|sessionStorage)\b|https?:\/\/[^'"\s]+\.(?:js|css)['"]/.test(source)) errors.push(`${path}: persistent browser storage or remote executable dependency`);
    if (path.includes('/backend/') && /(?:from|import)\s*['"]node:/.test(source)) errors.push(`${path}: Node dependency in Worker backend`);
    if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status) errors.push(result.stderr);
    }
  }
}
for (const directory of ['src', 'backend', 'scripts', 'collectors']) await visit(resolve(root, directory));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Source policy lint and JavaScript syntax checks passed. TypeScript compiler performs semantic checks separately.');
