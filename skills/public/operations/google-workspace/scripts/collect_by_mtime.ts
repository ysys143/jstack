#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';
import { children, dateValue, directory, files, githubDirectory, output, readmeIntro } from './collection-common.js';
export function collect(since: string, root = githubDirectory()): string {
  const boundary = dateValue(since).getTime();
  if (!directory(root)) throw new Error(`Collection directory does not exist: ${root}`);
  let result = `# Project collection by file modification time\n> Since: ${since}\n\n`;
  const projects = children(root).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 50);
  for (const project of projects) {
    if (existsSync(join(project, '.git'))) continue;
    const recent: string[] = [];
    for (const file of files(project)) if (statSync(file).mtimeMs > boundary) { recent.push(relative(project, file).split(sep).join('/')); if (recent.length === 5) break; }
    if (!recent.length) continue;
    result += `## ${basename(project)}\n\n${readmeIntro(project)}**Recently modified files:**\n${recent.map(file => `- ${file}\n`).join('')}\n`;
  }
  return result;
}
export function main(argv = process.argv.slice(2)): number {
  try { if (argv.length < 1 || argv.length > 2) throw new Error('Usage: collect_by_mtime YYYY-MM-DD [OUTPUT]'); output(collect(argv[0]!), argv[1]); return 0; }
  catch (error) { console.error((error as Error).message); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
