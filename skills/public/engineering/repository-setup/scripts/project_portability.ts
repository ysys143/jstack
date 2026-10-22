#!/usr/bin/env node
/** Audit and apply lossless project instruction/skill portability migrations. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain } from '../../../../../runtime/entry.js';

type Finding = { path: string; status: string; detail?: string };
const DIALECT = [
  /(?:^|\n)allowed-tools\s*:/i,
  /\b(?:Task|AskUserQuestion|TodoWrite|WebFetch|WebSearch)\s*\(/,
  /\bsubagent_type\b/i,
  /\$\{?CLAUDE_PLUGIN_ROOT\}?/,
];
const exists = (file: string) => { try { return fs.lstatSync(file); } catch { return undefined; } };
const posix = (file: string) => file.split(path.sep).join('/');

function git(root: string, args: string[]) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Git inspection failed');
  return result.stdout;
}
function dirty(root: string, relative: string): boolean {
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', relative]).length > 0;
}
function textFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`skill contains symlink: ${posix(path.relative(root, file))}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:md|json|ya?ml)$/i.test(entry.name)) found.push(file);
    }
  };
  visit(root); return found;
}
function dialect(root: string): string[] {
  const hits: string[] = [];
  for (const file of textFiles(root)) {
    const body = fs.readFileSync(file, 'utf8');
    if (DIALECT.some(pattern => pattern.test(body))) hits.push(posix(path.relative(root, file)));
  }
  return hits;
}

export function inspect(rootArgument: string) {
  const root = fs.realpathSync.native(path.resolve(rootArgument));
  if (path.relative(root, fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel']).trim())) !== '') throw new Error('--root must be the Git top level');
  const claude = path.join(root, 'CLAUDE.md'), agents = path.join(root, 'AGENTS.md');
  const findings: Finding[] = [], eligible: { instructions: false | 'promote-claude' | 'create-claude-import'; skills: string[] } = { instructions: false, skills: [] };
  const c = exists(claude), a = exists(agents);
  if (c?.isSymbolicLink() || a?.isSymbolicLink()) findings.push({ path: '.', status: 'blocked', detail: 'root instruction symlink requires manual review' });
  else if (c?.isFile() && !a) {
    if (dirty(root, 'CLAUDE.md')) findings.push({ path: 'CLAUDE.md', status: 'blocked', detail: 'instruction has uncommitted changes' });
    else eligible.instructions = 'promote-claude';
  } else if (c?.isFile() && a?.isFile()) {
    const body = fs.readFileSync(claude, 'utf8').replace(/\r\n/g, '\n');
    findings.push(body === '@AGENTS.md\n' ? { path: 'CLAUDE.md', status: 'healthy' } : { path: '.', status: 'blocked', detail: 'CLAUDE.md and AGENTS.md both contain guidance' });
  } else if (a?.isFile()) eligible.instructions = 'create-claude-import';

  const claudeSkills = path.join(root, '.claude', 'skills'), agentSkills = path.join(root, '.agents', 'skills');
  if (exists(claudeSkills)?.isDirectory()) for (const name of fs.readdirSync(claudeSkills).sort()) {
    const source = path.join(claudeSkills, name), target = path.join(agentSkills, name), info = exists(source);
    if (info?.isSymbolicLink()) {
      const expected = path.relative(path.dirname(source), target);
      findings.push(fs.existsSync(source) && fs.realpathSync(source) === fs.realpathSync(target) && fs.readlinkSync(source) === expected
        ? { path: `.claude/skills/${name}`, status: 'healthy' }
        : { path: `.claude/skills/${name}`, status: 'blocked', detail: 'broken or noncanonical skill link' });
      continue;
    }
    if (!info?.isDirectory() || !exists(path.join(source, 'SKILL.md'))?.isFile()) {
      findings.push({ path: `.claude/skills/${name}`, status: 'blocked', detail: 'nonstandard skill entry' }); continue;
    }
    if (exists(target)) { findings.push({ path: `.claude/skills/${name}`, status: 'blocked', detail: 'canonical destination is occupied' }); continue; }
    if (dirty(root, `.claude/skills/${name}`)) { findings.push({ path: `.claude/skills/${name}`, status: 'blocked', detail: 'skill has uncommitted changes' }); continue; }
    const hits = dialect(source);
    if (hits.length) { findings.push({ path: `.claude/skills/${name}`, status: 'blocked', detail: `Claude tool dialect: ${hits.join(', ')}` }); continue; }
    eligible.skills.push(name);
  }
  const nativeAgents = exists(path.join(root, '.claude', 'agents'))?.isDirectory()
    ? fs.readdirSync(path.join(root, '.claude', 'agents')).length : 0;
  return { root, eligible, findings, nativeClaudeAgents: nativeAgents, limitations: ['static dialect scan; host discovery not proven'] };
}

export function apply(rootArgument: string) {
  const report = inspect(rootArgument), root = report.root;
  const blocked = report.findings.filter(row => row.status === 'blocked');
  if (blocked.length) throw new Error(`manual review required: ${blocked.map(row => `${row.path}: ${row.detail}`).join('; ')}`);
  const undo: (() => void)[] = [];
  try {
    if (report.eligible.instructions === 'promote-claude') {
      const claude = path.join(root, 'CLAUDE.md'), agents = path.join(root, 'AGENTS.md');
      fs.renameSync(claude, agents); undo.push(() => fs.renameSync(agents, claude));
      fs.writeFileSync(claude, '@AGENTS.md\n', { flag: 'wx' }); undo.push(() => fs.unlinkSync(claude));
    } else if (report.eligible.instructions === 'create-claude-import') {
      const claude = path.join(root, 'CLAUDE.md');
      fs.writeFileSync(claude, '@AGENTS.md\n', { flag: 'wx' }); undo.push(() => fs.unlinkSync(claude));
    }
    for (const name of report.eligible.skills) {
      const source = path.join(root, '.claude', 'skills', name), target = path.join(root, '.agents', 'skills', name);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(source, target); undo.push(() => fs.renameSync(target, source));
      fs.symlinkSync(path.relative(path.dirname(source), target), source, 'dir'); undo.push(() => fs.unlinkSync(source));
    }
  } catch (error) { for (const action of undo.reverse()) try { action(); } catch {} throw error; }
  return { ...inspect(root), applied: { instructions: report.eligible.instructions, skills: report.eligible.skills } };
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const action = argv[0], at = argv.indexOf('--root');
    if (!['audit', 'apply'].includes(action ?? '') || at < 0 || !argv[at + 1] || argv.length !== 3) throw new Error('usage: project_portability audit|apply --root DIR');
    process.stdout.write(JSON.stringify(action === 'apply' ? apply(argv[at + 1]!) : inspect(argv[at + 1]!), null, 2) + '\n'); return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
