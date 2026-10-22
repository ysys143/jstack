#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../../runtime/entry.js';
import { check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total,
  split_frontmatter, check_skill_body, check_ref_contracts, check_body_paths, read_ref,
  type Result } from '../../../../_suite_lib.js';
const __file__ = fileURLToPath(import.meta.url);
const HERE = dirname(__file__), ROOT = dirname(HERE), SKILLS = dirname(ROOT);
const results: Result[] = [];
function check(name: string, ok: any, detail = ''): void {
  results.push([name, truth(ok), detail]);
  console.log(`[${truth(ok) ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function truth(value: any): boolean { return value instanceof Set ? value.size > 0 : Array.isArray(value) || typeof value === 'string' ? value.length > 0 : value !== null && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value); }
function iterable(value: any): any { return value != null && typeof value[Symbol.iterator] === 'function' ? value : Object.keys(value); }
function length(value: any): number { return value instanceof Set ? value.size : typeof value === 'string' ? Array.from(value).length : Array.isArray(value) ? value.length : Object.keys(value).length; }
function equal(a: any, b: any): boolean { return isDeepStrictEqual(a, b); }
function contains(haystack: any, needle: any): boolean { return typeof haystack === 'string' ? haystack.includes(needle) : [...iterable(haystack)].some((value: any) => equal(value, needle)); }
function starts(text: string, prefixes: string | string[]): boolean { return typeof prefixes === 'string' ? text.startsWith(prefixes) : prefixes.some(prefix => text.startsWith(prefix)); }
function sorted(value: any): any[] { return [...iterable(value)].sort((a: any, b: any) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0); }
function subtract(a: any, b: any): any { return a instanceof Set ? new Set([...a].filter(value => !contains(b, value))) : a - b; }
function union(a: any, b: any): Set<any> { return new Set([...iterable(a), ...iterable(b)]); }
function count(value: any, part: any): number { return typeof value === 'string' ? value.split(part).length - 1 : value.filter((entry: any) => equal(entry, part)).length; }
function range(start: number, stop?: number): number[] { if (stop === undefined) { stop = start; start = 0; } return Array.from({ length: stop - start }, (_, i) => i + start); }
function split(text: string, separator?: string | null, max?: number): string[] {
  if (separator == null) { const match = text.trim().match(/^(\S+)\s+([\s\S]*)$/); return max === 1 && match ? [match[1], match[2]] : text.trim().split(/\s+/); }
  if (max === undefined) return text.split(separator);
  const parts: string[] = []; let rest = text;
  while (parts.length < max) { const index = rest.indexOf(separator); if (index < 0) break; parts.push(rest.slice(0, index)); rest = rest.slice(index + separator.length); }
  return [...parts, rest];
}
function regex(pattern: string, flags = ''): RegExp {
  const inline = pattern.match(/^\(\?([ims]+)\)/); if (inline) { flags += inline[1]; pattern = pattern.slice(inline[0].length); }
  return new RegExp(pattern, [...new Set(flags)].join(''));
}
function regexSearch(pattern: string, text: string, flags = ''): RegExpExecArray | null { return regex(pattern, flags).exec(text); }
function regexMatch(pattern: string, text: string): RegExpExecArray | null { const match = regexSearch(pattern, text); return match?.index === 0 ? match : null; }
function regexFullmatch(pattern: string, text: string): RegExpExecArray | null { return regexSearch(`^(?:${pattern})$`, text); }
function regexFindall(pattern: string, text: string, flags = ''): any[] { return [...text.matchAll(regex(pattern, flags + 'g'))].map(match => match.length === 1 ? match[0] : match.length === 2 ? match[1] : match.slice(1)); }
function regexSub(pattern: string, replacement: string, text: string, flags = ''): string { return text.replace(regex(pattern, flags + 'g'), replacement); }
function isFile(path: string): boolean { try { return statSync(path).isFile(); } catch { return false; } }
function isDir(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function relativeTo(path: string, root: string): string { return relative(root, path); }
function* walk(root: string): Generator<[string, string[], string[]]> {
  if (!isDir(root)) return;
  const entries = readdirSync(root, { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  yield [root, dirs, entries.filter(entry => !entry.isDirectory()).map(entry => entry.name)];
  for (const dir of dirs) yield* walk(join(root, dir));
}
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
function stripChars(text:string,chars:string):string{let a=0,b=text.length;while(a<b&&chars.includes(text[a]))a++;while(b>a&&chars.includes(text[b-1]))b--;return text.slice(a,b);}
const DOC = join(ROOT, "references", "cjk-contract.md");
const EXPECTED_ITEMS = 21;
const JUDGE_TOKENS = ["scripts/", "tests/", "references/", "Human", "skill"];

function rows(text: any): any {
  let c: any, cells: any, guarded: any, line: any, out: any;
  out = [];
  for (line of iterable(text.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) {
    if (truth((!truth(starts(line, "|"))))) {
      continue;
    }
    guarded = line.trim().replaceAll("\\|", "\u0000");
    cells = (() => { const __items: any[] = []; for (const c of iterable(split(stripChars(guarded, "|"), "|"))) { __items.push(c.trim().replaceAll("\u0000", "|")); } return __items; })();
    if (truth((truth((length(cells) < 5)) || truth((!truth(regexFullmatch("\\d+", cells[0]))))))) {
      continue;
    }
    out.push(cells);
  }
  return out;
}

function main(): any {
  let _: any, bad_judge: any, c: any, exists: any, f: any, human: any, machine: any, missing: any, n: any, named: any, no_media: any, nums: any, ok: any, passed: any, read_rows: any, t: any, table: any, text: any, thin: any;
  exists = isFile(DOC);
  check("CJK contract: references/cjk-contract.md exists", exists, (truth(exists) ? "" : ("file missing — " + String(DOC))));
  if (truth((!truth(exists)))) {
    console.log(("\n" + String((() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0)) + "/" + String(length(results)) + " passed"));
    return 1;
  }
  text = readFileSync(DOC, "utf8");
  table = rows(text);
  read_rows = truth(table);
  check("CJK contract: numbered requirement rows were parsed", read_rows, ((String(length(table)) + " rows") + (truth(read_rows) ? "" : " — update this parser if the table format changed")));
  if (truth((!truth(read_rows)))) {
    console.log(("\n" + String((() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0)) + "/" + String(length(results)) + " passed"));
    return 1;
  }
  check(("CJK contract: contains " + String(EXPECTED_ITEMS) + " requirements"), (equal(length(table), EXPECTED_ITEMS)), (String(length(table)) + " requirements"));
  nums = (() => { const __items: any[] = []; for (const c of iterable(table)) { __items.push(Number(c[0])); } return __items; })();
  check("CJK contract: numbering is contiguous from 1 through N", (equal(nums, Array.from(range(1, (length(table) + 1))))), (String(nums)));
  thin = (() => { const __items: any[] = []; for (const c of iterable(table)) { if (!truth((length(c[2]) < 20))) continue; __items.push(c[0]); } return __items; })();
  check("CJK contract: every requirement sentence is nonempty", (!truth(thin)), ("short rows " + String(thin)));
  no_media = (() => { const __items: any[] = []; for (const c of iterable(table)) { if (!truth((!truth(c[1])))) continue; __items.push(c[0]); } return __items; })();
  check("CJK contract: every requirement names a medium", (!truth(no_media)), ("empty rows " + String(no_media)));
  bad_judge = (() => { const __items: any[] = []; for (const c of iterable(table)) { if (!truth((!truth((() => { const __items: any[] = []; for (const t of iterable(JUDGE_TOKENS)) { __items.push((contains(c[3], t))); } return __items; })().some(truth))))) continue; __items.push(c[0]); } return __items; })();
  check("CJK contract: every requirement names an evaluator", (!truth(bad_judge)), ("rows without evaluators " + String(bad_judge) + " — a rule without an evaluator is recitation"));
  machine = (() => { const __items: any[] = []; for (const c of iterable(table)) { if (!truth((truth((contains(c[3], "scripts/"))) || truth((contains(c[3], "tests/")))))) continue; __items.push(c[0]); } return __items; })();
  human = (() => { const __items: any[] = []; for (const c of iterable(table)) { if (!truth((contains(c[3], "Human")))) continue; __items.push(c[0]); } return __items; })();
  check("CJK contract: some requirements have machine evaluators", (length(machine) >= 5), (String(length(machine)) + " requirements"));
  check("CJK contract: some requirements have human evaluators", (length(human) >= 3), (String(length(human)) + " requirements"));
  check("CJK contract: K-9 forbids character-width and tracking compression with concrete values", (truth((contains(text, "90% character width"))) && truth((contains(text, "-5% tracking")))));
  named = sorted(new Set(iterable(regexFindall("scripts/[\\w.-]+\\.(?:js|py)", text))));
  missing = (() => { const __items: any[] = []; for (const n of iterable(named)) { if (!truth((!truth(isFile(join(ROOT, n)))))) continue; __items.push(n); } return __items; })();
  check("CJK contract: every script named as an evaluator exists", (!truth(missing)), ("missing " + String(missing) + " / named " + String(named)));
  check("CJK contract: at least one evaluator script is named", (length(named) >= 3), (String(length(named)) + " scripts"));
  check("CJK contract: document discloses what is not enforced", (truth((contains(text, "## Limitations"))) && truth((contains(text, "does not enforce them all")))));
  passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
  console.log(("\n" + String(passed) + "/" + String(length(results)) + " passed"));
  return (truth((equal(passed, length(results)))) ? 0 : 1);
}

if(isMain(import.meta.url))process.exitCode=main();
