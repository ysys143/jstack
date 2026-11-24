import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copies a directory of regular files and directories, one entry at a time.
 * Fixtures use it instead of `fs.cpSync` for a Git template: on Node 22 and later `cpSync` sometimes throws
 * ENOENT for a directory it has just created under `.git/objects` (about one in 1800 copies in a parallel
 * run), which made the SDLC runtime tests fail only on some Node versions. A template holds no links.
 */
export function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error(`copyTree copies only files and directories: ${from}`);
  }
}
