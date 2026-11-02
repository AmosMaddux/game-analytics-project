import { cp, mkdir, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appRoot } from './database.mjs';

const release = resolve(appRoot, 'release');
const target = resolve(release, 'fieldnote-app');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// Positive allowlist: no environment, database, node_modules, raw research or user secrets.
for (const name of ['src', 'backend', 'collectors', 'migrations', 'scripts', 'tests', 'evidence', 'seed', 'public', 'dist', 'build', 'package.json', 'package-lock.json', 'tsconfig.json', 'index.html', 'README.md', 'RELEASE-EVIDENCE-IMPORT.md', 'REDESIGN-INTEGRATION.md', 'COLLECTION.md', 'wrangler.example.jsonc', '.gitignore']) {
  await cp(resolve(appRoot, name), resolve(target, name), { recursive: true, dereference: false });
}
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const local = relative(target, path);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Release contains symlink: ${local}`);
    if (/(^|\/)(?:\.env[^/]*|\.data|node_modules|credentials[^/]*|secrets|private)(\/|$)|\.(?:sqlite|pem|key)$/.test(local)) throw new Error(`Private file rejected: ${local}`);
    if (entry.isDirectory()) await visit(path);
    else files.push({ path: local, bytes: (await lstat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
await visit(target);
await writeFile(resolve(target, 'release-manifest.json'), JSON.stringify({ release: 'fieldnote-release-research-offline', generatedAt: new Date().toISOString(), files }, null, 2) + '\n');
const archive = resolve(release, 'fieldnote-release-research-offline.zip');
await rm(archive, { force: true });
const result = spawnSync('python3', ['-c', 'import os,sys,zipfile\nroot,out=sys.argv[1:]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n for base,ds,fs in os.walk(root):\n  for f in sorted(fs):\n   p=os.path.join(base,f);z.write(p,os.path.relpath(p,os.path.dirname(root)))', target, archive], { encoding: 'utf8' });
if (result.status) throw new Error(result.stderr);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  fieldnote-release-research-offline.zip\n`);
console.log(JSON.stringify({ archive, sha256, files: files.length + 1, nodeRuntimeOnly: true }));
