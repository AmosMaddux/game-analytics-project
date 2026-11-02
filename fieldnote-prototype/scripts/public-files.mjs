import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';

// Review every addition: only these exact six files may be served.
// Never discover public assets by recursively copying a source directory.
export const PUBLIC_FILES = Object.freeze({
  'index.html': 'index.html',
  'src/app.js': 'src/app.js',
  'src/model.js': 'src/model.js',
  'src/style.css': 'src/style.css',
  'data/snapshot.json': 'public/data/snapshot.json',
  'docs/roadmap.docx': 'public/docs/roadmap.docx',
});

export function publicRequestPath(requestUrl) {
  // Decode before checking, without URL normalization hiding traversal segments.
  const pathname = decodeURIComponent(requestUrl.split(/[?#]/, 1)[0]);
  if (!pathname.startsWith('/') || /[\\\0]/.test(pathname)) return null;
  const parts = pathname.slice(1).split('/');
  if (parts.some(part => part.startsWith('.') || /^(?:config(?:uration)?|private|secrets?|credentials?)(?:[._-]|$)/i.test(part))) return null;
  return pathname === '/' ? 'index.html' : pathname.slice(1);
}

export async function readPublicFile(root, source) {
  // Refuse symlinks in any component, including allowlisted filenames pointing
  // at a private file. These manifests are constants, never user input.
  if (!Object.values(PUBLIC_FILES).includes(source)) throw new Error('Not public');
  let file = path.resolve(root);
  const parts = source.split('/');
  for (const [index, part] of parts.entries()) {
    file = path.join(file, part);
    const info = await lstat(file);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('Not a regular public file');
  }
  return readFile(file);
}
