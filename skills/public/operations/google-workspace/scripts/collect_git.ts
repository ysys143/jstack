#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';
import { runCommand } from '../../../workflow/second-opinion/scripts/bridge-common.js';
import { children, dateValue, directory, githubDirectory, localDate, output } from './collection-common.js';
export async function collect(since: string, until: string, root = githubDirectory(), author = process.env.GIT_COLLECT_AUTHOR ?? ''): Promise<{ text: string; found: number; failures: string[] }> {
  if (dateValue(since) > dateValue(until)) throw new Error('SINCE must not follow UNTIL');
  if (!directory(root)) throw new Error(`Collection directory does not exist: ${root}\nSet the GITHUB_DIR environment variable`);
  let text = `# Git Log collection\n> Period: ${since} ~ ${until}\n${author ? `> Author filter: ${author}\n` : ''}\n`, found = 0;
  const failures: string[] = [];
  for (const repo of children(root)) {
    if (!existsSync(join(repo, '.git'))) continue;
    const result = await runCommand('git', ['-C', repo, 'log', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, ...(author ? [`--author=${author}`] : []), '--pretty=format:- %ad %s', '--date=short'], { timeout: 30 });
    if (result.status !== 0) { failures.push(basename(repo)); continue; }
    const log = result.stdout.replace(/\n+$/g, ''); if (!log) continue;
    found++; text += `## ${basename(repo)}\n\n${log}\n\n`;
  }
  return { text, found, failures };
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length < 1 || argv.length > 3) throw new Error('Usage: collect_git YYYY-MM-DD [UNTIL] [OUTPUT]');
    const result = await collect(argv[0]!, argv[1] ?? localDate()); output(result.text, argv[2]); console.error(`${result.found} projects with commits`);
    if (result.failures.length) { console.error(`Incomplete Git collection: ${result.failures.join(', ')}`); return 1; } return 0;
  } catch (error) { console.error((error as Error).message); return 2; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
