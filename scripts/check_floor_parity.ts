#!/usr/bin/env node
import { isMain } from '../runtime/entry.js';
/** Reject missing or contaminated measurements; a passing suite alone is insufficient. */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface Floor { what: string; declared: number; measured: number }
export interface Measurement { green: boolean; verdict: string; floors: Floor[]; failed?: number; missing?: boolean }
export function parseMeasurement(stdout: string): Measurement {
  if (/^@@jstack-suite-(?:begin|end)/m.test(stdout)) {
    const blocks: Measurement[] = []; let current: string[] | undefined;
    const invalid = (reason: string): Measurement => ({ green: false, verdict: `invalid suite framing: ${reason}`, floors: [] });
    for (const line of stdout.split(/\r?\n/)) {
      if (line === '@@jstack-suite-begin') { if (current) return invalid('nested frame'); current = []; }
      else if (line.startsWith('@@jstack-suite-end')) {
        const match = /^@@jstack-suite-end (-?\d+)$/.exec(line);
        if (!current || !match) return invalid('unmatched or malformed end');
        const result = parseMeasurement(current.join('\n'));
        if (Number(match[1]) !== 0) { result.green = false; result.verdict += `; process exit ${match[1]}`; }
        blocks.push(result); current = undefined;
      } else if (current) current.push(line);
      else if (line.trim()) return invalid('output outside frame');
    }
    if (current || !blocks.length) return invalid('incomplete frame');
    const bad = blocks.find(block => !block.green);
    return { green: !bad, verdict: bad?.verdict ?? `${blocks.length} clean suite processes`, floors: blocks.flatMap(block => block.floors), failed: bad?.failed, missing: bad?.missing };
  }
  const plain = stdout.replace(/^(?:# |\u2139 )/gm, ''), verdicts = [...plain.matchAll(/^(\d+)\/(\d+) (?:통과|passed)\s*$/gm)];
  let green = false, verdict = 'missing verdict', failed: number | undefined, missing = true;
  if (verdicts.length) {
    const last = verdicts.at(-1)!; failed = Number(last[2]) - Number(last[1]); green = failed === 0 && Number(last[2]) > 0; verdict = `${last[1]}/${last[2]}`; missing = false;
  } else if (/^FAILED\s*\(/m.test(plain)) { verdict = [...plain.matchAll(/^FAILED\s*\((.*)\)\s*$/gm)].at(-1)?.[0].trim() ?? 'FAILED'; missing = false; }
  else if (/^OK(?:\s*\(.*\))?\s*$/m.test(plain) && /Ran [1-9]\d* tests?/.test(plain)) { green = true; verdict = 'OK'; failed = 0; missing = false; }
  else {
    const total = [...plain.matchAll(/^tests (\d+)$/gm)].at(-1), pass = [...plain.matchAll(/^pass (\d+)$/gm)].at(-1), fail = [...plain.matchAll(/^fail (\d+)$/gm)].at(-1);
    const cancelled = Number([...plain.matchAll(/^cancelled (\d+)$/gm)].at(-1)?.[1] ?? 0), skipped = Number([...plain.matchAll(/^skipped (\d+)$/gm)].at(-1)?.[1] ?? 0);
    if (total && pass && fail) { green = Number(total[1]) > 0 && Number(pass[1]) > 0 && Number(fail[1]) === 0 && cancelled === 0 && Number(pass[1]) + skipped === Number(total[1]); failed = Number(fail[1]) + cancelled; verdict = `Node tests ${pass[1]}/${total[1]}`; missing = false; }
  }
  const floors: Floor[] = [];
  for (const line of plain.split(/\r?\n/)) {
    const match = line.match(/^\[(?:PASS|FAIL)\] (?:계약 커버리지: (\S+)|자기검사: SKILL\.md 본문 삭제 시 계약 검사가 실패한다|스크립트 계약: (\S+)) — (\d+)건 실패 \(하한 (\d+)\)/);
    if (match) floors.push({ what: match[1] ?? match[2] ?? 'SKILL.md deletion regression', declared: Number(match[4]), measured: Number(match[3]) });
  }
  return { green, verdict, floors, failed, missing };
}
export function compareMeasurements(outputs: Record<string, string>, expected: Record<string, number>) {
  const errors: string[] = []; let checked = 0;
  if (!Object.keys(outputs).length) errors.push('No suite measurements');
  for (const [label, stdout] of Object.entries(outputs)) {
    const measurement = parseMeasurement(stdout);
    if (!measurement.green) { errors.push(measurement.missing ? `${label}: 총평 부재 또는 미판정 (${measurement.verdict}); 하한을 올리지 마라` : `${label}: 오염된 실측 — 총평 ${measurement.verdict}${measurement.failed === undefined ? '' : `, 무조건 실패 ${measurement.failed}건`}; 하한을 올리지 마라`); continue; }
    if (!(label in expected)) errors.push(`${label}: unregistered floor population`);
    else if (measurement.floors.length !== expected[label]) errors.push(`${label}: expected ${expected[label]} measured floor records, got ${measurement.floors.length}`);
    for (const floor of measurement.floors) {
      checked++;
      if (floor.declared !== floor.measured) errors.push(`${label}: ${floor.what}: declared ${floor.declared}, measured ${floor.measured}`);
    }
  }
  return { passed: errors.length === 0, checked, errors };
}
export function suiteFiles(root: string): { label: string; path: string }[] {
  const rows: { label: string; path: string }[] = [], skills = join(root, 'skills');
  if (existsSync(skills)) for (const name of readdirSync(skills).sort()) {
    const directory = join(skills, name, 'tests'); if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
    for (const file of readdirSync(directory).sort()) if (!file.startsWith('_') && file.endsWith('.js') && !file.endsWith('.test.js')) rows.push({ label: `skills/${name}`, path: join(directory, file) });
  }
  const tests = join(root, 'tests');
  if (existsSync(tests)) for (const file of readdirSync(tests).sort()) if (/^test_.*\.js$/.test(file)) rows.push({ label: `tests/${file.replace(/\.js$/, '.py')}`, path: join(tests, file) });
  return rows;
}
export function canonicalLabel(value: string, root: string): string {
  if (value.startsWith('skills/') || value.startsWith('tests/')) return value.replace(/\.(?:js|ts)$/, '.py');
  const actual = resolve(value);
  if (existsSync(actual)) {
    const rel = relative(realpathSync(root), realpathSync(actual)).split(sep).join('/');
    if (rel.startsWith('skills/')) {
      const catalogPath = join(root, 'contracts/skill-catalog.json');
      if (existsSync(catalogPath)) {
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
        for (const row of catalog.entries ?? []) {
          const source = row.visibility === 'public'
            ? `skills/public/${row.category}/${row.name}`
            : `skills/support/${row.name}`;
          if (rel === source) return `skills/${row.owner}`;
        }
      }
      return rel.replace(/\.(?:js|ts)$/, '.py');
    }
    if (rel.startsWith('tests/')) return rel.replace(/\.(?:js|ts)$/, '.py');
  }
  return `skills/${value}`;
}
export function main(argv = process.argv.slice(2)): number {
  try {
    let root = process.env.JSTACK_RUNTIME_ROOT ?? process.cwd(), from: string | undefined;
    const selected: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) root = argv[++i];
      else if (argv[i] === '--from-dir' && argv[i + 1]) from = argv[++i];
      else selected.push(argv[i]);
    }
    root = resolve(root);
    const expected = JSON.parse(readFileSync(join(root, 'contracts/ts-migration/deletion-floors.json'), 'utf8')).floors as Record<string, number>;
    const available = suiteFiles(root), wanted = selected.length ? selected.map(value => canonicalLabel(value, root)) : [...new Set([...Object.keys(expected), ...available.map(row => row.label)])];
    const outputs: Record<string, string> = {}, errors: string[] = [];
    for (const label of wanted) {
      const suites = available.filter(row => row.label === label);
      if (!suites.length && !from) { errors.push(`${label}: compiled owning suite is missing`); continue; }
      if (from) {
        const name = label.startsWith('skills/') ? `${basename(label)}.out` : `tests_${basename(label)}.out`, file = join(from, name);
        if (!existsSync(file)) { errors.push(`${label}: measured output missing`); continue; }
        outputs[label] = readFileSync(file, 'utf8');
      } else {
        outputs[label] = '';
        for (const suite of suites) {
          const result = spawnSync(process.execPath, [suite.path], { cwd: dirname(dirname(suite.path)), encoding: 'utf8', timeout: 2_700_000 });
          outputs[label] += result.stdout + result.stderr;
          if (result.status !== 0) errors.push(`${label}: suite execution failed (${result.status ?? result.error?.message})`);
        }
      }
    }
    const result = compareMeasurements(outputs, expected); result.errors.push(...errors); result.passed = result.errors.length === 0;
    console.log(JSON.stringify(result, null, 2)); return result.passed ? 0 : 1;
  } catch (error) { console.error(String(error)); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
