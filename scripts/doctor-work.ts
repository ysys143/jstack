import { sourcePath } from '../runtime/skill_catalog.js';
import { isMain } from '../runtime/entry.js';
/** Feature inventory only: never downloads tools, installs dependencies, or prints credentials. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { available, run, type Runner } from './doctor-dev.js';
export const skills = ['deck', 'diagram', 'humanize', 'hwpx', 'image', 'office', 'proof', 'research', 'science', 'workspace'] as const;
export type SkillStatus = 'ready' | 'partial' | 'blocked' | 'self-contained';
export interface Diagnosis { skill: string; status: SkillStatus; detail: string }
export interface Environment { root: string; home: string; platform: string; env: NodeJS.ProcessEnv; runner: Runner }
export function sourceRoot(): string { const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); return path.basename(base) === 'dist' ? path.dirname(base) : base; }
export function diagnose(skill: string, e: Environment): Diagnosis {
  const result = (status: SkillStatus, detail: string): Diagnosis => ({skill, status, detail});
  const has = (cmd: string) => available(cmd, e.runner);
  const py = e.env.PYTHON || 'python3';
  const imports = (text: string) => e.runner(py, ['-c', text]).status === 0;
  if (!skills.includes(skill as typeof skills[number])) return result('blocked', 'unknown skill');
  if (!fs.existsSync(sourcePath(e.root, `skills/${skill}/SKILL.md`))) return result('blocked', 'skill installation missing');
  if (['diagram', 'humanize', 'proof', 'science'].includes(skill)) return result('self-contained', 'base guidance has no prerequisites; optional specialist tools are diagnosed when selected');
  if (skill === 'deck') {
    if (!has('marp') && e.runner('npx', ['--offline', '--no-install', '@marp-team/marp-cli', '--version']).status !== 0) return result('blocked', 'marp missing; install @marp-team/marp-cli explicitly');
    const browsers = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'firefox'];
    const locations = ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app', '/Applications/Chromium.app', '/Applications/Firefox.app'];
    for (const base of [e.env.PROGRAMFILES, e.env['PROGRAMFILES(X86)'], e.env.LOCALAPPDATA].filter(Boolean)) locations.push(path.join(base!, 'Google/Chrome/Application/chrome.exe'), path.join(base!, 'Microsoft/Edge/Application/msedge.exe'));
    const browser = (e.env.CHROME_PATH && fs.existsSync(e.env.CHROME_PATH)) || locations.some(file => fs.existsSync(file)) || browsers.some(has);
    return result(browser ? 'ready' : 'partial', browser ? 'marp and browser available' : 'HTML only; browser required for PDF/PPTX/images');
  }
  if (skill === 'hwpx') {
    if (!has(py) || !imports('import lxml')) return result('blocked', 'Python + lxml required; run jst optional setup hwpx');
    return e.platform === 'win32' && imports('import win32com') ? result('ready', 'lxml and pywin32 available; Hancom COM execution still requires validation') : result('partial', '.hwpx available; .hwp input requires Windows, Hancom Office and pywin32');
  }
  if (skill === 'image') {
    const codex = has('codex'); let key = Boolean(e.env.GEMINI_API_KEY);
    const keyFile = path.join(e.home, '.claude', '.env.nanobanana');
    if (!key && fs.existsSync(keyFile)) key = /^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*[^\s#]+/m.test(fs.readFileSync(keyFile, 'utf8'));
    const nano = key && fs.existsSync(path.join(e.root, 'skills/image/scripts/nanobanana.py')) && has(py) && imports('import requests; from PIL import Image; import dotenv');
    return result(codex && nano ? 'ready' : codex || nano ? 'partial' : 'blocked', `codex: ${codex ? 'available' : 'missing'}; nanobanana: ${nano ? 'configured' : 'requires script, Python dependencies and GEMINI_API_KEY'}; credentials are not authenticated by this check`);
  }
  if (skill === 'office') return has('officecli') ? result('ready', 'OfficeCLI executable available') : result('blocked', 'OfficeCLI missing; install @officecli/officecli explicitly (diagnosis never invokes npx downloads)');
  if (skill === 'research') {
    const checks = ['cite_check', 'coverage_matrix'];
    const compiled = checks.every(name => ['skills/research/scripts', 'dist/skills/research/scripts'].some(directory => fs.existsSync(path.join(e.root, directory, `${name}.js`))));
    if (!compiled) return result('blocked', 'research checker runtime or files missing');
    return has('hyperresearch') ? result('ready', 'checkers and hyperresearch available') : result('self-contained', 'self-contained path is the default and expected; hyperresearch is optional');
  }
  if (!has('gws')) return result('blocked', 'Google Workspace CLI missing; install googleworkspace-cli, not the same-name git workspace tool');
  if (!/auth/i.test(e.runner('gws', ['--help']).stdout)) return result('blocked', 'wrong gws: no auth subcommand');
  const config = path.join(e.home, '.config');
  const configured = fs.existsSync(config) && fs.readdirSync(config, {withFileTypes: true}).some(dir => dir.isDirectory() && dir.name.startsWith('gws-') && fs.readdirSync(path.join(config, dir.name)).some(name => /client_secret|token|credential/i.test(name)));
  return result(configured ? 'ready' : 'partial', configured ? 'account settings present; select GOOGLE_WORKSPACE_CLI_CONFIG_DIR explicitly; authentication not verified' : 'authentication required: /setup');
}
export function doctorWork(only?: string, options: Partial<Environment> = {}) {
  const environment: Environment = {root: sourceRoot(), home: os.homedir(), platform: process.platform, env: process.env, runner: run, ...options};
  const diagnoses = (only ? [only] : skills).map(skill => diagnose(skill, environment));
  const count = (status: SkillStatus) => diagnoses.filter(d => d.status === status).length;
  return {code: count('blocked') ? 1 : 0, diagnoses, lines: ['== work-layer diagnosis ==', '', ...diagnoses.map(d => `  [${d.status}] ${d.skill.padEnd(10)} ${d.detail}`), '', `  ready ${count('ready')} · self-contained ${count('self-contained')} · partial ${count('partial')} · blocked ${count('blocked')}`]};
}
if (isMain(import.meta.url)) { const result = doctorWork(process.argv[2]); console.log(result.lines.join('\n')); process.exitCode = process.argv.length > 3 ? 2 : result.code; }
