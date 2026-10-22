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
const verifier=await import('./verify-geometry.js');
const VERIFIER = join(ROOT, "scripts/verify-geometry.js");
const ASSET_DIR = join(ROOT, "assets");
const ARCHITECTURE = join(ASSET_DIR, "example-architecture.html");
const SWIMLANE = join(ASSET_DIR, "example-swimlane.html");
const ZONED = join(ASSET_DIR, "example-dp-integration.html");
const SEQUENCE_OAUTH = join(ASSET_DIR, "example-sequence-oauth.html");

function load_verifier():any{return verifier;}
const SVG_HEAD = "<svg viewBox=\"0 0 400 200\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-labelledby=\"t-title t-desc\"><title id=\"t-title\">T</title><desc id=\"t-desc\">T.</desc>";

function document(body: any): any {
  return ("<!DOCTYPE html><html><body>" + String(SVG_HEAD) + String(body) + "</svg></body></html>");
}

function main(): any {
  let badge: any, failure: any, failures: any, module: any, node: any, zone: any;
  module = load_verifier();
  failures = [];
  function check(label: any, source: any, expect_findings: any): any {
    let candidate: any, findings: any, scratch: any;
    scratch = mkdtempSync(join(tmpdir(), "diagram-geometry-test-"));
    try {
      candidate = join(scratch, "candidate.html");
      writeFileSync(candidate, source);
      findings = module.check(candidate);
    } finally { rmSync(scratch, {recursive:true,force:true}); }
    if (truth((!equal(length(findings), expect_findings)))) {
      failures.push((String(label) + ": expected " + String(expect_findings) + " finding(s), got " + String(length(findings)) + ": " + String(findings)));
    } else {
      console.log(("OK: " + String(label)));
    }
  }
  function check_file(label: any, path: any, expect_findings: any): any {
    let findings: any;
    findings = module.check(path);
    if (truth((!equal(length(findings), expect_findings)))) {
      failures.push((String(label) + ": expected " + String(expect_findings) + " finding(s), got " + String(length(findings)) + ": " + String(findings)));
    } else {
      console.log(("OK: " + String(label)));
    }
  }
  node = "<rect x=\"100\" y=\"60\" width=\"160\" height=\"64\" rx=\"6\" fill=\"#f5f5f5\"/>";
  badge = "<rect x=\"108\" y=\"68\" width=\"32\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>";
  zone = "<rect x=\"80\" y=\"40\" width=\"240\" height=\"120\" rx=\"8\" fill=\"#eee\"/>";
  check("mask clipped by a later node", document(("<rect x=\"240\" y=\"80\" width=\"48\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>" + node)), 1);
  check("mask over an earlier node is legal", document((node + "<rect x=\"240\" y=\"80\" width=\"48\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>")), 0);
  check("badge chip inside a node", document((badge + node)), 0);
  check("zone eyebrow on a zone container", document((zone + "<rect x=\"160\" y=\"34\" width=\"60\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>")), 0);
  check("mask clear of every node", document(("<rect x=\"10\" y=\"10\" width=\"48\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>" + node)), 0);
  check("mask abutting a node edge", document(("<rect x=\"52\" y=\"80\" width=\"48\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>" + node)), 0);
  check("wide mono mask clipped by a later node", document(("<rect x=\"180\" y=\"80\" width=\"128\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>" + node)), 1);
  check("wide mono mask over an earlier node is legal", document((node + "<rect x=\"180\" y=\"80\" width=\"128\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/>")), 0);
  check("container header bar is not a mask", document(("<rect x=\"80\" y=\"80\" width=\"188\" height=\"16\" rx=\"2\" fill=\"#eee\"/>" + node)), 0);
  check_file("shipped architecture example", ARCHITECTURE, 0);
  check_file("shipped swimlane example", SWIMLANE, 0);
  check_file("shipped zoned example", ZONED, 0);
  check_file("shipped sequence-oauth example", SEQUENCE_OAUTH, 0);
  if (truth(failures)) {
    console.log("\nFAILURES:");
    for (failure of iterable(failures)) {
      console.log(("  - " + String(failure)));
    }
    return 1;
  }
  console.log("All label geometry tests passed.");
  return 0;
}

if(isMain(import.meta.url))process.exitCode=main();
