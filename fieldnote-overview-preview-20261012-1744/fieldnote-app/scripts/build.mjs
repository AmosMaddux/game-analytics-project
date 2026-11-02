import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, rename, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertRegularInput, assertSourceTree } from './public-input.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
await assertRegularInput(root, 'index.html');
await assertRegularInput(root, 'public/docs/roadmap.docx');
await assertSourceTree(root, 'src');
await assertSourceTree(root, 'backend');
const stage = resolve(root, '.build-stage');
await rm(stage, { recursive: true, force: true });
await mkdir(resolve(stage, 'public/assets'), { recursive: true });
await mkdir(resolve(stage, 'public/docs'), { recursive: true });
await mkdir(resolve(stage, 'server'), { recursive: true });
try {
  const frontend = await build({ absWorkingDir: root, entryPoints: ['src/main.tsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: resolve(stage, 'public/assets/app.js'), metafile: true, legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' } });
  for (const input of Object.keys(frontend.metafile.inputs)) {
    if (!/^(src|node_modules)\//.test(input) || /(^|\/)\.env/.test(input)) throw new Error(`Private input reached frontend: ${input}`);
  }
  await build({ absWorkingDir: root, entryPoints: ['backend/worker.ts'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: resolve(stage, 'server/worker.mjs'), legalComments: 'eof' });
  await build({ absWorkingDir: root, entryPoints: ['backend/seed.ts'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: resolve(stage, 'server/seed.mjs'), legalComments: 'eof' });
  await build({ absWorkingDir: root, entryPoints: ['backend/collection-import.ts'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: resolve(stage, 'server/collection.mjs'), legalComments: 'eof' });
  const sourceHtml = await readFile(resolve(root, 'index.html'), 'utf8');
  const html = sourceHtml.replace(/src="\/src\/main\.tsx"/g, 'src="/assets/app.js"').replace('</head>', '  <link rel="stylesheet" href="/assets/app.css">\n</head>');
  if (html.includes('/src/') || !html.includes('/assets/app.js')) throw new Error('Unexpected frontend entry point.');
  await writeFile(resolve(stage, 'public/index.html'), html);
  await copyFile(resolve(root, 'public/docs/roadmap.docx'), resolve(stage, 'public/docs/roadmap.docx'));
  const files = ['index.html', 'assets/app.js', 'assets/app.css', 'docs/roadmap.docx'];
  const manifest = {};
  for (const file of files) manifest[`/${file}`] = createHash('sha256').update(await readFile(resolve(stage, 'public', file))).digest('hex');
  await writeFile(resolve(stage, 'public-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rm(resolve(root, 'dist'), { recursive: true, force: true });
  await rm(resolve(root, 'build'), { recursive: true, force: true });
  await rename(resolve(stage, 'public'), resolve(root, 'dist'));
  await rename(resolve(stage, 'server'), resolve(root, 'build'));
  await rename(resolve(stage, 'public-manifest.json'), resolve(root, 'build/public-manifest.json'));
  console.log('Built React frontend, Workers-compatible backend, offline seed module and 4 allowlisted public files.');
} finally { await rm(stage, { recursive: true, force: true }); }
