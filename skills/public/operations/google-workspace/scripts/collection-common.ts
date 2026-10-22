/** Local, bounded repository collection; never follows filesystem aliases. */
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWrite, privateDir } from '../../../../../runtime/os.js';

export const githubDirectory = () => resolve(process.env.GITHUB_DIR ?? join(homedir(), 'Documents/GitHub'));
export const directory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
export function localDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function dateValue(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || localDate(date) !== value) throw new Error('Invalid calendar date');
  return date;
}
export function shiftDate(value: string, days: number): string { const date = dateValue(value); date.setDate(date.getDate() + days); return localDate(date); }
export function children(path: string): string[] { return readdirSync(path).sort().filter(name => { const info = lstatSync(join(path, name)); return info.isDirectory() && !info.isSymbolicLink(); }).map(name => join(path, name)); }
export function* files(path: string, excluded = new Set(['.git', 'node_modules', '__pycache__'])): Generator<string> {
  for (const name of readdirSync(path).sort()) {
    if (excluded.has(name)) continue;
    const file = join(path, name), info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) yield* files(file, excluded); else if (info.isFile()) yield file;
  }
}
export function output(text: string, file?: string): void {
  if (!file || file === '-' || file === '/dev/stdout') { process.stdout.write(text); return; }
  const target = resolve(file); privateDir(dirname(target)); atomicWrite(target, Buffer.from(text));
}
export function scopeList(text: string, root: string, label: string): string[] {
  if (!text) return [];
  if (text.includes('\n')) return text.split('\n').filter(Boolean);
  if (directory(join(root, text))) return [text];
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.some(part => !directory(join(root, part)))) for (let index = 1; index < parts.length; index++) {
    const combined = parts.slice(0, index + 1).join(' ');
    if (directory(join(root, combined))) throw new Error(`[STOP] ${label} has ambiguous spacing; path "${combined}" exists. Separate multiple entries with newlines.`);
  }
  return parts;
}
export function makeScope(root: string, repos = process.env.SCRUM_REPOS ?? '', excludes = process.env.SCRUM_EXCLUDE ?? ''): (path: string) => boolean {
  const base = realpathSync(root), allow = scopeList(repos, root, 'SCRUM_REPOS'), deny = scopeList(excludes, root, 'SCRUM_EXCLUDE');
  return path => {
    const canonical = realpathSync(path), rel = relative(base, canonical).split(sep).join('/');
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return false;
    const name = basename(canonical), guard = `/${rel}/`;
    const matches = (pattern: string) => rel === pattern || name === pattern || guard.includes(`/${pattern}/`);
    return !deny.some(matches) && (!allow.length || allow.some(matches));
  };
}
export function readmeIntro(path: string): string {
  try { const text = readFileSync(join(path, 'README.md'), 'utf8'); return text.split('\n').slice(0, text.endsWith('\n') ? Math.min(3, text.split('\n').length - 1) : 3).map(line => `> ${line}\n`).join('') + '\n'; }
  catch { return ''; }
}
