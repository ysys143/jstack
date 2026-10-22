/** Diagnostic fingerprints and invalidation. Hashes inputs only; stores no file contents. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Diagnostic, HookState } from './state.js';

export interface Fingerprint { digest: string; components: Record<string, string>; }
export const ABSENT = 'absent';

/** Project configuration that changes which checks apply or how they behave. */
export const DEFAULT_CONFIG_FILES = [
  'pyproject.toml', 'setup.cfg', 'setup.py', 'ruff.toml', '.ruff.toml', 'pyrightconfig.json', 'mypy.ini',
  'package.json', 'tsconfig.json', 'biome.json', 'biome.jsonc',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml',
  'go.mod', 'Cargo.toml', 'clippy.toml', '.clippy.toml', '.jstack/project.json',
] as const;
export const DEFAULT_LOCK_FILES = [
  'uv.lock', 'poetry.lock', 'Pipfile.lock', 'requirements.txt',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'go.sum', 'Cargo.lock',
] as const;

export interface FingerprintInput {
  root: string; host: string; jstackVersion: string;
  /** Absolute path of the packaged hook definition in effect, if known. */
  hookManifest?: string;
  /** Executable names whose resolved location matters to the diagnostic. */
  tools?: readonly string[];
  /** Root-relative paths; defaults apply when omitted. Include subproject manifests for monorepos. */
  configFiles?: readonly string[]; lockFiles?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fileHash(file: string): string {
  try { const info = fs.statSync(file); return info.isFile() ? sha(fs.readFileSync(file)) : ABSENT; }
  catch { return ABSENT; }
}
function relativeInside(root: string, rel: string): string | undefined {
  if (path.isAbsolute(rel)) return undefined;
  const full = path.resolve(root, rel); const back = path.relative(root, full);
  return back.startsWith('..') || path.isAbsolute(back) ? undefined : full;
}

/** Resolve an executable on PATH without running it. */
export function resolveExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return undefined;
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).concat('') : [''];
  for (const dir of dirs) for (const ext of exts) {
    const candidate = path.join(dir, name + ext);
    try {
      const info = fs.statSync(candidate);
      if (info.isFile() && (process.platform === 'win32' || info.mode & 0o111)) return candidate;
    } catch { /* keep searching */ }
  }
  return undefined;
}
/** Tool identity: resolved real path plus size and mtime. An upgrade in place changes it. */
export function toolComponent(name: string, env?: NodeJS.ProcessEnv): string {
  const found = resolveExecutable(name, env); if (!found) return ABSENT;
  try { const real = fs.realpathSync(found); const info = fs.statSync(real); return sha(`${real}\0${info.size}\0${info.mtimeMs}`); }
  catch { return ABSENT; }
}

export function digestOf(components: Record<string, string>): string {
  return sha(JSON.stringify(Object.keys(components).sort().map(key => [key, components[key]])));
}

export function computeFingerprint(input: FingerprintInput): Fingerprint {
  const components: Record<string, string> = { host: sha(input.host), jstack: sha(input.jstackVersion) };
  components['hook-manifest'] = input.hookManifest ? fileHash(input.hookManifest) : ABSENT;
  for (const [prefix, list] of [['config', input.configFiles ?? DEFAULT_CONFIG_FILES], ['lock', input.lockFiles ?? DEFAULT_LOCK_FILES]] as const) {
    for (const rel of list) {
      const full = relativeInside(input.root, rel);
      components[`${prefix}:${rel.split(path.sep).join('/')}`] = full ? fileHash(full) : ABSENT;
    }
  }
  for (const tool of [...new Set(input.tools ?? [])].sort()) components[`tool:${tool}`] = toolComponent(tool, input.env);
  return { digest: digestOf(components), components };
}

export function changedComponents(before: Fingerprint, after: Fingerprint): string[] {
  const keys = new Set([...Object.keys(before.components), ...Object.keys(after.components)]);
  return [...keys].filter(key => before.components[key] !== after.components[key]).sort();
}

export type ReuseReason = 'match' | 'no-diagnostic' | 'not-successful' | 'changed';
export interface Reuse { reuse: boolean; reason: ReuseReason; changed: string[]; }
/** Only a successful diagnostic with an identical fingerprint is reused. */
export function diagnosticReuse(state: Pick<HookState, 'diagnostic'>, current: Fingerprint): Reuse {
  const d = state.diagnostic;
  if (!d) return { reuse: false, reason: 'no-diagnostic', changed: [] };
  const changed = d.fingerprint.digest === current.digest ? [] : changedComponents(d.fingerprint, current);
  if (d.status !== 'pass') return { reuse: false, reason: 'not-successful', changed };
  if (changed.length || d.fingerprint.digest !== current.digest) return { reuse: false, reason: 'changed', changed };
  return { reuse: true, reason: 'match', changed: [] };
}

export const MAX_DIAGNOSTIC_ATTEMPTS = 2;
export type RetryTrigger = 'read-only' | 'edit' | 'edit-batch' | 'commit' | 'explicit';
/**
 * Bounded retry: diagnostics run only on relevant boundaries, never on read-only calls.
 * Failures against unchanged inputs stop after MAX_DIAGNOSTIC_ATTEMPTS until an explicit
 * command or an input change. An explicit command always may retry.
 */
export function retryAllowed(diagnostic: Diagnostic | undefined, trigger: RetryTrigger, current: Fingerprint): boolean {
  if (trigger === 'explicit') return true;
  if (trigger !== 'edit-batch' && trigger !== 'commit') return false;
  if (!diagnostic || diagnostic.status === 'pass' || diagnostic.fingerprint.digest !== current.digest) return true;
  return diagnostic.attempts < MAX_DIAGNOSTIC_ATTEMPTS;
}
