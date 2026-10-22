/** Explicit Claude profile discovery; retain ancillary files and reject encoded-name collisions. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MigrationError, read, records } from './common.js';
import type { Discovered } from './types.js';
export const encoded = (path: string): string => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? path.replace(/[\\/:]/g, '-') : path.replace(/[\/_]/g, '-');
export function* files(directory: string): Generator<string> {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), info = lstatSync(path);
    if (info.isSymbolicLink()) throw new MigrationError(`Project symlink requires explicit resolution: ${path}`);
    if (info.isDirectory()) yield* files(path); else if (info.isFile()) yield path;
  }
}
export function discover(profiles: string[], old: string, next: string): Discovered[] {
  const keys = new Set([old, next].map(value => encoded(value).replace(/_/g, '-'))), result: Discovered[] = [];
  for (const profile of profiles) {
    const projects = join(profile, 'projects');
    if (!existsSync(projects) || !lstatSync(projects).isDirectory()) throw new MigrationError(`Claude projects directory missing: ${projects}`);
    if (lstatSync(projects).isSymbolicLink()) throw new MigrationError('Project symlink requires explicit resolution');
    for (const name of readdirSync(projects).sort()) {
      const folder = join(projects, name);
      if (!keys.has(name.replace(/_/g, '-'))) continue;
      if (lstatSync(folder).isSymbolicLink()) throw new MigrationError('Project symlink requires explicit resolution');
      if (!lstatSync(folder).isDirectory()) continue;
      for (const transcript of readdirSync(folder).filter(file => file.endsWith('.jsonl')).sort()) {
        const data = read(join(folder, transcript)); if (data === null) continue;
        const first = records(data).find(row => row.cwd)?.cwd;
        if (first && first !== old && first !== next) throw new MigrationError('Ambiguous Claude project directory: transcript belongs to another project');
      }
      for (const file of files(folder)) result.push({ source: file, relative: join('projects', encoded(next), relative(folder, file)), identity: null });
    }
  }
  return result;
}
