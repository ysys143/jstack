#!/usr/bin/env node
/** Three-state capability probe: 0 ready, 1 unauthenticated, 2 blocked. Never installs. */
import { isMain } from '../../../../runtime/entry.js';
import { executable, runCommand } from '../../../public/workflow/second-opinion/scripts/bridge-common.js';

/** Parse one quoted command into literal argv. Shell expansions/operators are unsupported. */
export function authArgv(command: string): string[] {
  const out: string[] = []; let current = '', quote = '', active = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && ['"', '\\'].includes(command[index + 1] ?? '')) current += command[++index];
      else current += char;
    } else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char)) { if (active) { out.push(current); current = ''; active = false; } }
    else if ('|&;<>`$\n\r'.includes(char)) throw new Error('--auth accepts one command with literal arguments; shell operators and expansion are unsupported');
    else if (char === '\\') { if (++index >= command.length) throw new Error('--auth has an incomplete escape'); current += command[index]; active = true; }
    else { current += char; active = true; }
  }
  if (quote) throw new Error('--auth has an unclosed quote');
  if (active) out.push(current);
  if (!out[0]) throw new Error('--auth command is empty');
  return out;
}
export function contextVersion(line: string, binary: string): string {
  const escaped = binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const pattern of [/.*[Vv]ersion[^0-9]{0,4}([0-9][0-9.]*).*/, new RegExp(`.*${escaped}[^0-9]{0,4}([0-9][0-9.]*).*`), /^[vV]?([0-9][0-9.]*).*/, /^[A-Za-z][A-Za-z0-9_.-]* [vV]?([0-9][0-9]*\.[0-9][0-9.]*).*/]) {
    const match = pattern.exec(line); if (match) return match[1]!.replace(/\.$/, '');
  }
  return '';
}
export function belowFloor(version: string, floor: string): boolean {
  const actual = version.split('.'), required = floor.split('.');
  for (let index = 0; index < 4; index++) { const a = Number(actual[index] ?? 0), b = Number(required[index] ?? 0); if (a < b) return true; if (a > b) return false; }
  return false;
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let binary = '', floor = '', auth = '', install = '', timeout = 10;
  try {
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]!;
      if (['--floor', '--auth', '--install', '--timeout'].includes(arg)) {
        if (argv[index + 1] === undefined || argv[index + 1]!.startsWith('--')) throw new Error(`probe: ${arg} requires a value`);
        const value = argv[++index]!;
        if (arg === '--floor') floor = value; else if (arg === '--auth') auth = value; else if (arg === '--install') install = value; else timeout = Number(value);
      } else if (arg.startsWith('-')) throw new Error(`probe: unknown flag ${arg}`);
      else if (!binary) binary = arg; else throw new Error(`probe: multiple executable arguments (${binary}, ${arg})`);
    }
    if (!binary) throw new Error('probe: target executable is missing');
    if (floor && !/^\d+(?:\.\d+){0,3}$/.test(floor)) throw new Error('probe: --floor must contain one to four numeric fields');
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483) throw new Error('probe: --timeout must be a positive number of seconds below 2147483');
    const authentication = auth ? authArgv(auth) : null;
    const blocked = (reason: string) => { console.log(`[2] ${reason}`); if (install) console.log(`    Install: ${install}`); return 2; };
    if (!executable(binary)) return blocked(`${binary} is missing`);
    let raw: string | null = null;
    for (const flag of ['--version', '-version']) { const result = await runCommand(binary, [flag], { timeout }); if (result.status === 0) { raw = result.stdout + result.stderr; break; } }
    if (raw === null) return blocked(`${binary} cannot run; a runtime dependency may be missing`);
    let version = '', line = '';
    for (const candidate of raw.split('\n')) { const value = contextVersion(candidate, binary); if (value) { version = value; line = candidate; break; } }
    if (floor) {
      if (!version) return blocked(`cannot read ${binary} version: ${line}`);
      if (belowFloor(version, floor)) return blocked(`${binary} ${version} is below required version ${floor}`);
    }
    if (authentication) {
      const result = await runCommand(authentication[0]!, authentication.slice(1), { timeout });
      if (result.status !== 0) { console.log(`[1] ${binary} is installed but unauthenticated; authenticated features are unavailable`); return 1; }
    }
    return 0;
  } catch (error) { console.error((error as Error).message); return 2; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
