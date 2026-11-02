import { lstat, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

export async function assertRegularInput(root, filename) {
  const full = resolve(root, filename);
  if (relative(root, full).startsWith('..')) throw new Error('Build input escapes the application root.');
  let path = root;
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Build input root must not be a symlink.');
  for (const part of filename.split(sep)) {
    path = resolve(path, part);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Build input symlink is forbidden: ${filename}`);
  }
  if (!(await lstat(full)).isFile()) throw new Error(`Build input must be a regular file: ${filename}`);
  return full;
}
export async function assertSourceTree(root, directory) {
  const info = await lstat(resolve(root, directory));
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Build source must be a real directory: ${directory}`);
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await assertSourceTree(root, filename);
    else await assertRegularInput(root, filename);
  }
}
