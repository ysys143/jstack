#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../../runtime/entry.js';
import { check_script_contracts, check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total,
  split_frontmatter, check_skill_body, check_ref_contracts, check_body_paths, read_ref,
  in_deleted_run, type Result } from '../../../../_suite_lib.js';
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
function contains(haystack: any, needle: any): boolean { return Buffer.isBuffer(haystack) ? haystack.includes(needle) : typeof haystack === 'string' ? haystack.includes(needle) : [...iterable(haystack)].some((value: any) => equal(value, needle)); }
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

import {mkdtempSync,writeFileSync,rmSync,mkdirSync,cpSync,copyFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {deflateSync,inflateRawSync} from 'node:zlib';
import ts from 'typescript';
import {specialistStatus} from '../../../../../runtime/specialists.js';
let python=process.execPath;
function specialistPython():string{const state=specialistStatus('diagram-fonts',{home:process.env.JSTACK_SPECIALIST_HOME,root:dirname(SKILLS)});if(state.state!=='ready')throw new Error('Set up the manifest-locked diagram-fonts environment before running font specialist contracts');return state.python;}
function subprocessRun(args:any[],opts:any={}):any{const argv=args.map(String);if(argv[1]?.endsWith('subset_fonts.py'))argv[0]=specialistPython();const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',input:opts.input,env:opts.env??{...process.env,PYTHONDONTWRITEBYTECODE:'1'},cwd:opts.cwd,maxBuffer:32*1024*1024});return {returncode:r.status??2,stdout:r.stdout??'',stderr:r.stderr??String(r.error??'')};}
function openFile(path:string,mode:string|Record<string,unknown>='r',_opts:unknown={}){return {read:()=>typeof mode==='string'&&mode.includes('b')?readFileSync(path):readFileSync(path,'utf8'),write:(data:Buffer|string)=>writeFileSync(path,data),close:()=>{}};}
function splitLines(text:string|Buffer,keepends=false):any[]{if(Buffer.isBuffer(text)){const out:Buffer[]=[];let start=0;for(let i=0;i<text.length;i++)if(text[i]===10){out.push(text.subarray(start,keepends?i+1:(i>start&&text[i-1]===13?i-1:i)));start=i+1;}if(start<text.length)out.push(text.subarray(start));return out;}return keepends?(text.match(/[^\n]*\n|[^\n]+$/g)??[]):text.split(/\r?\n/).filter((line,i,all)=>i<all.length-1||line!=='');}
function stripChars(text:string,chars:string):string{let a=0,b=text.length;while(a<b&&chars.includes(text[a]))a++;while(b>a&&chars.includes(text[b-1]))b--;return text.slice(a,b);}
function subsetOrCompare(a:any,b:any):boolean{return a instanceof Set&&b instanceof Set?[...a].every(v=>b.has(v)):a<=b;}
function functionBodyStart(source:string,name:string):number|null{const sf=ts.createSourceFile('probe.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let found:number|null=null;const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name&&node.body)found=node.body.getStart(sf)+1;ts.forEachChild(node,visit);};visit(sf);return found;}
function hasFunction(source:string,name:string):boolean{return functionBodyStart(source,name)!==null;}
function documentedEnvelopes(text:string):any[]{return [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].flatMap(m=>{try{return [JSON.parse(m[1].replace(/\[ \.\.\. five repair stages \.\.\. \]/g,'[]'))];}catch{return [];}});}
function cp949Fixture(text:string):Buffer{const parts=text.split('한글');if(parts.length!==2)throw new Error('Expected fixed Korean decoder fixture');return Buffer.concat([Buffer.from(parts[0],'ascii'),Buffer.from('c7d1b1db','hex'),Buffer.from(parts[1],'ascii')]);}
function pyOr(...values:any[]):any{return values.find(truth)??values.at(-1);}
function add(a:any,b:any):any{return Buffer.isBuffer(a)&&Buffer.isBuffer(b)?Buffer.concat([a,b]):Array.isArray(a)&&Array.isArray(b)?[...a,...b]:a+b;}
function multiply(a:any,b:number):any{return Buffer.isBuffer(a)?Buffer.concat(Array.from({length:b},()=>a)):typeof a==='string'?a.repeat(b):a*b;}
function ends(text:string,parts:string|string[]):boolean{return Array.isArray(parts)?parts.some(p=>text.endsWith(p)):text.endsWith(parts);}
function formatText(text:string,...values:any[]):string{let index=0;return text.replace(/\{\}/g,()=>String(values[index++]));}
function jsonText(value:any):string{return Array.isArray(value)?'['+value.map(jsonText).join(', ')+']':value!==null&&typeof value==='object'?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+': '+jsonText(v)).join(', ')+'}':JSON.stringify(value);}
function copyTree(src:string,dst:string):void{cpSync(src,dst,{recursive:true,filter:source=>!['__pycache__','.omc','tests'].includes(basename(source))&&!source.endsWith('.pyc')});}
function relocatedModule(source:string,baseFile:string):string{return source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,(_m,start,rel,end)=>start+new URL(rel,baseFile).href+end);}
function pack(format:string,...values:number[]):Buffer{if(format==='>I'){const b=Buffer.alloc(4);b.writeUInt32BE(values[0]>>>0);return b;}if(format==='>IIBBBBB'){const b=Buffer.alloc(13);b.writeUInt32BE(values[0]);b.writeUInt32BE(values[1],4);for(let i=2;i<7;i++)b[i+6]=values[i];return b;}throw new Error('Unsupported PNG fixture format');}
function crc32(bytes:Buffer):number{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;}
const VERIFY = join(ROOT, "scripts", "verify-geometry.js");
const VERIFY_TEST = join(ROOT, "scripts", "test-verify-geometry.js");

function read(path:string):string{return readFileSync(path,'utf8');}

function checkCurrentUpstream(): void {
  const upstream = join(ROOT, 'repos/diagram-design');
  const manifest = JSON.parse(read(join(ROOT, 'UPSTREAM.v2.6.22.json')));
  check('Current upstream: version, commit, license and nonempty population are pinned',
    manifest.version === '2.6.22' && manifest.commit === '8d8b2993ee2256ee7dfc0eeb3b5713aba3b60792'
    && manifest.license === 'MIT' && manifest.files.length === 247);
  const actual = [...walk(upstream)].flatMap(([dir, _dirs, files]) => files.map(file => relative(upstream, join(dir, file)).split(sep).join('/'))).sort();
  check('Current upstream: manifest covers the exact imported tree',
    equal(actual, manifest.files.map((row: {path:string}) => row.path).sort()));
  const fileHash = new Map(actual.map(path => [path, createHash('sha256').update(readFileSync(join(upstream, path))).digest('hex')]));
  const drift = manifest.files.filter((row: {path:string;sha256:string}) =>
    !existsSync(join(upstream, row.path)) || fileHash.get(row.path) !== row.sha256);
  check('Current upstream: every byte matches the fetched original', drift.length === 0, JSON.stringify(drift));
  const catalog = read(join(ROOT, 'references/type-catalog.md'));
  const links = [...catalog.matchAll(/\]\(\.\.\/repos\/diagram-design\/skills\/diagram-design\/references\/([^)#]+)\)/g)];
  check('Current upstream: all 40 type links resolve to real references', links.length === 40 && links.every(match =>
    existsSync(join(upstream, 'skills/diagram-design/references', match[1]))));
  const py = specialistPython();
  // The gates below read only this upstream tree through the pinned interpreter.
  // Deletion copies change jstack documents, never these inputs, so a copy whose own
  // upstream digest matches reuses the live run's results instead of recomputing
  // them; any difference in the tree or interpreter runs every gate again.
  const gateDigest = createHash('sha256').update(py).update('\0')
    .update(actual.map(path => path + '\0' + fileHash.get(path)).join('\n')).digest('hex');
  const reused = (() => {
    if (!in_deleted_run(ROOT)) return null;
    try {
      const cache = JSON.parse(process.env.JSTACK_DIAGRAM_UPSTREAM_GATES ?? 'null');
      return cache?.digest === gateDigest ? cache.results as Record<string, {ok:boolean;detail:string}> : null;
    } catch { return null; }
  })();
  const gateResults: Record<string, {ok:boolean;detail:string}> = {};
  // Stdlib-only tests must not pick up an installed browser integration.
  const invoke = (script:string, args:string[] = []) => spawnSync(py, ['-S', join(upstream, script), ...args], {
    cwd:upstream, env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}, encoding:'utf8', timeout:180000, maxBuffer:8*1024*1024});
  const gates = [
    ['test-self-check.py', 'All self-check tests passed'],
    ['verify-drawio-import.py', 'All draw.io import gates passed.'],
    ['verify-mermaid-import.py', 'All Mermaid import gates passed.'],
    ['verify-excalidraw-import.py', 'All Excalidraw import gates passed.'],
    ['test-verify-drawio-import.py', 'verifier rejects'],
    ['test-verify-excalidraw-import.py', 'verifier rejects'],
    ['test-lint-a11y.py', 'OK:'],
    ['test-build-icons-quoted-attributes.py', 'PASS:'],
    ['test-build-icons-devicon.py', 'PASS:'],
  ];
  for (const [name, verdict] of gates) {
    const previous = reused?.[name];
    if (previous) {
      check('Current upstream regression: ' + name, previous.ok, previous.detail + ' (live-run result; same upstream digest)');
      continue;
    }
    const result = invoke('scripts/' + name);
    const ok = result.status === 0 && result.stdout.includes(verdict);
    const detail = result.status === 0 ? result.stdout.trim().split('\n').at(-1) ?? '' : (result.stdout + result.stderr + String(result.error ?? '')).slice(-1800);
    gateResults[name] = { ok, detail };
    check('Current upstream regression: ' + name, ok, detail);
  }
  if (!in_deleted_run(ROOT)) process.env.JSTACK_DIAGRAM_UPSTREAM_GATES = JSON.stringify({ digest: gateDigest, results: gateResults });
  const box = mkdtempSync(join(tmpdir(), 'diagram-accessibility-'));
  try {
    const svg = '<svg role="img" aria-labelledby="ko-title ko-desc"><title id="ko-title">인증 구조</title><desc id="ko-desc">서비스 간 인증 요청</desc><text x="20" y="20">인증</text></svg>';
    const path = join(box, 'ko.svg'); writeFileSync(path, svg);
    const good = invoke('skills/diagram-design/scripts/self_check.py', [path]);
    check('Current upstream: accessibility accepts standalone Korean SVG', good.status === 0, good.stdout + good.stderr);
    writeFileSync(path, svg.replace('role="img"', ''));
    const bad = invoke('skills/diagram-design/scripts/self_check.py', [path]);
    check('Current upstream: removing standalone SVG role fails the actual checker', bad.status !== 0 &&
      (bad.stdout + bad.stderr).includes('role=img'), bad.stdout + bad.stderr);
  } finally { rmSync(box, {recursive:true,force:true}); }
  const skill = read(join(ROOT, 'SKILL.md')), gate = read(join(ROOT, 'references/taste-gate.md'));
  check('Repair policy: prose uses the executable five-stage order with deletion last',
    [skill, gate].every(text => text.includes('relocate -> reroute -> shorten -> restructure -> delete') &&
      !text.includes('deletion -> spacing compression')));
}

function _tracked(path: any): any {
  let r: any;
  path = resolve(path);
  try {
    r = subprocessRun(["git", "ls-files", "--error-unmatch", "--", path], {capture_output:true, text:true, cwd:pyOr(dirname(path), ".")});
    return (equal(r.returncode, 0));
  } catch (__error: any) {
    return false;
  }
}
const TOTAL_BASE = 385;
const SCRIPT_FLOORS = {["scripts/verify-geometry.js"]: 5, ["scripts/test-verify-geometry.js"]: 3, ["scripts/verify-connectors.js"]: 57, ["scripts/verify-text-width.js"]: 22, ["scripts/measure_label.js"]: 18, ["scripts/export_scale.js"]: 6, ["scripts/check_effective_size.js"]: 10, ["scripts/encode_drawio_url.js"]: 3, ["scripts/repair_png.js"]: 4, ["scripts/subset_fonts.py"]: 5};

function main(): any {
  let KO_STACK: any, LIMIT_CLAIMED: any, LIMIT_SCRIPTS: any, NAME: any, OWNED: any, POINTERS: any, RUNNABLE: any, VC: any, XREF: any, _: any, _EM_OSP: any, _EM_SKILL: any, _PT_OSP: any, _PT_SKILL: any, _actual: any, _actual_scripts: any, _bodies: any, _body: any, _gd: any, _glines: any, _gout: any, _gp: any, _gr: any, _gtxt: any, _limit_claim: any, _name: any, _negative: any, _osp: any, _osp_path: any, _p: any, _probe: any, _rn: any, _rng: any, _scripts_dir: any, _sf_r: any, _sp_r: any, _t_ko: any, _tgp: any, _tgt: any, _undeclared: any, a3: any, a3_p: any, a3_r: any, a4_p: any, a4_r: any, a_over: any, a_p: any, a_r: any, after: any, al_p: any, al_r: any, anchor: any, arc_codes: any, arc_p: any, arc_r: any, arc_src: any, asset_bytes: any, asset_lines: any, axis: any, bad: any, bad_p: any, bad_r: any, begin: any, begin_count: any, begin_marker: any, bjp: any, bl: any, body: any, bp: any, br: any, budget: any, c_p: any, c_r: any, case_: any, cjk: any, clause: any, codes: any, codes2: any, codes2ok: any, codes5: any, codes5b: any, codes5ok: any, codes_ok: any, codes_zero: any, codesm: any, codesw: any, codesz: any, cond: any, conn: any, cp: any, cr: any, cr_d: any, cr_p: any, cr_r: any, cr_src: any, crit: any, d: any, d0: any, d12: any, d2: any, d4: any, d5: any, d9: any, declared: any, del_p: any, del_r: any, derived_by_path: any, derived_paths: any, derived_records: any, documented: any, dst: any, dw: any, el_p: any, el_r: any, emitted: any, enc: any, end: any, end_count: any, end_marker: any, entries: any, ep: any, er: any, ev: any, ex_p: any, ex_r: any, expected: any, expo: any, f: any, fh: any, filename: any, fixes: any, flag: any, fm: any, fp: any, fp_: any, fr: any, fx: any, g_p: any, g_r: any, gone: any, got: any, gp: any, gr: any, h: any, heads: any, hop: any, hp_d: any, hp_p: any, hp_src: any, k: any, ko: any, kp: any, la: any, label: any, legend_src: any, lg_codes: any, lg_diags: any, lg_p: any, lg_r: any, lic: any, lic2: any, line: any, live_diags: any, live_p: any, live_ran: any, ln: any, m: any, m_def: any, m_del: any, m_row: any, m_tp: any, malformed: any, malformed_src: any, manifest: any, manifest_text: any, markers: any, markup: any, mcodes: any, mism: any, missing: any, ml: any, ml_p: any, ml_r: any, mp: any, mp_codes: any, mp_diags: any, mr: any, mut: any, mut_src: any, n: any, n_all: any, n_assert: any, n_bad: any, n_cjk: any, n_del: any, n_ko: any, n_ok: any, name: any, nc_p: any, nc_r: any, needle: any, neutered: any, nf: any, nf_p: any, nf_r: any, nfp: any, no_p: any, no_r: any, no_src: any, nofs: any, notice: any, np_: any, nums: any, nv_p: any, nv_r: any, od_codes: any, od_p: any, od_r: any, ok: any, ok_p: any, ok_r: any, ordinary: any, orphans: any, osp: any, ours: any, ov_d: any, ov_p: any, ov_r: any, ov_src: any, over_p: any, over_r: any, p: any, p12: any, p14: any, p2: any, p4: any, p5: any, p9: any, para: any, passed: any, pf: any, ph: any, pl_d: any, pl_p: any, pl_r: any, plain: any, pn: any, png: any, pointer_aliases: any, poly: any, r: any, r12: any, r14: any, r2: any, r2ok: any, r2s: any, r4: any, r5: any, r5b: any, r5ok: any, r9: any, r_dec: any, r_ko: any, r_missing: any, r_nf: any, r_ok: any, rb_diags: any, rb_p: any, rb_r: any, record_lines: any, record_prefix: any, record_re: any, referred: any, rel: any, rh: any, rj: any, rm: any, ro_p: any, ro_r: any, rollback_src: any, rt: any, rules: any, rules_md: any, rw: any, rw2: any, rz: any, scope: any, sf_p: any, shipped_counts: any, skill: any, skill_all: any, skill_live: any, skills_dir: any, sp: any, sp_codes: any, sp_p: any, sp_path: any, sp_r: any, sp_src: any, sq: any, sq_p: any, sq_r: any, src: any, src_vg: any, st: any, st_codes: any, st_p: any, st_r: any, stripped: any, stub: any, swim: any, t: any, t_all: any, target: any, targets: any, td: any, tg: any, tgate: any, tgt: any, theirs: any, tmpl: any, tool: any, tp: any, tp_heads: any, tp_path: any, tr: any, tw: any, tw_src: any, unbuilt: any, url: any, v: any, vg: any, vt_src: any, want: any, why: any, work: any, wp: any, xml: any, z_over: any, z_p: any, z_r: any, zero_p: any;
  skill_all = read(join(ROOT, "SKILL.md"));
  checkCurrentUpstream();
  [fm, skill] = split_frontmatter(skill_all);
  check("Boundary: difference from image is declared in a table", (contains(skill, "| `diagram` | `image` |")));
  for (axis of iterable(["SVG", "PNG", "preserves structure", "Editable later", "Not editable"])) {
    check(("Boundary: table contains axis `" + String(axis) + "`"), (contains(skill, axis)));
  }
  check("Boundary: one-sentence decision criterion exists", (contains(skill, "are there relationships between elements?")));
  m_row = regexSearch("(?m)^\\|\\s*Output\\s*\\|([^|]*)\\|([^|]*)\\|", skill);
  check("Boundary: Output row exists", (m_row !== null));
  ours = (truth(m_row) ? m_row[1] : "");
  theirs = (truth(m_row) ? m_row[2] : "");
  check("Boundary: diagram column is SVG (columns not swapped)", (truth((contains(ours, "SVG"))) && truth((!contains(ours, "PNG")))), pyOr(ours.trim().slice(0, 30), "row missing"));
  check("Boundary: image column is PNG", (truth((contains(theirs, "PNG"))) && truth((!contains(theirs, "SVG")))), pyOr(theirs.trim().slice(0, 30), "row missing"));
  skills_dir = dirname(ROOT);
  NAME = "`([a-z][a-z-]{2,})`\\s+skill\\b";
  declared = sorted(new Set(iterable(regexFindall(NAME, skill))));
  unbuilt = new Set();
  referred = (() => { const __items: any[] = []; for (const n of iterable(declared)) { if (!truth((!contains(unbuilt, n)))) continue; __items.push(n); } return __items; })();
  missing = (() => { const __items: any[] = []; for (const n of iterable(referred)) { if (!truth((!truth(isDir(join(skills_dir, n)))))) continue; __items.push(n); } return __items; })();
  check("Referral target population is nonempty", (length(referred) >= 2), ("required " + String(referred) + " / declared unimplemented " + String(sorted(unbuilt))));
  check("Every referral target exists", (!truth(missing)), ("missing " + String(missing)));
  KO_STACK = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic'";
  check("Korean: SKILL.md contains the complete Korean font stack", (contains(skill, KO_STACK)));
  check("Korean: document says Geist has no CJK coverage", (truth((contains(skill, "Geist"))) && truth((contains(skill, "no CJK coverage")))));
  check("Korean: document forbids reusing the Japanese stack", (truth((contains(skill, "Japanese stack"))) && truth((contains(skill, "lacks Korean glyphs")))));
  _osp_path = join(ROOT, "references", "output-spec.md");
  osp = (truth(existsSync(_osp_path)) ? read(_osp_path) : "");
  function const_of(rel:string,name:string):number|null{const fp=join(ROOT,rel);if(!existsSync(fp))return null;const sf=ts.createSourceFile(fp,read(fp),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);for(const statement of sf.statements)if(ts.isVariableStatement(statement))for(const decl of statement.declarationList.declarations)if(ts.isIdentifier(decl.name)&&decl.name.text===name&&decl.initializer&&ts.isNumericLiteral(decl.initializer))return Number(decl.initializer.text);return null;}
  function _para(body: any, anchor: any): any {
    let block: any;
    for (block of iterable(split(body, "\n\n"))) {
      if (truth((contains(block, anchor)))) {
        return block;
      }
    }
    return "";
  }
  _EM_SKILL = "mixed-script width weights";
  _EM_OSP = "mixed-script weights";
  _PT_SKILL = "minimum effective size is";
  _PT_OSP = "final criterion is";
  XREF = [["measure_label.js EM_SPACE", "scripts/measure_label.js", "EM_SPACE", 0.25, "whitespace {}em", [["SKILL.md", _EM_SKILL], ["references/output-spec.md", _EM_OSP]]], ["measure_label.js EM_WIDE", "scripts/measure_label.js", "EM_WIDE", 1.0, "full-width {}em", [["SKILL.md", _EM_SKILL], ["references/output-spec.md", _EM_OSP]]], ["measure_label.js EM_NARROW", "scripts/measure_label.js", "EM_NARROW", 0.55, "Latin {}em", [["SKILL.md", _EM_SKILL], ["references/output-spec.md", _EM_OSP]]], ["verify-text-width.js ASCII_EM", "scripts/verify-text-width.js", "ASCII_EM", 0.6, "Latin {}em", [["SKILL.md", _EM_SKILL], ["references/output-spec.md", _EM_OSP]]], ["check_effective_size.js MIN_EFFECTIVE_PT", "scripts/check_effective_size.js", "MIN_EFFECTIVE_PT", 10.0, "{}pt", [["SKILL.md", _PT_SKILL], ["references/output-spec.md", _PT_OSP]]]];
  _bodies = {["SKILL.md"]: skill, ["references/output-spec.md"]: osp};
  for ([why, rel, name, want, tmpl, targets] of iterable(XREF)) {
    got = const_of(rel, name);
    check(("Cross-check: read " + String(why) + " from source"), (got !== null), ("could not find `" + String(name) + " = <number>` in " + String(rel) + "; update this check if renamed"));
    check(("Cross-check: " + String(why) + " matches measured value " + String(want)), (equal(got, want)), (String(got)));
    needle = (truth((got !== null)) ? formatText(tmpl, (String(got))) : null);
    for ([tgt, anchor] of iterable(targets)) {
      scope = _para((_bodies[tgt] ?? ""), anchor);
      check(("Cross-check: `" + String(anchor) + "` section in " + String(tgt) + " carries constant `" + String(formatText(tmpl, (String(want)))) + "`"), (truth(truth(scope)) && truth((needle !== null)) && truth((contains(scope.toLowerCase(), needle.toLowerCase())))), (truth((!truth(scope))) ? ("could not find paragraph `" + String(anchor) + "`") : ("paragraph lacks `" + String(needle) + "`; update prose with the constant")));
    }
  }
  for ([gone, why] of iterable([["The width budget is **one full-width character = 1em**", "L-14 upstream wording"], ["Size uses a **12px minimum**", "L-16 upstream wording"]])) {
    check(("Cross-check: SKILL.md does not restore " + String(why)), (!contains(skill, gone)), ("`" + String(gone) + "` reappeared"));
  }
  check("Cross-check: SKILL.md presents 12px as a separate viewBox-unit floor", (truth((contains(skill, "separate floor in `viewBox` units"))) && truth((contains(skill, "insufficient by itself")))), "restoring 12px as the final floor would recreate the contradiction");
  _tgp = join(ROOT, "references", "taste-gate.md");
  tgate = (truth(existsSync(_tgp)) ? read(_tgp) : "");
  budget = Object.fromEntries(regexFindall("(?m)^\\| (Procurement system architecture|Project organization chart|WBS or schedule) \\| \\*\\*(\\d+–\\d+)\\*\\* \\|", osp));
  check("Replacement L-22: parsed procurement budget table from output-spec", (equal(length(budget), 3)), (String(budget) + " — update this parser if the table format changed"));
  check("Replacement L-22: authority matches measured budgets (20–40, 15–25, 30–60)", (equal(budget, {["Procurement system architecture"]: "20–40", ["Project organization chart"]: "15–25", ["WBS or schedule"]: "30–60"})), String(sorted(Object.entries(budget))));
  for (_name of iterable(["Procurement system architecture", "Project organization chart", "WBS or schedule"])) {
    _rng = (budget[_name] ?? "");
    for ([_tgt, _body] of iterable([["SKILL.md", skill], ["taste-gate", tgate]])) {
      check(("Replacement L-22: " + String(_tgt) + " carries authoritative " + String(_name) + " budget"), (truth(truth(_rng)) && truth((contains(_body, _rng)))), ("authority `" + String(pyOr(_rng, "(not parsed)")) + "` is absent from " + String(_tgt)));
    }
  }
  check("Replacement L-22: upstream nine-node value was not restored as local budget", (truth((!contains(skill, "The standard complexity budget is nine nodes"))) && truth((!contains(tgate, "within the complexity budget — nine nodes")))), "upstream value may remain only when labeled as the web-diagram standard");
  check("Replacement L-22: prose explains why exceeding upstream budget is not a defect", (truth((contains(skill, "exceed the page limit or omit requirements"))) && truth((contains(osp, "exceed page"))) && truth((contains(osp, "limits or omit requirements")))));
  check("Replacement L-24: output-spec has a grayscale-legibility section", (truth((contains(osp, "## Grayscale legibility replaces the two-accent limit"))) && truth((contains(osp, "same distinctions remain when all color is removed")))));
  check("Replacement L-24: seven-to-two collapse is documented", (truth((contains(osp, "seven categories into two"))) && truth((contains(skill, "seven categories into two")))));
  for ([_tgt, _body] of iterable([["SKILL.md", skill], ["taste-gate.md", tgate]])) {
    check(("Replacement L-24: " + String(_tgt) + " carries grayscale legibility as a decision"), pyOr((contains(_body, "distinctions remain when color is removed")), (contains(_body, "same distinctions remain when all color is removed"))), "moving words alone would preserve the two-focus constraint");
  }
  check("Replacement L-24: two-focus constraint was not restored", (truth((contains(skill, "Do not enforce a two-accent-color limit"))) && truth((!contains(tgate, "Are accent colors used on **at most two** elements?")))), "restoring the checklist constraint would make grayscale decorative");
  check("Replacement L-25: taste-gate section is the omission test", (truth((contains(tgate, "## Omission test"))) && truth((!contains(tgate, "## Deletion test")))));
  check("Replacement L-25: reversed question exists", (truth((contains(tgate, "Does the diagram omit any RFP requirement?"))) && truth((contains(skill, "does this diagram omit\nany RFP requirement?")))));
  check("Replacement L-25: procurement rationale for reversal is documented", (truth((contains(tgate, "omit an RFP response"))) && truth((contains(skill, "omit an\n**RFP response**")))));
  check("Replacement L-25: all three SKILL.md references point to omission test", (truth((count(skill.toLowerCase(), "omission test") >= 1)) && truth((!contains(skill.toLowerCase(), "run the deletion test first")))), ("omission test " + String(count(skill.toLowerCase(), "omission test")) + " occurrences"));
  check("Replacement L-26: output-spec permits right-side legend placement", (truth((contains(osp, "### Legend placement"))) && truth((contains(osp, "**180px on the right**")))));
  check("Replacement L-26: fixed-bottom requirement is absent", (!contains(osp, "The legend is the bottom 60px and nothing else goes there")), "retaining the fixed sentence would create two contracts");
  check("Replacement L-26: rationale includes effective-pt calculation (8px to 4pt)", (contains(osp, "into **4pt**")));
  check("Replacement L-26: legend type must meet effective-pt floor", (contains(osp, "Either layout must meet the effective-pt floor")));
  check("Vendor: verify-geometry.js exists", existsSync(VERIFY));
  check("Vendor: test-verify-geometry.js was imported with it", existsSync(VERIFY_TEST), "importing only the validator would leave regressions undetected");
  if (truth(existsSync(VERIFY))) {
    n = length(splitLines(read(join(ROOT,"assets/upstream/verify-geometry.py.txt")), false));
    check("Vendor: original validator retains 168 lines and the migrated check is executable", (equal(n, 168) && hasFunction(read(VERIFY),"check")), (String(n) + " lines"));
  }
  if (truth(existsSync(VERIFY_TEST))) {
    n = length(splitLines(read(join(ROOT,"assets/upstream/test-verify-geometry.py.txt")), false));
    check("Vendor: adapted original tests retain 142 lines and migrated checks are executable", (equal(n, 142) && hasFunction(read(VERIFY_TEST),"check_file")), (String(n) + " lines"));
  }
  manifest = read(join(ROOT, "UPSTREAM.sha256"));
  entries = (() => { const __items: any[] = []; for (const ln of iterable(splitLines(manifest, false))) { if (!truth((truth(ln) && truth((!truth(starts(ln, "#"))))))) continue; __items.push(split(ln, null, 1)); } return __items; })();
  check("자기검사: hash manifest contains one entry", (equal(length(entries), 1)), (String(length(entries)) + " entries"));
  manifest_text = read(join(ROOT, "UPSTREAM.sha256"));
  record_prefix = "# sentinel-stripped-sha256 ";
  record_re = regex("^# sentinel-stripped-sha256 ([0-9a-f]{64}) (assets/example-[a-z-]+\\.html)$");
  record_lines = (() => { const __items: any[] = []; for (const line of iterable(splitLines(manifest_text, false))) { if (!truth(starts(line, record_prefix))) continue; __items.push(line); } return __items; })();
  derived_records = (() => { const __items: any[] = []; for (const line of iterable(record_lines)) { if (!truth((m = regexFullmatch(record_re.source, line)))) continue; __items.push(m.slice(1)); } return __items; })();
  derived_by_path = Object.fromEntries(Array.from(iterable(derived_records)).map(([want, rel]: any) => [rel, want]));
  derived_paths = new Set(["assets/example-architecture.html", "assets/example-dp-integration.html", "assets/example-sequence-oauth.html", "assets/example-swimlane.html"]);
  check("자기검사: sentinel-stripped hashes have exactly four machine-readable rows", (equal(length(record_lines), length(derived_records)) && equal(length(derived_records), 4)), ("prefixed " + String(length(record_lines)) + " / parsed " + String(length(derived_records))));
  check("자기검사: sentinel-stripped hashes identify four unique examples", (truth((equal(length(derived_by_path), 4))) && truth((equal(new Set(iterable(derived_by_path)), derived_paths)))), String(sorted(derived_by_path)));
  check("Source: three original hashes plus swimlane origin hash and geometry rationale remain", (() => { const __items: any[] = []; for (const needle of iterable(["The first three derive from upstream with only two paired-sentinel lines added", "03716fdb0a4ad641c30a5267b14a4c573d699f0f31ab3d8a0ba4e2b74ad56177", "929b6aaefa9a362d4cd18fb1801a57f28d32aa8dd78ba577375a11926ee2cc94", "700ff6d8a06aa0b04b67520e4def6388f1a334c1a63d9df9edc5f697eeee4a40", "example-swimlane.html is no longer an unchanged import", "75fc463ad3282dd0faaa4328c6b07f7e853184eeb1edcff2add8f7ed1876ab3b", "orthogonal L paths"])) { __items.push((contains(manifest_text, needle))); } return __items; })().every(truth), "removing it from the list without origin hash and geometry rationale is silent drift");
  begin_marker = Buffer.from("3c212d2d207665726966792d636f6e6e6563746f72733a6c6567656e643a424547494e202d2d3e", "hex");
  end_marker = Buffer.from("3c212d2d207665726966792d636f6e6e6563746f72733a6c6567656e643a454e44202d2d3e", "hex");
  function sentinel_marker(line:Buffer):Buffer|null{let content=line;if(content.at(-1)===10)content=content.subarray(0,-1);if(content.at(-1)===13)content=content.subarray(0,-1);while(content[0]===32||content[0]===9)content=content.subarray(1);while(content.at(-1)===32||content.at(-1)===9)content=content.subarray(0,-1);return content.equals(begin_marker)||content.equals(end_marker)?content:null;}
  for (rel of iterable(sorted(derived_paths))) {
    {
      fh = openFile(join(ROOT, rel), "rb");
      try {
        asset_bytes = fh.read();
      } finally { fh.close(); }
    }
    asset_lines = splitLines(asset_bytes, true);
    markers = (() => { const __items: any[] = []; for (const line of iterable(asset_lines)) { __items.push(sentinel_marker(line)); } return __items; })();
    begin_count = count(markers, begin_marker);
    end_count = count(markers, end_marker);
    check(("자기검사: " + String(rel) + " has exactly one full-line BEGIN and END sentinel"), (equal(begin_count, end_count) && equal(end_count, 1)), ("BEGIN " + String(begin_count) + " / END " + String(end_count)));
    stripped = Buffer.concat(Array.from((() => { const __items: any[] = []; for (const line of iterable(asset_lines)) { if (!truth((sentinel_marker(line) === null))) continue; __items.push(line); } return __items; })()));
    got = createHash("sha256").update(stripped).digest("hex");
    want = (derived_by_path[rel] ?? "");
    check(("자기검사: " + String(rel) + " matches derivative hash after removing two sentinel lines"), (truth((equal(begin_count, end_count) && equal(end_count, 1))) && truth((equal(got, want)))), (String(got.slice(0, 16)) + " != " + String(want.slice(0, 16))));
  }
  for ([want, rel] of iterable(entries)) {
    rel = rel.trim();
    f = join(ROOT, rel);
    if (truth((!truth(existsSync(f))))) {
      check(("자기검사: " + String(rel) + " is byte-identical to upstream"), false, "file missing");
      continue;
    }
    {
      fh = openFile(f, "rb");
      try {
        got = createHash("sha256").update(fh.read()).digest("hex");
      } finally { fh.close(); }
    }
    check(("자기검사: " + String(rel) + " is byte-identical to upstream"), (equal(got, want)), (String(got.slice(0, 16)) + " != " + String(want.slice(0, 16))));
  }
  work = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
  try {
    dst = join(work, "diagram");
    copyTree(ROOT, dst);
    vg = join(dst, "scripts", "verify-geometry.js");
    src_vg = read(vg);
    m_def = functionBodyStart(src_vg,"check");
    stub = m_def === null ? src_vg : src_vg.slice(0,m_def)+" return []; "+src_vg.slice(m_def);
    neutered = (!equal(stub, src_vg));
    {
      fh = openFile(vg, "w", {encoding:"utf-8"});
      try {
        fh.write(relocatedModule(stub,new URL("../scripts/verify-geometry.js",import.meta.url).href));
      } finally { fh.close(); }
    }
    writeFileSync(join(dst,"scripts","test-verify-geometry.js"),relocatedModule(read(VERIFY_TEST),new URL("../scripts/test-verify-geometry.js",import.meta.url).href));
    writeFileSync(join(dst,"package.json"),'{"type":"module"}');
    r2 = subprocessRun([python, "test-verify-geometry.js"], {capture_output:true, text:true, cwd:join(dst, "scripts")});
    check("자기검사: created a copy with verdict logic disabled", neutered, "could not find check_file; update this test if upstream structure changed");
    check("자기검사: vendor test measures validator **verdicts** through mutation", (truth(neutered) && truth((!equal(r2.returncode, 0)))), "test passes with verdicts removed, so it checks only importability");
  } finally {
    rmSync(work, {recursive:true,force:true});
  }
  vt_src = read(VERIFY_TEST);
  n_assert = length(regexFindall("(?m)^\\s*check_file\\(", vt_src));
  check("Vendor: test has measured four verdict assertions", (equal(n_assert, 4)), (String(n_assert) + " assertions"));
  r = subprocessRun([python, VERIFY_TEST], {capture_output:true, text:true, cwd:join(ROOT, "scripts")});
  check("자기검사: validator self-test passes", (equal(r.returncode, 0)), (truth(r.returncode) ? splitLines(pyOr(r.stderr, r.stdout).trim(), false).at(-1)!.slice(0, 80) : ""));
  const missingGeometry = subprocessRun([python, VERIFY, join(ROOT, "no-such-geometry-fixture.svg")], {capture_output:true, text:true});
  check("Validation: geometry CLI rejects missing input with a measured finding", missingGeometry.returncode === 1 && missingGeometry.stdout.includes("file not found") && missingGeometry.stdout.includes("1 finding(s)"), missingGeometry.stdout + missingGeometry.stderr);
  check("Validation: SKILL.md documents validator invocation path", (contains(skill, "skills/diagram/scripts/verify-geometry.js")));
  check("Validation: document requires both machine and human inspection", (truth((contains(skill, "Automated checks"))) && truth((contains(skill, "Visual inspection")))));
  notice = read(join(ROOT, "NOTICE"));
  check("Source: NOTICE identifies upstream and license", (truth((contains(notice, "MIT"))) && truth((contains(notice, "cathrynlavery/diagram-design")))));
  check("Source: NOTICE explains why validator was vendored", (truth((contains(notice, "From a repository checkout"))) && truth((contains(notice, "checklist recitation")))));
  check("Source: upstream version is recorded", (contains(notice, "v2.6.7")));
  lic = read(join(ROOT, "LICENSE.upstream"));
  check("Source: complete LICENSE is MIT with terms intact", (truth((contains(lic, "MIT License"))) && truth((contains(lic, "WITHOUT WARRANTY"))) && truth((contains(lic, "Permission is hereby granted")))), "a license name without the complete text is not sufficient notice");
  check("Source: SKILL.md also identifies upstream", (contains(skill, "up:diagram-design")));
  lic2 = read(join(ROOT, "LICENSE.archify"));
  conn = join(ROOT, "scripts", "verify-connectors.js");
  check("Connector: verify-connectors.js exists", existsSync(conn));
  if (truth(existsSync(conn))) {
    r = subprocessRun([python, conn, "--all"], {capture_output:true, text:true, cwd:ROOT});
    check("Connector: shipped examples have no diagonals", (equal(r.returncode, 0)), (truth((equal(r.returncode, 0))) ? "" : r.stdout.trim().slice(-200)));
    td = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
    try {
      src = read(join(ROOT, "assets", "example-architecture.html"));
      bad = src.replace("<line x1=\"168\" y1=\"272\" x2=\"220\" y2=\"272\"", "<line x1=\"168\" y1=\"272\" x2=\"220\" y2=\"300\"");
      check("Connector: mutation changed the file", (!equal(bad, src)));
      fp = join(td, "diag.html");
      {
        f = openFile(fp, "w", {encoding:"utf-8"});
        try {
          f.write(bad);
        } finally { f.close(); }
      }
      r2 = subprocessRun([python, conn, fp], {capture_output:true, text:true, cwd:ROOT});
      check("Connector: detects injected diagonal", (!equal(r2.returncode, 0)), (truth((!equal(r2.returncode, 0))) ? "" : "validator passed after a diagonal was injected"));
      function payload(...argv: any[]): any {
        let r: any;
        r = subprocessRun([python, conn, ...argv], {capture_output:true, text:true, cwd:ROOT});
        try {
          return [JSON.parse(String(r.stdout)), r];
        } catch (__error: any) {
          return [null, r];
        }
      }
      [ok_p, ok_r] = payload("--all", "--json");
      check("Diagnostics: --json emits one valid JSON value", (ok_p !== null), pyOr(ok_r.stdout, ok_r.stderr).trim().slice(0, 80));
      check("Diagnostics: envelope has schemaVersion 1 and identifies source", (truth(truth(ok_p)) && truth((equal((ok_p["schemaVersion"] ?? null), 1))) && truth((equal((ok_p["source"] ?? null), "verify-connectors")))), (truth(ok_p) ? String(ok_p).slice(0, 60) : "envelope missing"));
      check("Diagnostics: clean asset has ok=true and no diagnostics", (truth(truth(ok_p)) && truth(((ok_p["ok"] ?? null) === true)) && truth((equal((ok_p["diagnostics"] ?? null), [])))), (truth(ok_p) ? String((ok_p["diagnostics"] ?? null)).slice(0, 80) : "envelope missing"));
      n_ok = ((pyOr(ok_p, {})["summary"] ?? {})["connectors"] ?? 0);
      check("Diagnostics: clean asset actually parsed connectors (connectors > 0)", (n_ok > 0), (String(n_ok) + " connectors"));
      [bad_p, bad_r] = payload(fp, "--json");
      check("Diagnostics: injected diagonal produces ok=false", (truth(truth(bad_p)) && truth(((bad_p["ok"] ?? null) === false)) && truth((!equal(bad_r.returncode, 0)))), (truth(bad_p) ? String(bad_p).slice(0, 60) : "envelope missing"));
      d0 = (truth(bad_p) ? (pyOr(bad_p, {})["diagnostics"] ?? [{}])[0] : {});
      check("Diagnostics: diagonal code is connector/diagonal with error severity", (truth((equal((d0["code"] ?? null), "connector/diagonal"))) && truth((equal((d0["severity"] ?? null), "error")))), String((d0["code"] ?? null)));
      check("Diagnostics: subject contains file, line, connector, and segment", subsetOrCompare(new Set(["file", "line", "connector", "segment"]), new Set(iterable((d0["subject"] ?? {})))), String(sorted((d0["subject"] ?? {}))));
      ev = (d0["evidence"] ?? {});
      check("Diagnostics: evidence from/to are distinct real coordinates", (truth(Array.isArray((ev["from"] ?? null))) && truth(Array.isArray((ev["to"] ?? null))) && truth((!equal((ev["from"] ?? null), (ev["to"] ?? null))))), String(ev).slice(0, 80));
      fixes = (d0["supportedFixes"] ?? []);
      check("Diagnostics: five repair stages run from relocate through delete", (equal((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["action"] ?? null)); } return __items; })(), ["relocate", "reroute", "shorten", "restructure", "delete"])), String((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["action"] ?? null)); } return __items; })()));
      check("Diagnostics: only deletion requires evidence", (truth((equal(length(fixes), 5))) && truth((equal((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["requiresEvidence"] ?? null)); } return __items; })(), [false, false, false, false, true])))), String((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["requiresEvidence"] ?? null)); } return __items; })()));
      m_del = regexSearch("<line x1=\"168\" y1=\"272\" x2=\"220\" y2=\"300\"[^>]*/>", bad);
      check("Diagnostics: found the deletion mutation target", (m_del !== null), "connector tag not found; update this test if the asset changed");
      gone = (truth(m_del) ? add(bad.slice(0, m_del.index), bad.slice((m_del.index + m_del[0].length))) : bad);
      gp = join(td, "gone.html");
      {
        f = openFile(gp, "w", {encoding:"utf-8"});
        try {
          f.write(gone);
        } finally { f.close(); }
      }
      [del_p, del_r] = payload(gp, "--json");
      check("Diagnostics: deleting a connector turns result green (deletion path exists)", (truth(truth(del_p)) && truth((equal(del_r.returncode, 0))) && truth((equal(((del_p["summary"] ?? {})["findings"] ?? null), 0)))), (truth(del_p) ? String((del_p["summary"] ?? null)) : "envelope missing"));
      n_del = ((pyOr(del_p, {})["summary"] ?? {})["connectors"] ?? -1);
      n_bad = ((pyOr(bad_p, {})["summary"] ?? {})["connectors"] ?? -1);
      check("Diagnostics: deletion lowers connector total and exposes source of green", (truth((n_del >= 0)) && truth((n_bad >= 0)) && truth((n_del < n_bad))), (String(n_bad) + " -> " + String(n_del)));
      [nf_p, nf_r] = payload(join(td, "nope.html"), "--json");
      check("Diagnostics: missing file emits input/read", (truth(truth(nf_p)) && truth((!equal(nf_r.returncode, 0))) && truth((equal(((nf_p["diagnostics"] ?? [{}])[0]["code"] ?? null), "input/read")))), (truth(nf_p) ? String(((nf_p["diagnostics"] ?? [{}])[0]["code"] ?? null)) : "envelope missing"));
      check("Diagnostics: missing file emits no traceback", (!contains(nf_r.stderr, "Traceback")), nf_r.stderr.trim().slice(-80));
      h = subprocessRun([python, conn, fp], {capture_output:true, text:true, cwd:ROOT});
      check("Diagnostics: without --json, existing human-readable output remains", (truth((contains(h.stdout, "is diagonal ("))) && truth(ends(h.stdout.trimEnd(), "finding(s)."))), (truth(h.stdout) ? splitLines(h.stdout.trim(), false).at(-1)!.slice(0, 60) : "no output"));
      check("Diagnostics: human-readable path contains no JSON", (truth((!contains(h.stdout, "schemaVersion"))) && truth((!truth(starts(h.stdout, "{"))))), h.stdout.slice(0, 60));
      [zero_p, _] = payload("--all", "--min-overlap", "0", "--json");
      codes_zero = new Set((() => { const __items: any[] = []; for (const d of iterable((pyOr(zero_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })());
      check("Connector: examples have no overlap or crossing candidates even at threshold zero", (truth((zero_p !== null)) && truth((!truth(new Set([...codes_zero].filter(v=>["connector/ambiguous-corridor", "connector/proper-crossing"].includes(v))))))), String(sorted(codes_zero)));
      function seed(name: any, text: any, ...extra: any[]): any {
        let f: any, p: any, r: any;
        p = join(td, name);
        {
          f = openFile(p, "w", {encoding:"utf-8"});
          try {
            f.write(text);
          } finally { f.close(); }
        }
        r = subprocessRun([python, conn, p, ...extra], {capture_output:true, text:true, cwd:ROOT});
        try {
          return [JSON.parse(String(r.stdout)), r];
        } catch (__error: any) {
          return [null, r];
        }
      }
      ov_src = src.replace("<line x1=\"364\" y1=\"272\" x2=\"416\" y2=\"272\"", "<line x1=\"180\" y1=\"272\" x2=\"232\" y2=\"272\"");
      check("Connector: overlap mutation changed the file", (!equal(ov_src, src)), "update these coordinates if the asset changed");
      [ov_p, ov_r] = seed("overlap.html", ov_src, "--json");
      ov_d = (() => { const __items: any[] = []; for (const d of iterable((pyOr(ov_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/ambiguous-corridor")))) continue; __items.push(d); } return __items; })();
      check("Connector: detects injected corridor overlap (40px at y=272)", (truth((!equal(ov_r.returncode, 0))) && truth((equal(length(ov_d), 1))) && truth((contains(ov_d[0]["message"], "40"))) && truth((contains(ov_d[0]["message"], "272")))), (truth(ov_d) ? ov_d[0]["message"].slice(-70) : "corridor diagnostic missing"));
      check("Connector: corridor evidence contains numeric overlap length", (truth(truth(ov_d)) && truth((Math.abs(subtract((ov_d[0]["evidence"]["overlapPx"] ?? 0), 40)) < 1e-06))), (truth(ov_d) ? String(ov_d[0]["evidence"]) : "evidence missing"));
      begin = "<!-- verify-connectors:legend:BEGIN -->";
      end = "<!-- verify-connectors:legend:END -->";
      legend_src = ("<svg><line x1=\"20\" y1=\"20\" x2=\"80\" y2=\"40\" marker-end=\"url(#a)\"/></svg>\n" + String(begin) + "\n<svg><line x1=\"20\" y1=\"60\" x2=\"80\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"20\" y1=\"100\" x2=\"80\" y2=\"60\" marker-end=\"url(#a)\"/></svg>\n" + String(end) + "\n<svg><line x1=\"20\" y1=\"140\" x2=\"80\" y2=\"180\" marker-end=\"url(#a)\"/></svg>\n");
      check("Connector: paired-legend mutation changed the file", (!equal(legend_src, src)));
      [lg_p, lg_r] = seed("sentinel-exclusion.html", legend_src, "--json");
      lg_codes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(lg_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
      lg_diags = (pyOr(lg_p, {})["diagnostics"] ?? []);
      check("Connector: two connectors remain outside paired legend", (equal(((pyOr(lg_p, {})["summary"] ?? {})["connectors"] ?? null), 2)), String((pyOr(lg_p, {})["summary"] ?? null)));
      check("Connector: paired legend excludes its diagonal and reports two outside source lines", (truth((!equal(lg_r.returncode, 0))) && truth((equal(lg_codes, ["connector/diagonal", "connector/diagonal"]))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable(lg_diags)) { __items.push(((d["subject"] ?? {})["line"] ?? null)); } return __items; })(), [1, 5])))), String((() => { const __items: any[] = []; for (const d of iterable(lg_diags)) { __items.push([(d["code"] ?? null), (d["subject"] ?? null)]); } return __items; })()));
      ordinary = legend_src.replaceAll(begin, "<!-- Legend -->").replaceAll(end, "");
      [od_p, od_r] = seed("ordinary-legend.html", ordinary, "--json");
      od_codes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(od_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
      check("Connector: generic Legend comment does not hide diagonals", (truth((!equal(od_r.returncode, 0))) && truth((contains(od_codes, "connector/diagonal"))) && truth((equal(((pyOr(od_p, {})["summary"] ?? {})["connectors"] ?? null), 4)))), String(od_codes));
      malformed = {["orphan-begin"]: begin, ["orphan-end"]: end, ["reversed"]: add(add(end, "\n"), begin), ["nested"]: add(add(add(add(add(add(begin, "\n"), begin), "\n"), end), "\n"), end)};
      for ([case_, markup] of iterable(Object.entries(malformed))) {
        malformed_src = add(add(markup, "\n"), "<svg><line x1=\"20\" y1=\"20\" x2=\"80\" y2=\"40\" marker-end=\"url(#a)\"/></svg>\n");
        [mp, mr] = seed(("legend-" + String(case_) + ".html"), malformed_src, "--json");
        mp_diags = (pyOr(mp, {})["diagnostics"] ?? []);
        mp_codes = (() => { const __items: any[] = []; for (const d of iterable(mp_diags)) { __items.push((d["code"] ?? null)); } return __items; })();
        check(("Connector: " + String(case_) + " legend markers fail closed and count real diagonals"), (truth((!equal(mr.returncode, 0))) && truth((mp !== null)) && truth((contains(mp_codes, "input/legend-markup"))) && truth((equal(count((() => { const __items: any[] = []; for (const d of iterable(mp_diags)) { __items.push((d["code"] ?? null)); } return __items; })(), "connector/diagonal"), 1))) && truth((equal(((pyOr(mp, {})["summary"] ?? {})["connectors"] ?? null), 1)))), String(mp));
      }
      rollback_src = (String(begin) + "\n<svg><line x1=\"20\" y1=\"20\" x2=\"80\" y2=\"40\" marker-end=\"url(#a)\"/></svg>\n" + String(end) + "\n" + String(begin) + "\n<svg><line x1=\"20\" y1=\"60\" x2=\"80\" y2=\"100\" marker-end=\"url(#a)\"/></svg>\n");
      [rb_p, rb_r] = seed("legend-late-malformed-rollback.html", rollback_src, "--json");
      rb_diags = (pyOr(rb_p, {})["diagnostics"] ?? []);
      check("Connector: late legend-marker error rolls back exclusions and counts both diagonals", (truth((!equal(rb_r.returncode, 0))) && truth((contains((() => { const __items: any[] = []; for (const d of iterable(rb_diags)) { __items.push((d["code"] ?? null)); } return __items; })(), "input/legend-markup"))) && truth((equal(((pyOr(rb_p, {})["summary"] ?? {})["connectors"] ?? null), 2))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable(rb_diags)) { if (!truth((equal((d["code"] ?? null), "connector/diagonal")))) continue; __items.push(((d["subject"] ?? {})["line"] ?? null)); } return __items; })(), [2, 5])))), String(rb_p));
      shipped_counts = {["example-architecture.html"]: 5, ["example-dp-integration.html"]: 11, ["example-sequence-oauth.html"]: 8, ["example-swimlane.html"]: 6};
      for ([filename, expected] of iterable(Object.entries(shipped_counts))) {
        [cp, cr] = payload(join(ROOT, "assets", filename), "--json");
        check(("Connector: " + String(filename) + " ships " + String(expected) + " connectors"), (truth((equal(cr.returncode, 0))) && truth((cp !== null)) && truth((equal(((cp["summary"] ?? {})["connectors"] ?? null), expected)))), String((pyOr(cp, {})["summary"] ?? null)));
      }
      anchor = "        <line x1=\"168\" y1=\"272\" x2=\"220\" y2=\"272\"";
      check("Connector: found crossing-mutation insertion point", (contains(src, anchor)), "update this anchor if the asset changed");
      plain = "        <line x1=\"200\" y1=\"240\" x2=\"200\" y2=\"310\" stroke=\"#4f5d75\" stroke-width=\"1\" marker-end=\"url(#arrow)\"/>\n";
      cr_src = src.replace(anchor, add(plain, anchor));
      [cr_p, cr_r] = seed("crossing.html", cr_src, "--json");
      cr_d = (() => { const __items: any[] = []; for (const d of iterable((pyOr(cr_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/proper-crossing")))) continue; __items.push(d); } return __items; })();
      check("Connector: detects crossing without a hop", (truth((!equal(cr_r.returncode, 0))) && truth((length(cr_d) >= 1))), (String(length(cr_d)) + " findings"));
      hop = "        <path d=\"M 200,240 V 267 Q 205,272 200,277 V 310\" fill=\"none\" stroke=\"#4f5d75\" stroke-width=\"1\" marker-end=\"url(#arrow)\"/>\n";
      hp_src = src.replace(anchor, add(hop, anchor));
      check("Connector: hop control differs from crossing copy", (!equal(hp_src, cr_src)));
      [hp_p, _] = seed("hop.html", hp_src, "--json");
      hp_d = (() => { const __items: any[] = []; for (const d of iterable((pyOr(hp_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/proper-crossing")))) continue; __items.push(d); } return __items; })();
      check("Connector: drawing hop (Q) removes the crossing finding", (equal(length(hp_d), subtract(length(cr_d), 1))), (String(length(cr_d)) + " -> " + String(length(hp_d))));
      [nc_p, nc_r] = seed("crossing-off.html", cr_src, "--json", "--no-crossings");
      check("Connector: --no-crossings disables crossing check", (truth((equal(nc_r.returncode, 0))) && truth((!truth((() => { const __items: any[] = []; for (const d of iterable((pyOr(nc_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/proper-crossing")))) continue; __items.push(d); } return __items; })())))), (truth(nc_p) ? String((nc_p["summary"] ?? null)) : "envelope missing"));
      arc_src = src.replace("d=\"M 220,288 H 168\"", "d=\"M 220,288 H 168 A 5 5 0 0 1 180,300\"");
      check("Connector: arc mutation changed the file", (!equal(arc_src, src)));
      [arc_p, arc_r] = seed("arc.html", arc_src, "--json");
      arc_codes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(arc_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
      check("Connector: unsupported path command emits a finding", (truth((!equal(arc_r.returncode, 0))) && truth((contains(arc_codes, "connector/unsupported-path-command")))), String(arc_codes));
      no_src = regexSub("\\s*marker-end=\"[^\"]*\"", "", src, "");
      check("Connector: marker-end removal changed the file", (!equal(no_src, src)));
      [no_p, no_r] = seed("noconn.html", no_src, "--json");
      check("Connector: zero-connector file emits a finding", (truth((!equal(no_r.returncode, 0))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(no_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["input/no-connectors"])))), (truth(no_p) ? String(((no_p["diagnostics"] ?? [{}])[0]["code"] ?? null)) : "envelope missing"));
      sp_src = bad.replace("marker-end=\"url(#arrow-link)\"", "marker-end = \"url(#arrow-link)\"");
      check("Connector: whitespace mutation changed the file", (!equal(sp_src, bad)));
      [sp_p, sp_r] = seed("space.html", sp_src, "--json");
      sp_codes = sorted(new Set((() => { const __items: any[] = []; for (const d of iterable((pyOr(sp_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })()));
      check("Connector: population remains intact with whitespace around marker-end", (truth((!equal(sp_r.returncode, 0))) && truth((equal(((pyOr(sp_p, {})["summary"] ?? {})["connectors"] ?? null), 5))) && truth((contains(sp_codes, "connector/diagonal")))), (String((pyOr(sp_p, {})["summary"] ?? null)) + " " + String(sp_codes)));
      mut_src = read(conn).replace("\\bmarker-end\\s*=", "\\bmarker-end=");
      check("Connector: created a copy with only arrow regex reverted", (!equal(mut_src, read(conn))), "update this test if ARROW_RE shape changed");
      mut = join(td, "mutated-verify-connectors.mjs");
      {
        f = openFile(mut, "w", {encoding:"utf-8"});
        try {
          f.write(relocatedModule(mut_src,new URL("../scripts/verify-connectors.js",import.meta.url).href));
        } finally { f.close(); }
      }
      sp_path = join(td, "space.html");
      mr = subprocessRun([python, mut, sp_path, "--json"], {capture_output:true, text:true, cwd:ROOT});
      try {
        mp = JSON.parse(String(mr.stdout));
      } catch (__error: any) {
        mp = null;
      }
      mcodes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(mp, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
      check("Connector: collapsed population emits input/connector-population-mismatch", (truth((!equal(mr.returncode, 0))) && truth((contains(mcodes, "input/connector-population-mismatch")))), add(String(mcodes), " — this check becomes silent if accounting reuses ARROW_RE"));
      poly = "<svg><path d=\"M 100,100 q 10,0 10,10 10,10 20,20 h 5\" fill=\"none\" marker-end=\"url(#a)\"/><line x1=\"125\" y1=\"130\" x2=\"145\" y2=\"130\" marker-end=\"url(#a)\"/></svg>\n";
      [pl_p, pl_r] = seed("polybezier.html", poly, "--json", "--min-overlap", "0");
      pl_d = (() => { const __items: any[] = []; for (const d of iterable((pyOr(pl_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/ambiguous-corridor")))) continue; __items.push(d); } return __items; })();
      check("Connector: detects overlap after relative polybezier (y=130)", (truth((!equal(pl_r.returncode, 0))) && truth((equal(length(pl_d), 1))) && truth((contains(pl_d[0]["message"], "y=130")))), (truth(pl_d) ? pl_d[0]["message"].slice(-70) : String((() => { const __items: any[] = []; for (const d of iterable((pyOr(pl_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })())));
      enc = join(td, "latin1.html");
      {
        f = openFile(enc, "wb");
        try {
          f.write(Buffer.from("3c7376673e3c6c696e652078313d2230222079313d2230222078323d223130222079323d223022206d61726b65722d656e643d2275726c28236129222f3eff206261643c2f7376673e", "hex"));
        } finally { f.close(); }
      }
      er = subprocessRun([python, conn, enc, "--json"], {capture_output:true, text:true, cwd:ROOT});
      try {
        ep = JSON.parse(String(er.stdout));
      } catch (__error: any) {
        ep = null;
      }
      check("Diagnostics: non-UTF-8 file emits input/decode without traceback", (truth(truth(ep)) && truth((!equal(er.returncode, 0))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((ep["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["input/decode"]))) && truth((!contains(er.stderr, "Traceback")))), pyOr(er.stderr.trim().slice(-80), String(ep).slice(0, 80)));
      bl = join(td, "baseline.json");
      {
        f = openFile(bl, "w", {encoding:"utf-8"});
        try {
          f.write("[]");
        } finally { f.close(); }
      }
      br = subprocessRun([python, conn, fp, "--json", "--baseline", bl], {capture_output:true, text:true, cwd:ROOT});
      try {
        bp = JSON.parse(String(br.stdout));
      } catch (__error: any) {
        bp = null;
      }
      bjp = (() => { const __items: any[] = []; for (const d of iterable((pyOr(bp, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "input/json-parse")))) continue; __items.push(d); } return __items; })();
      check("Diagnostics: malformed baseline JSON is wrapped as input/json-parse", (truth((equal(length(bjp), 1))) && truth((equal((bjp[0]["severity"] ?? null), "warning"))) && truth((!contains(br.stderr, "Traceback")))), pyOr(br.stderr.trim().slice(-80), String(bjp).slice(0, 80)));
      expo = "<svg><path d=\"M 1e2,100 H 150\" fill=\"none\" marker-end=\"url(#a)\"/></svg>\n";
      [ex_p, ex_r] = seed("expo.html", expo, "--json");
      check("Connector: scientific-notation coordinates (1e2) do not false-positive", (truth((equal(ex_r.returncode, 0))) && truth((equal((pyOr(ex_p, {})["diagnostics"] ?? null), []))) && truth((equal(((pyOr(ex_p, {})["summary"] ?? {})["connectors"] ?? null), 1)))), String((pyOr(ex_p, {})["diagnostics"] ?? null)).slice(0, 80));
      sq = "<svg><line x1='100' y1='100' x2='200' y2='100' marker-end='url(#a)'/><path d='M 300,100 H 400' fill='none' marker-end='url(#a)'/></svg>\n";
      [sq_p, sq_r] = seed("singlequote.html", sq, "--json");
      check("Connector: single-quoted attributes do not false-positive", (truth((equal(sq_r.returncode, 0))) && truth((equal((pyOr(sq_p, {})["diagnostics"] ?? null), []))) && truth((equal(((pyOr(sq_p, {})["summary"] ?? {})["connectors"] ?? null), 2)))), String((pyOr(sq_p, {})["diagnostics"] ?? null)).slice(0, 80));
      rules_md = read(join(ROOT, "references", "connector-rules.md"));
      emitted = new Set(iterable(regexFindall("[\"']((?:connector|input|repair|taste)/[a-z-]+)[\"']", read(conn))));
      documented = new Set(iterable(regexFindall("(?m)^\\| `((?:connector|input|repair|taste)/[a-z-]+)` \\|", rules_md)));
      check("Diagnostics: code table exactly matches emitted set", (equal(emitted, documented)), ("documented only " + String(sorted(subtract(documented, emitted))) + " / emitted only " + String(sorted(subtract(emitted, documented)))));
      check("Diagnostics: emitted code count is measured 18", (equal(length(emitted), 18)), (String(length(emitted)) + " codes " + String(sorted(emitted))));
      [live_p, _] = payload(fp, "--json");
      check("Diagnostics: example envelope target diag.html exists", (truth((equal(basename(fp), "diag.html"))) && truth((live_p !== null))), (String(basename(fp)) + " — update the example when the name changes"));
      live_diags = (pyOr(live_p, {})["diagnostics"] ?? []);
      check("Diagnostics: example summary matches actual output", (contains(rules_md, jsonText((pyOr(live_p, {})["summary"] ?? {})))), jsonText((pyOr(live_p, {})["summary"] ?? {})));
      mism = live_diags.filter((d:any)=>!documentedEnvelopes(rules_md).some((env:any)=>(env.diagnostics??[]).some((row:any)=>['message','subject','evidence'].every(key=>equal(row[key],d[key]))))).map((d:any)=>d.code);
      check("Diagnostics: example message, subject, and evidence match actual output exactly", (truth(truth(live_diags)) && truth((!truth(mism)))), ("mismatched codes " + String(mism)));
    } finally { rmSync(td,{recursive:true,force:true}); }
  }
  VC = join(ROOT, "scripts", "verify-connectors.js");
  function strict(...argv: any[]): any {
    let r: any;
    r = subprocessRun([python, VC, ...argv, "--strict-rules", "--json"], {capture_output:true, text:true, cwd:ROOT});
    try {
      return [JSON.parse(String(r.stdout)), r];
    } catch (__error: any) {
      return [null, r];
    }
  }
  [st_p, st_r] = strict("--all");
  check("Strict: --strict-rules emits one valid JSON value", (st_p !== null), pyOr(st_r.stdout, st_r.stderr).trim().slice(0, 80));
  st_codes = {};
  for (d of iterable((pyOr(st_p, {})["diagnostics"] ?? []))) {
    st_codes[(d["code"] ?? null)] = add((st_codes[(d["code"] ?? null)] ?? 0), 1);
  }
  check("Strict: shipped-example debt matches measurement (label-gap 6, third-box 1)", (equal(st_codes, {["connector/label-gap"]: 6, ["connector/third-box-transit"]: 1})), String(sorted(Object.entries(st_codes))));
  check("Strict: outstanding total is seven", (equal(((pyOr(st_p, {})["summary"] ?? {})["findings"] ?? null), 7)), String((pyOr(st_p, {})["summary"] ?? null)));
  check("Strict: connector population remains 30 in strict mode", (equal(((pyOr(st_p, {})["summary"] ?? {})["connectors"] ?? null), 30)), String(((pyOr(st_p, {})["summary"] ?? {})["connectors"] ?? null)));
  td = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
  try {
    function seeded(name: any, markup: any, ...extra: any[]): any {
      let d: any, f: any, fp: any, p: any, r: any;
      fp = join(td, name);
      {
        f = openFile(fp, "w", {encoding:"utf-8"});
        try {
          f.write(markup);
        } finally { f.close(); }
      }
      [p, r] = strict(fp, ...extra);
      return [(() => { const __items: any[] = []; for (const d of iterable((pyOr(p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), p, r];
    }
    [codes, p4, r4] = seeded("fan.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"200\" y1=\"100\" x2=\"260\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"200\" y1=\"104\" x2=\"260\" y2=\"104\" marker-end=\"url(#a)\"/><rect x=\"40\" y=\"60\" width=\"160\" height=\"80\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    d4 = ((() => { const __items: any[] = []; for (const d of iterable((pyOr(p4, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/attachment-fan")))) continue; __items.push(d); } return __items; })().at(0) ?? {});
    check("Strict: rule 4 detects 4px attachment gap and reports distance", (truth((!equal(r4.returncode, 0))) && truth((equal(codes, ["connector/attachment-fan"]))) && truth((Math.abs(subtract(((d4["evidence"] ?? {})["separationPx"] ?? 0), 4)) < 1e-06)) && truth((equal(((d4["subject"] ?? {})["edge"] ?? null), "right")))), add(add(String(codes), " "), String((d4["evidence"] ?? null))));
    [codes_ok, _p, r_ok] = seeded("fan-ok.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"200\" y1=\"100\" x2=\"260\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"200\" y1=\"116\" x2=\"260\" y2=\"116\" marker-end=\"url(#a)\"/><rect x=\"40\" y=\"60\" width=\"160\" height=\"80\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    check("Strict: rule 4 control passes at 16px", (truth((equal(r_ok.returncode, 0))) && truth((equal(codes_ok, [])))), String(codes_ok));
    [codes2, p2, r2s] = seeded("gap.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"40\" y1=\"100\" x2=\"360\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"160\" x2=\"360\" y2=\"160\" marker-end=\"url(#a)\"/><rect x=\"100\" y=\"84\" width=\"60\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/></svg>\n");
    d2 = ((() => { const __items: any[] = []; for (const d of iterable((pyOr(p2, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/label-gap")))) continue; __items.push(d); } return __items; })().at(0) ?? {});
    check("Strict: rule 2 detects 4px label gap", (truth((!equal(r2s.returncode, 0))) && truth((equal(codes2, ["connector/label-gap"]))) && truth((Math.abs(subtract(((d2["evidence"] ?? {})["gapPx"] ?? 0), 4)) < 1e-06))), add(add(String(codes2), " "), String((d2["evidence"] ?? null))));
    [codes2ok, _p, r2ok] = seeded("gap-ok.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"40\" y1=\"100\" x2=\"360\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"160\" x2=\"360\" y2=\"160\" marker-end=\"url(#a)\"/><rect x=\"100\" y=\"82\" width=\"60\" height=\"12\" rx=\"2\" fill=\"#f5f5f5\"/></svg>\n");
    check("Strict: rule 2 control passes at 6px", (truth((equal(r2ok.returncode, 0))) && truth((equal(codes2ok, [])))), String(codes2ok));
    [codes5, p5, r5] = seeded("third.html", "<svg viewBox=\"0 0 600 200\"><line x1=\"40\" y1=\"100\" x2=\"560\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"180\" x2=\"560\" y2=\"180\" marker-end=\"url(#a)\"/><rect x=\"200\" y=\"70\" width=\"160\" height=\"60\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    d5 = ((() => { const __items: any[] = []; for (const d of iterable((pyOr(p5, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "connector/third-box-transit")))) continue; __items.push(d); } return __items; })().at(0) ?? {});
    check("Strict: rule 5 detects solid-line traversal and names failed condition", (truth((!equal(r5.returncode, 0))) && truth((equal(codes5, ["connector/third-box-transit"]))) && truth((equal(((d5["evidence"] ?? {})["failedConditions"] ?? null), ["stroke-dasharray"])))), add(add(String(codes5), " "), String(((d5["evidence"] ?? {})["failedConditions"] ?? null))));
    [codes5ok, _p, r5ok] = seeded("third-dashed.html", "<svg viewBox=\"0 0 600 200\"><style>.connector{stroke:#4f5d75}.connector.transit{stroke-dasharray:4 3}</style><line class=\"connector transit\" x1=\"40\" y1=\"100\" x2=\"560\" y2=\"100\" marker-end=\"url(#a)\"/><line class=\"connector\" x1=\"40\" y1=\"180\" x2=\"560\" y2=\"180\" marker-end=\"url(#a)\"/><rect x=\"200\" y=\"70\" width=\"160\" height=\"60\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    check("Strict: rule 5 exception reads dashed CSS class", (truth((equal(r5ok.returncode, 0))) && truth((equal(codes5ok, [])))), String(codes5ok));
    [codes5b, _p, r5b] = seeded("third-plain.html", "<svg viewBox=\"0 0 600 200\"><style>.connector{stroke:#4f5d75}.connector.transit{stroke-dasharray:4 3}</style><line class=\"connector\" x1=\"40\" y1=\"100\" x2=\"560\" y2=\"100\" marker-end=\"url(#a)\"/><line class=\"connector\" x1=\"40\" y1=\"180\" x2=\"560\" y2=\"180\" marker-end=\"url(#a)\"/><rect x=\"200\" y=\"70\" width=\"160\" height=\"60\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    check("Strict: compound selectors remain intact (dashed exemption does not leak)", (truth((!equal(r5b.returncode, 0))) && truth((contains(codes5b, "connector/third-box-transit")))), String(codes5b));
    [codesm, _p, rm] = seeded("maskfill.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"40\" y1=\"100\" x2=\"360\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"160\" x2=\"360\" y2=\"160\" marker-end=\"url(#a)\"/><rect x=\"100\" y=\"82\" width=\"60\" height=\"12\" rx=\"2\" fill=\"none\"/></svg>\n");
    check("Strict: taste check detects transparent label mask", (truth((!equal(rm.returncode, 0))) && truth((equal(codesm, ["taste/mask-fill"])))), String(codesm));
    [codesw, _p, rw2] = seeded("wm.html", "<svg viewBox=\"0 0 400 200\"><line x1=\"40\" y1=\"100\" x2=\"360\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"160\" x2=\"360\" y2=\"160\" marker-end=\"url(#a)\"/><text x=\"10\" y=\"50\" writing-mode=\"vertical-rl\" font-size=\"12\">세로</text></svg>\n");
    check("Strict: taste check detects vertical writing-mode", (truth((!equal(rw2.returncode, 0))) && truth((equal(codesw, ["taste/writing-mode"])))), String(codesw));
    [codesz, _p, rz] = seeded("zone.html", "<svg viewBox=\"0 0 600 300\"><line x1=\"40\" y1=\"100\" x2=\"560\" y2=\"100\" marker-end=\"url(#a)\"/><line x1=\"40\" y1=\"260\" x2=\"560\" y2=\"260\" marker-end=\"url(#a)\"/><rect x=\"180\" y=\"60\" width=\"240\" height=\"120\" rx=\"8\" fill=\"rgba(0,0,0,0.02)\" stroke=\"#ccc\"/><rect x=\"200\" y=\"120\" width=\"160\" height=\"40\" rx=\"6\" fill=\"#fff\" stroke=\"#000\"/></svg>\n");
    check("Strict: crossing a zone container does not trigger rule 5", (truth((equal(rz.returncode, 0))) && truth((equal(codesz, [])))), String(codesz));
  } finally { rmSync(td,{recursive:true,force:true}); }
  tw = join(ROOT, "scripts", "verify-text-width.js");
  check("Width: verify-text-width.js exists", existsSync(tw));
  if (truth(existsSync(tw))) {
    rw = subprocessRun([python, tw, "--all"], {capture_output:true, text:true, cwd:ROOT});
    check("Width: four example assets have no overflow", (equal(rw.returncode, 0)), (truth((equal(rw.returncode, 0))) ? "" : rw.stdout.trim().slice(-200)));
    function measured(...argv: any[]): any {
      let m: any, r: any;
      r = subprocessRun([python, tw, ...argv], {capture_output:true, text:true, cwd:ROOT});
      m = regexSearch("measured (\\d+) of (\\d+) label\\(s\\)", r.stdout);
      return [[(truth(m) ? Number(m[1]) : -1), (truth(m) ? Number(m[2]) : -1)], r];
    }
    [[n_all, t_all], _] = measured("--all");
    check("Width: measured label count is 96", (equal(n_all, 96)), (String(n_all) + " labels"));
    check("Width: coverage denominator is 128 total text elements", (equal(t_all, 128)), (String(t_all) + " labels"));
    rj = subprocessRun([python, tw, "--all", "--json"], {capture_output:true, text:true, cwd:ROOT});
    try {
      wp = JSON.parse(String(rj.stdout));
    } catch (__error: any) {
      wp = null;
    }
    check("Width: --json output is valid JSON and identifies source", (truth(truth(wp)) && truth((equal((wp["schemaVersion"] ?? null), 1))) && truth((equal((wp["source"] ?? null), "verify-text-width")))), pyOr(rj.stdout, rj.stderr).trim().slice(0, 80));
    pf = Object.fromEntries(Array.from(iterable(Object.entries(pyOr(((pyOr(wp, {})["summary"] ?? {})["perFile"] ?? null), {})))).map(([k, v]: any) => [k, [(v["measured"] ?? null), (v["texts"] ?? null)]]));
    check("Width: per-file measured/total counts match (23/32, 35/41, 21/28, 17/27)", (equal(pf, {["example-architecture.html"]: [23, 32], ["example-dp-integration.html"]: [35, 41], ["example-sequence-oauth.html"]: [21, 28], ["example-swimlane.html"]: [17, 27]})), String(pf).slice(0, 160));
    check("Width: unmeasured reasons match (32 uncontained, all others zero)", (equal(((pyOr(wp, {})["summary"] ?? {})["skipped"] ?? null), {["noContainer"]: 32, ["unmeasurable"]: 0, ["outOfScope"]: 0})), String(((pyOr(wp, {})["summary"] ?? {})["skipped"] ?? null)).slice(0, 120));
    td = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
    try {
      swim = read(join(ROOT, "assets", "example-swimlane.html"));
      ko = swim.replace(">REVISE</text>", ">본문 검토 반려 요청</text>");
      check("Width: Korean-label mutation changed the file", (!equal(ko, swim)));
      kp = join(td, "ko.html");
      {
        f = openFile(kp, "w", {encoding:"utf-8"});
        try {
          f.write(ko);
        } finally { f.close(); }
      }
      [[n_ko, _t_ko], r_ko] = measured(kp);
      check("Width: detects injected Korean label", (!equal(r_ko.returncode, 0)), (truth((!equal(r_ko.returncode, 0))) ? "" : "validator passed after Korean overflow was injected"));
      check("Width: measured label count remains 17 after Korean mutation", (equal(n_ko, 17)), (String(n_ko) + " labels"));
      nofs = swim.replace(" font-size=\"11\" font-weight=\"600\"", " font-weight=\"600\"");
      check("Width: font-size removal changed the file", (!equal(nofs, swim)));
      np_ = join(td, "nofs.html");
      {
        f = openFile(np_, "w", {encoding:"utf-8"});
        try {
          f.write(nofs);
        } finally { f.close(); }
      }
      r_nf = subprocessRun([python, tw, np_, "--json"], {capture_output:true, text:true, cwd:ROOT});
      try {
        nfp = JSON.parse(String(r_nf.stdout));
      } catch (__error: any) {
        nfp = null;
      }
      codes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(nfp, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
      check("Width: unreadable font-size emits text/unmeasurable", (truth((!equal(r_nf.returncode, 0))) && truth((contains(codes, "text/unmeasurable")))), String(codes).slice(0, 80));
      r_missing = subprocessRun([python, tw, join(td, "nope.html"), "--json"], {capture_output:true, text:true, cwd:ROOT});
      check("Width: missing file emits input/read without traceback", (truth((!equal(r_missing.returncode, 0))) && truth((contains(r_missing.stdout, "\"input/read\""))) && truth((!contains(r_missing.stderr, "Traceback")))), r_missing.stderr.trim().slice(-80));
      bp = join(td, "cp949.html");
      {
        f = openFile(bp, "wb");
        try {
          f.write(cp949Fixture("<svg><rect x=\"0\" y=\"0\" width=\"40\" height=\"12\"/><text x=\"20\" y=\"9\" font-size=\"8\">한글</text></svg>"));
        } finally { f.close(); }
      }
      r_dec = subprocessRun([python, tw, bp, "--json"], {capture_output:true, text:true, cwd:ROOT});
      check("Width: non-UTF-8 file emits input/decode without traceback", (truth((!equal(r_dec.returncode, 0))) && truth((contains(r_dec.stdout, "\"input/decode\""))) && truth((!contains(r_dec.stderr, "Traceback")))), r_dec.stderr.trim().slice(-80));
      function probe(name: any, body: any): any {
        let f: any, p: any, r: any;
        p = join(td, name);
        {
          f = openFile(p, "w", {encoding:"utf-8"});
          try {
            f.write(body);
          } finally { f.close(); }
        }
        r = subprocessRun([python, tw, p, "--json"], {capture_output:true, text:true, cwd:ROOT});
        try {
          return [JSON.parse(String(r.stdout)), r];
        } catch (__error: any) {
          return [null, r];
        }
      }
      [el_p, el_r] = probe("elemsel.html", "<html><head><style>svg text{font-size:12px}</style></head><body><svg viewBox=\"0 0 400 200\"><rect x=\"20\" y=\"60\" width=\"160\" height=\"48\" rx=\"6\"/><text x=\"100\" y=\"88\" text-anchor=\"middle\">Node name</text></svg></body></html>\n");
      check("Width: element selector svg text{font-size} parses without false positive", (truth((equal(el_r.returncode, 0))) && truth((equal((pyOr(el_p, {})["diagnostics"] ?? null), []))) && truth((equal(((pyOr(el_p, {})["summary"] ?? {})["labels"] ?? null), 1)))), String((pyOr(el_p, {})["diagnostics"] ?? null)).slice(0, 120));
      [g_p, g_r] = probe("gtranslate.html", "<svg viewBox=\"0 0 400 200\"><g transform=\"translate(100 40)\"><rect x=\"0\" y=\"0\" width=\"160\" height=\"48\" rx=\"6\"/><text x=\"80\" y=\"28\" font-size=\"12\" text-anchor=\"middle\">Node name</text></g></svg>\n");
      check("Width: label inside translated group measures without false positive", (truth((equal(g_r.returncode, 0))) && truth((equal((pyOr(g_p, {})["diagnostics"] ?? null), []))) && truth((equal(((pyOr(g_p, {})["summary"] ?? {})["labels"] ?? null), 1)))), String((pyOr(g_p, {})["diagnostics"] ?? null)).slice(0, 120));
      [z_p, z_r] = probe("zone.html", "<svg viewBox=\"0 0 800 400\"><rect x=\"60\" y=\"72\" width=\"696\" height=\"336\" rx=\"8\"/><rect x=\"548\" y=\"68\" width=\"120\" height=\"16\" rx=\"2\"/><text x=\"608\" y=\"79\" font-size=\"8\" letter-spacing=\"0.18em\" text-anchor=\"middle\">DATA PLATFORM XXXXXXXXXX</text></svg>\n");
      z_over = (() => { const __items: any[] = []; for (const d of iterable((pyOr(z_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "text/overflow")))) continue; __items.push(d); } return __items; })();
      check("Width: zone label pairs with its mask rather than zone rectangle", (truth((!equal(z_r.returncode, 0))) && truth((equal(length(z_over), 1))) && truth((equal(z_over[0]["evidence"]["containerWidth"], 120)))), String((pyOr(z_p, {})["diagnostics"] ?? null)).slice(0, 120));
      [c_p, c_r] = probe("cjk12.html", "<svg viewBox=\"0 0 800 400\"><rect x=\"40\" y=\"40\" width=\"120\" height=\"20\" rx=\"2\"/><text x=\"100\" y=\"55\" font-size=\"12\" text-anchor=\"middle\">인증 서비스 게이트웨이 라벨</text></svg>\n");
      check("Width: CJK 12px label with 20px mask is not silently skipped", (truth((!equal(c_r.returncode, 0))) && truth((equal(((pyOr(c_p, {})["summary"] ?? {})["labels"] ?? null), 1))) && truth((() => { const __items: any[] = []; for (const d of iterable((pyOr(c_p, {})["diagnostics"] ?? []))) { __items.push((equal((d["code"] ?? null), "text/overflow"))); } return __items; })().some(truth))), String((pyOr(c_p, {})["summary"] ?? null)).slice(0, 120));
      [a_p, a_r] = probe("anchor.html", "<svg viewBox=\"0 0 800 400\"><rect x=\"40\" y=\"40\" width=\"200\" height=\"48\" rx=\"6\"/><text x=\"235\" y=\"70\" font-size=\"12\" text-anchor=\"start\">sticking out</text></svg>\n");
      a_over = (() => { const __items: any[] = []; for (const d of iterable((pyOr(a_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "text/overflow")))) continue; __items.push(d); } return __items; })();
      check("Width: honors anchor and catches overflowing start-aligned label", (truth((!equal(a_r.returncode, 0))) && truth((equal(length(a_over), 1))) && truth((equal(a_over[0]["evidence"]["overflowSide"], "right")))), String((pyOr(a_p, {})["diagnostics"] ?? null)).slice(0, 120));
      [ro_p, ro_r] = probe("rotate.html", "<svg viewBox=\"0 0 400 200\"><g transform=\"rotate(-90 60 60)\"><rect x=\"20\" y=\"40\" width=\"80\" height=\"16\" rx=\"2\"/><text x=\"60\" y=\"52\" font-size=\"8\" text-anchor=\"middle\">ROTATED</text></g></svg>\n");
      check("Width: rotated text emits text/out-of-scope and is excluded from measurement", (truth((equal(ro_r.returncode, 0))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(ro_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["text/out-of-scope"]))) && truth((equal(((pyOr(ro_p, {})["summary"] ?? {})["labels"] ?? null), 0)))), String((pyOr(ro_p, {})["diagnostics"] ?? null)).slice(0, 120));
    } finally { rmSync(td,{recursive:true,force:true}); }
  }
  tw_src = (truth(existsSync(tw)) ? read(tw) : "");
  check("Width: docstring identifies coefficients as provisional", (truth((contains(tw_src, "provisional"))) && truth((contains(tw_src, "not been measured")))));
  check("Width: source explains why upstream formula was not copied", (truth((contains(tw_src, "6.5px"))) && truth((contains(tw_src, "false positives")))));
  check("Width: SKILL.md instructs validator execution", (contains(skill, "scripts/verify-text-width.js")));
  check("Width: SKILL.md identifies coefficients as provisional", (truth((contains(skill, "provisional"))) && truth((contains(skill, "ASCII 0.6em")))));
  check("Width: SKILL.md limitations disclose divergence from upstream", (truth((contains(skill, "6.5px × units + 13px"))) && truth((contains(skill, "diverges from archify"))) && truth((contains(skill, "does not validate the CJK path")))));
  check("Source: NOTICE records imported width formula and divergence", (truth((contains(notice, "text-fit.mjs"))) && truth((contains(notice, "20124265300eb286"))) && truth((contains(notice, "deliberately"))) && truth((contains(notice, "diverges")))));
  check("Source: NOTICE explains why rewrite is absent from UPSTREAM.sha256", (contains(notice, "byte-identical imports")));
  check("Source: LICENSE.archify is complete MIT text with terms intact", (truth((contains(lic2, "MIT License"))) && truth((contains(lic2, "WITHOUT WARRANTY"))) && truth((contains(lic2, "Permission is hereby granted")))), "a license name without the complete text is not sufficient notice");
  check("Source: archify dual copyright is preserved", (truth((contains(lic2, "tt-a1i"))) && truth((contains(lic2, "Cocoon AI")))), "upstream also credits architecture-diagram-generator");
  check("Source: NOTICE identifies archify import scope", (truth((contains(notice, "up:archify"))) && truth((contains(notice, "Orthogonality")))));
  check("Source: NOTICE records diagnostic schema import and supportedFixes divergence", (truth((contains(notice, "diagnostics.mjs"))) && truth((contains(notice, "supportedFixes"))) && truth((contains(notice, "object array")))));
  conn = read(join(ROOT, "references", "connector-rules.md"));
  tg = read(join(ROOT, "references", "taste-gate.md"));
  check("Rule 0: draw-arrows-before-boxes prerequisite exists", (truth((contains(conn, "Draw arrows before boxes"))) && truth((contains(conn, "prerequisite")))));
  check("Rule 0: explains why this is a validator prerequisite", (contains(conn, "zero findings")));
  [check("Rule 0: also appears in SKILL.md and taste-gate", (truth((contains(skill, "draw arrows before boxes"))) && truth((contains(tg, "Were arrows drawn before boxes?")))))];
  heads = regexFindall("(?m)^## \\d+\\.", conn);
  check("Six rules: all six clauses exist", (equal(length(heads), 6)), (String(length(heads)) + " rules"));
  for ([cond, why] of iterable([["stroke-dasharray", "dashed line"], ["visible end", "label placement"], ["actual destination", "arrowhead destination"]])) {
    check(("Rule 5 exception: " + String(why) + " condition exists"), (contains(conn, cond)));
  }
  for ([needle, why] of iterable([["automatically fail", "diagonal-failure strength"], ["6–10px", "label-to-connector clearance"], ["≥12px", "attachment and parallel spacing"], ["stroke-dasharray", "rule 5 dashed exception"], ["painted later", "rule 6 paint order"]])) {
    check(("Six rules: " + String(why) + " exists in the reference"), (contains(conn, needle)));
  }
  for ([needle, why] of iterable([["Collinear", "overlap basis (same axis and fixed coordinate)"], ["8px", "overlap threshold"], ["Drawing a rounded", "hop proxy behavior"], ["sibling exemption", "stricter-than-upstream disclosure"], ["--no-crossings", "false-positive escape hatch"], ["verify-connectors.js", "rules 1 and 3 validator path"]])) {
    check(("Rule 3: " + String(why) + " exists in the reference"), (contains(conn, needle)));
  }
  check("Rule 3: discloses unenforced near-parallel proximity", (truth((contains(conn, "Near-parallel noncollinear"))) && truth((contains(conn, "visual inspection")))));
  check("Rule 3: SKILL.md reports five machine-checked rules", (contains(skill, "Five of the six connector rules are machine-checked")), "the limitations become false if the enforced count remains stale");
  tp_path = join(ROOT, "references", "type-placement.md");
  tp = (truth(existsSync(tp_path)) ? read(tp_path) : "");
  tp_heads = regexFindall("(?m)^## (architecture|workflow|sequence|dataflow|lifecycle)\\b", tp);
  if (truth((!truth(tp_heads)))) {
    check("Placement: all five type sections exist", false, "parsed no type sections; update this check if heading format changed");
  } else {
    check("Placement: all five type sections exist", (equal(sorted(new Set(iterable(tp_heads))), ["architecture", "dataflow", "lifecycle", "sequence", "workflow"])), (String(sorted(new Set(iterable(tp_heads))))));
  }
  check("Placement: SKILL.md points to type-placement reference", (contains(skill, "references/type-placement.md")));
  m_tp = regexSearch("(?m)^\\|\\s*`references/type-placement\\.md`\\s*\\|([^|]*)\\|", skill);
  check("Placement: reference map has a type-placement row", (m_tp !== null), (truth(m_tp) ? "" : "could not parse row; update this check if backtick or spacing format changed"));
  check("Placement: SKILL.md routing contains all five type names", (() => { const __items: any[] = []; for (const t of iterable(["architecture", "workflow", "sequence", "dataflow", "lifecycle"])) { __items.push((contains(skill, t))); } return __items; })().every(truth));
  function live_text(body: any): any {
    return regexSub("<!--.*?-->", "", body, "s");
  }
  _probe = "<!-- scripts/nope.py -->\nThe body cites scripts/yes.py.\n";
  check("Routing: paths inside HTML comments do not count as citations", (truth((!contains(live_text(_probe), "scripts/nope.py"))) && truth((contains(live_text(_probe), "scripts/yes.py")))), String(live_text(_probe)).slice(0, 80));
  skill_live = live_text(skill);
  OWNED = ["references/upstream-integration.md", "references/type-catalog.md", "references/type-placement.md", "references/connector-rules.md", "references/output-spec.md", "references/taste-gate.md", "references/export.md", "references/cjk-contract.md", "references/font-delivery.md", "scripts/verify-geometry.js", "scripts/verify-connectors.js", "scripts/verify-text-width.js", "scripts/measure_label.js", "scripts/check_effective_size.js", "scripts/export_scale.js", "scripts/repair_png.js", "scripts/subset_fonts.py", "scripts/encode_drawio_url.js", "scripts/test-verify-geometry.js", "tests/run_tests.js", "tests/test_cjk_contract.js", "tests/_test_artifact_e2e.py", "assets/example-architecture.html", "assets/example-dp-integration.html", "assets/example-sequence-oauth.html", "assets/example-swimlane.html"];
  orphans = (() => { const __items: any[] = []; for (const rel of iterable(OWNED)) { if (!truth((!contains(skill_live, rel)))) continue; __items.push(rel); } return __items; })();
  check(("Citation: SKILL.md names all " + String(length(OWNED)) + " owned files (zero orphans)"), (!truth(orphans)), ("uncited " + String(orphans)));
  _actual = sorted((() => { const __items: any[] = []; for (const d of iterable([join(ROOT, "references"), join(ROOT, "scripts"), join(ROOT, "assets"), join(ROOT, "tests")])) { if (!truth(isDir(d))) continue; for (const n of iterable(readdirSync(d))) { if (n.endsWith(".test.js") || !truth(ends(n, [".md", ".py", ".js", ".html"]))) continue; __items.push(join(d, n).replaceAll(add(ROOT, sep), "")); } } return __items; })());
  check("Citation: OWNED covers every reference, script, asset, and test", (equal(sorted(OWNED), _actual)), ("unlisted " + String(sorted(subtract(new Set(iterable(_actual)), new Set(iterable(OWNED))))) + " / missing on disk " + String(sorted(subtract(new Set(iterable(OWNED)), new Set(iterable(_actual)))))));
  _scripts_dir = join(ROOT, "scripts");
  _actual_scripts = sorted((() => { const __items: any[] = []; for (const n of iterable((truth(isDir(_scripts_dir)) ? readdirSync(_scripts_dir) : []))) { if (!truth(ends(n, [".py",".js"]))) continue; __items.push(add("scripts/", n)); } return __items; })());
  check("Script completeness: SCRIPT_FLOORS lists every executable scripts file", (equal(sorted(SCRIPT_FLOORS), _actual_scripts)), ("unlisted " + String(sorted(subtract(new Set(iterable(_actual_scripts)), new Set(iterable(SCRIPT_FLOORS))))) + " / missing on disk " + String(sorted(subtract(new Set(iterable(SCRIPT_FLOORS)), new Set(iterable(_actual_scripts)))))));
  check("Script completeness: listed count matches measured 10", (equal(length(_actual_scripts), 10)), (String(length(_actual_scripts)) + " scripts; register new scripts with a floor"));
  RUNNABLE = (() => { const __items: any[] = []; for (const rel of iterable(SCRIPT_FLOORS)) { if (!truth((!equal(rel, "scripts/test-verify-geometry.js")))) continue; __items.push(rel); } return __items; })();
  for (rel of iterable(sorted(RUNNABLE))) {
    needle = add("${JSTACK_PLUGIN_ROOT}/skills/diagram/", rel);
    check(("Invocation example: SKILL.md shows how to run " + String(rel)), (contains(skill_live, needle)), "a prose mention does not show how to invoke it");
  }
  POINTERS = {["Legend exclusion markers"]: "references/connector-rules.md", ["Why rules 2, 4, and 5 are disabled by default"]: "references/connector-rules.md", ["Diagnostic contract"]: "references/connector-rules.md", ["Visual review at delivery"]: "references/taste-gate.md", ["Local adaptations"]: "references/output-spec.md", ["Procurement complexity budget"]: "references/output-spec.md", ["Grayscale legibility"]: "references/output-spec.md", ["Legend placement"]: "references/output-spec.md", ["Limitations"]: "SKILL.md"};
  for ([label, target] of iterable(sorted(Object.entries(POINTERS)))) {
    body = (truth(existsSync(join(ROOT, target))) ? read(join(ROOT, target)) : "");
    heads = regexFindall("(?m)^#{1,4} (.+?)\\s*$", body);
    check(("Pointer: `" + String(label) + "` names a real section in " + String(target)), (() => { const __items: any[] = []; for (const h of iterable(heads)) { __items.push(pyOr(starts(h, label), (contains(h, label)))); } return __items; })().some(truth), "heading missing; remove the citation too if the section was deleted");
  }
  pointer_aliases = {["Korean font contract"]: "Korean font contract: the core requirement", ["local changes"]: "Local adaptations"};
  function undeclared_section_pointers(text: any): any {
    let declared: any, found: any, label: any, raw: any;
    found = regexFindall("(?i)\\bthe ([a-z][a-z0-9 -]+?) section of `references/[a-z0-9_-]+\\.md`", text);
    declared = union(new Set(iterable(POINTERS)), new Set(iterable(Object.values(pointer_aliases))));
    return sorted((() => { const __items: any[] = []; for (const raw of iterable(found)) { for (const label of iterable([(pointer_aliases[raw] ?? raw)])) { if (!truth((!contains(declared, label)))) continue; __items.push(label); } } return __items; })());
  }
  _undeclared = undeclared_section_pointers(skill_live);
  _negative = undeclared_section_pointers(add(skill_live, "\nSee the Undeclared negative control section of `references/output-spec.md`.\n"));
  check("Pointer: every SKILL.md section citation is declared", (truth((!truth(_undeclared))) && truth((equal(_negative, ["Undeclared negative control"])))), ("undeclared " + String(_undeclared) + " / negative control " + String(_negative)));
  _limit_claim = ((() => { const __items: any[] = []; for (const para of iterable(split(skill_live, "\n- "))) { if (!truth((contains(para, "See each file's limitations")))) continue; __items.push(para); } return __items; })().at(0) ?? "");
  check("Pointer: SKILL.md contains its per-script limitations claim", truth(_limit_claim), "`See each file's limitations` claim missing");
  LIMIT_CLAIMED = sorted(new Set((() => { const __items: any[] = []; for (const n of iterable(regexFindall("`([a-z_]+\\.(?:js|py))`", _limit_claim))) { __items.push(add("scripts/", n)); } return __items; })()));
  LIMIT_SCRIPTS = ["scripts/check_effective_size.js", "scripts/export_scale.js", "scripts/measure_label.js", "scripts/repair_png.js", "scripts/subset_fonts.py"];
  check("Pointer: prose claim names the declared five scripts", (equal(LIMIT_CLAIMED, sorted(LIMIT_SCRIPTS))), ("claim " + String(LIMIT_CLAIMED) + " / declared " + String(sorted(LIMIT_SCRIPTS))));
  for (rel of iterable(LIMIT_SCRIPTS)) {
    src = (truth(existsSync(join(ROOT, rel))) ? read(join(ROOT, rel)) : "");
    check(("Pointer: " + String(rel) + " has a Limitations section"), (regexSearch("(?m)^(?:#{1,3} )?Limitations\\b", src) !== null), "SKILL.md points to this file's limitations, but the section is absent");
  }
  check_skill_body(check, ROOT, {needles: ["| `diagram` | `image` |", "are there relationships between elements?", "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic'", "draw arrows before boxes", "print-a4-landscape", "Automated checks", "Visual inspection", "up:diagram-design", "references/type-placement.md", "Choose the type", "scripts/verify-text-width.js", "## Phase 5: delivery", "`visual_review: pending`", "--strict-deletion", "--strict-rules", "scripts/measure_label.js", "scripts/check_effective_size.js", "references/cjk-contract.md", "references/font-delivery.md"], floor: 16226});
  for ([why, clause] of iterable([["pending status row", "| `visual_review: pending` | **Only automated capture or measurement was performed.** A screenshot is review material, not a passing verdict |"], ["passed status row", "| `visual_review: passed` | A person or image reader **actually inspected** the rendered artifact |"], ["failed status row", "| `visual_review: failed` | Inspection found concrete defects; record them |"], ["skipped status row", "| `visual_review: skipped (이미지 리더 없음)` | No means of viewing the artifact was available |"], ["automation cannot promote status", "Passing automated measurements **does not promote** `pending` to `passed`."], ["overflow prohibition introduction", "Do not obtain a pass through:"], ["prohibition 1: cropping wrappers", "- `overflow: hidden`, `clipPath`, or wrappers that crop SVG."], ["prohibition 2: clipped labels", "- Content clipping that reports a truncated label as fitting."], ["prohibition 3: typography reduction", "- **Typography reduction**: going below the 12px floor in `output-spec.md` automatically fails."], ["prohibition 4: broken aspect ratio", "- Stretching the SVG and breaking its aspect ratio."], ["repair order", "Repair in this order: **relocate -> reroute -> shorten -> restructure -> delete**."], ["no-enforcement disclosure", "**This section has no validator.**"], ["needle limitation disclosure", "**cannot detect contradictory additions that leave the originals intact**"]])) {
    check(("Visual review: complete clause remains — " + String(why)), (contains(tg, clause)), "clause changed; update this needle only for a legitimate contract revision");
  }
  check("Visual review: document defines exactly four statuses", (truth((contains(tg, "Four statuses"))) && truth((equal(count(tg, "| `visual_review: "), 4)))), (String(count(tg, "| `visual_review: ")) + " rows"));
  check("Visual review: taste-gate distinguishes pre-output from delivery", (truth((contains(tg, "At delivery, after output"))) && truth((contains(tg, "Only this section is a post-output contract")))));
  check("Visual review: taste-gate heading names delivery timing", (contains(tg, "## Visual review at delivery")));
  check("Visual review: SKILL.md reference map introduces delivery contract", (contains(skill, "delivery `visual_review` status contract")));
  check("Visual review: SKILL.md has a delivery phase", (truth((contains(skill, "## Phase 5: delivery"))) && truth((contains(skill, "report one of the **four statuses**")))));
  check("Visual review: SKILL.md contains all four statuses", (() => { const __items: any[] = []; for (const st of iterable(["pending", "passed", "failed", "skipped"])) { __items.push((contains(skill, ("`visual_review: " + String(st))))); } return __items; })().every(truth));
  check("Visual review: SKILL.md carries promotion ban and repair order", (truth((contains(skill, "does not promote `pending` to `passed`"))) && truth((contains(skill, "relocate -> reroute -> shorten -> restructure -> delete")))));
  check("Visual review: SKILL.md discloses self-reported delivery status", (truth((contains(skill, "self-reported"))) && truth((contains(skill, "No code enforces")))));
  check("Visual review: taste-gate points back to its caller", (contains(tg, "`SKILL.md`, Phase 5, invokes it")));
  check("Source: NOTICE mapping table includes visual-review delivery contract", (truth((contains(notice, "| Delivery visual-review contract |"))) && truth((contains(notice, "delivery-contract.md")))));
  check("Source: NOTICE archify import scope includes four areas", (truth((contains(notice, "Four areas were imported"))) && truth((contains(notice, "visual-review contract")))), "a stale scope count would leave the new import outside provenance");
  for (flag of iterable(["--json", "--baseline", "--strict-deletion"])) {
    check(("Envelope: SKILL.md invokes `" + String(flag) + "`"), (contains(skill, flag)), "a suite-only flag is effectively disabled in use");
  }
  check("Envelope: SKILL.md documents envelope fields", (truth((contains(skill, "schemaVersion"))) && truth((contains(skill, "supportedFixes")))));
  check("Envelope: SKILL.md documents two-run baseline workflow", (truth((contains(skill, "before.json"))) && truth((count(skill, "before.json") >= 2))), "one run leaves the deletion guard inactive");
  check("Envelope: SKILL.md says deletion is warning by default and strict only with flag", (truth((contains(skill, "repair/deletion-without-evidence"))) && truth((contains(skill, "By default this is a warning"))) && truth((contains(skill, "use `--strict-deletion`")))));
  function run(rel: any, ...argv: any[]): any {
    let r: any;
    r = subprocessRun([python, join(ROOT, rel), ...argv], {capture_output:true, text:true, cwd:ROOT});
    try {
      return [JSON.parse(String(r.stdout)), r];
    } catch (__error: any) {
      return [null, r];
    }
  }
  [ml_p, ml_r] = run("scripts/measure_label.js", "--json", "가나다라마바사아자차카타파하", "abcdefghijklmn");
  ml = Object.fromEntries(Array.from(iterable((pyOr(ml_p, {})["measurements"] ?? []))).map((m: any) => [m["text"], m]));
  ko = (ml["가나다라마바사아자차카타파하"] ?? {});
  la = (ml["abcdefghijklmn"] ?? {});
  check("Label: 14 Korean characters measure 14em", (truth((equal((ko["em"] ?? null), 14.0))) && truth((equal((ko["chars"] ?? null), 14)))), String((ko["em"] ?? null)));
  check("Label: same 14 Latin characters measure under 8em (7.7em)", (truth((equal((la["chars"] ?? null), 14))) && truth((equal((la["em"] ?? null), 7.7)))), String((la["em"] ?? null)));
  check("Label: value within 14em cap returns rc 0", (truth((equal(ml_r.returncode, 0))) && truth(((pyOr(ml_p, {})["ok"] ?? null) === true))), String(ml_r.returncode));
  [sp_p, _sp_r] = run("scripts/measure_label.js", "--json", "가 나");
  sp = (pyOr(sp_p, {})["measurements"] ?? [{}])[0];
  check("Label: whitespace counts as 0.25em (`가 나` = 2.25em)", (equal((sp["em"] ?? null), 2.25)), String((sp["em"] ?? null)));
  [over_p, over_r] = run("scripts/measure_label.js", "--json", "--cap", "10", "가나다라마바사아자차카타파하");
  check("Label: exceeding cap returns rc 1 with label/em-cap", (truth((equal(over_r.returncode, 1))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(over_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["label/em-cap"])))), String(over_r.returncode));
  [a4_p, a4_r] = run("scripts/export_scale.js", "--json", "--viewbox-width", "1120", "--target-width", "4480", "--paper", "a4");
  check("Scale: 4x A4 export is within clamp", (truth((equal(a4_r.returncode, 0))) && truth((equal(((pyOr(a4_p, {})["result"] ?? {})["verdict"] ?? null), "within-clamp"))) && truth((equal(((pyOr(a4_p, {})["result"] ?? {})["scale"] ?? null), 4.0)))), String((pyOr(a4_p, {})["summary"] ?? null)));
  [a3_p, a3_r] = run("scripts/export_scale.js", "--json", "--viewbox-width", "1120", "--paper", "a3", "--dpi", "300");
  a3 = (pyOr(a3_p, {})["result"] ?? {});
  check("Scale: A3 at 300dpi needs 4.43 and is allowed by exception", (truth((equal(a3_r.returncode, 0))) && truth((Math.abs(subtract((a3["scale"] ?? 0), 4.4291)) < 0.001)) && truth((equal((a3["verdict"] ?? null), "unlocked"))) && truth((Math.abs(subtract((a3["effectiveDpi"] ?? 0), 300)) < 0.5))), add(add(String((a3["scale"] ?? null)), " "), String((a3["verdict"] ?? null))));
  check("Scale: exception-unlocked scale requires outlined fonts", (truth(((a3["requiresOutlinedFonts"] ?? null) === true)) && truth((contains((a3["message"] ?? ""), "outline the fonts")))), String((a3["requiresOutlinedFonts"] ?? null)));
  [bad_p, bad_r] = run("scripts/export_scale.js", "--json", "--viewbox-width", "1120", "--target-width", "4961", "--paper", "a4");
  check("Scale: same 4.43 fails for A4 (exception does not leak)", (truth((equal(bad_r.returncode, 1))) && truth((equal(((pyOr(bad_p, {})["result"] ?? {})["verdict"] ?? null), "above-clamp")))), String((pyOr(bad_p, {})["summary"] ?? null)));
  [nv_p, nv_r] = run("scripts/export_scale.js", "--json", "--no-vector", "--viewbox-width", "1120", "--target-width", "4961", "--paper", "a4");
  check("Scale: unavailable vector delivery also lifts upper bound", (truth((equal(nv_r.returncode, 0))) && truth((equal(((pyOr(nv_p, {})["result"] ?? {})["verdict"] ?? null), "unlocked")))), String((pyOr(nv_p, {})["summary"] ?? null)));
  td = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
  try {
    function es(px: any, ...argv: any[]): any {
      let f: any, fp: any;
      fp = join(td, ("es" + String(px) + ".svg"));
      {
        f = openFile(fp, "w", {encoding:"utf-8"});
        try {
          f.write(("<svg viewBox=\"0 0 1120 792\"><text x=\"10\" y=\"10\" font-size=\"" + String(px) + "\">한글 라벨</text></svg>\n"));
        } finally { f.close(); }
      }
      return run("scripts/check_effective_size.js", fp, "--json", ...argv);
    }
    [p9, r9] = es(9);
    d9 = pyOr((pyOr(p9, {})["diagnostics"] ?? null), [{}])[0];
    check("Effective size: 9px on print-a4 is 6.77pt, below 10pt floor", (truth((equal(r9.returncode, 1))) && truth((equal((d9["code"] ?? null), "text/effective-size"))) && truth((Math.abs(subtract(((d9["evidence"] ?? {})["pt"] ?? 0), 6.7653)) < 0.001))), String(((d9["evidence"] ?? {})["pt"] ?? null)));
    [p12, r12] = es(12);
    d12 = pyOr((pyOr(p12, {})["diagnostics"] ?? null), [{}])[0];
    check("Effective size: output-spec 12px floor is still 9.02pt on A4", (truth((equal(r12.returncode, 1))) && truth((Math.abs(subtract(((d12["evidence"] ?? {})["pt"] ?? 0), 9.0204)) < 0.001))), String(((d12["evidence"] ?? {})["pt"] ?? null)));
    [p14, r14] = es(14);
    check("Effective size: 14px passes at 10.5pt (floor is not constant)", (truth((equal(r14.returncode, 0))) && truth((equal((pyOr(p14, {})["diagnostics"] ?? null), [])))), String(((pyOr(p14, {})["summary"] ?? {})["perFile"] ?? null)));
    [ph, rh] = es(14, "--hwp-fraction", "0.65");
    check("Effective size: 14px fails when placed at 65% HWP width", (truth((equal(rh.returncode, 1))) && truth((equal(((pyOr(ph, {})["summary"] ?? {})["fraction"] ?? null), 0.65)))), String(((pyOr(ph, {})["summary"] ?? {})["fraction"] ?? null)));
    nf = join(td, "nofs.svg");
    {
      f = openFile(nf, "w", {encoding:"utf-8"});
      try {
        f.write("<svg viewBox=\"0 0 1120 792\"><text x=\"10\" y=\"10\">한글</text></svg>\n");
      } finally { f.close(); }
    }
    [pn, _rn] = run("scripts/check_effective_size.js", nf, "--json");
    check("Effective size: unreadable font-size emits diagnostic instead of default", (equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(pn, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["text/unmeasurable", "input/no-measurable-text"])), String((() => { const __items: any[] = []; for (const d of iterable((pyOr(pn, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })()));
    _osp = openFile(join(ROOT, "references", "output-spec.md"), {encoding:"utf-8"}).read();
    check("Font: output-spec example contains exact Korean stack", (contains(_osp, KO_STACK)));
    dw = join(td, "d.drawio");
    xml = "<mxfile><diagram>인증 서비스 &amp; 게이트웨이</diagram></mxfile>";
    {
      f = openFile(dw, "w", {encoding:"utf-8"});
      try {
        f.write(xml);
      } finally { f.close(); }
    }
    _gd = mkdtempSync(join(tmpdir(), "jstack-diagram-"));
    try {
      _gp = join(_gd, "golden.drawio");
      openFile(_gp, "w", {encoding:"utf-8"}).write("<mxfile><diagram id=\"x\">가나다 label</diagram></mxfile>");
      _gr = run("scripts/encode_drawio_url.js", _gp);
      _gtxt = (truth(Array.isArray(_gr)) ? _gr[1] : _gr);
      _gtxt = (_gtxt?.["stdout"] ?? _gtxt);
      _glines = splitLines(String(_gtxt).trim(), false);
      _gout = (truth(_glines) ? _glines.at(-1)! : "");
      const golden = "https://viewer.diagrams.net/#RPYyxDoAgEEO%2FpvvlzgFHwPM%2FMKAhgcWJz%2Fck0aFJm7YPEvs4aysQhcRc03WnDqaaIRuYh%2Bnt1CMQHEEDHGN10wT4xcYtHaXZHbx%2FhImz%2FNMf";
      const unpack = (value:string) => decodeURIComponent(inflateRawSync(Buffer.from(decodeURIComponent(value.split('#R')[1]), 'base64')).toString('utf8'));
      let compatible = false;
      try { compatible = _gout.startsWith('https://viewer.diagrams.net/#R') && unpack(_gout) === read(_gp) && unpack(golden) === read(_gp); } catch { /* invalid output must fail, including deletion mutations */ }
      check("Encode: generated and historical URL independently decode to the same Korean XML", compatible, _gout.slice(0, 60));
    } finally {
      rmSync(_gd, {recursive:true,force:true});
    }
    [ep, er] = run("scripts/encode_drawio_url.js", dw, "--json");
    url = (pyOr(ep, {})["url"] ?? "");
    check("draw.io: CJK diagram encodes into viewer fragment URL and round-trips", (truth((equal(er.returncode, 0))) && truth(((pyOr(ep, {})["ok"] ?? null) === true)) && truth(starts(url, "https://viewer.diagrams.net/#R"))), url.slice(0, 60));
    rt = subprocessRun([python, join(ROOT, "scripts", "encode_drawio_url.js"), "--decode", url], {capture_output:true, text:true, cwd:ROOT});
    check("draw.io: decode returns original XML exactly", (truth((equal(rt.returncode, 0))) && truth((equal(rt.stdout.trim(), xml)))), rt.stdout.trim().slice(0, 60));
    function _chunk(type:Buffer,payload:Buffer):Buffer{const out=Buffer.alloc(payload.length+12);out.writeUInt32BE(payload.length);type.copy(out,4);payload.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,payload])),8+payload.length);return out;}
    png = add(add(add(Buffer.from("89504e470d0a1a0a", "hex"), _chunk(Buffer.from("49484452", "hex"), pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))), _chunk(Buffer.from("49444154", "hex"), deflateSync(Buffer.from("00ffffff", "hex")))), _chunk(Buffer.from("49454e44", "hex"), Buffer.from("", "hex")));
    tr = join(td, "trunc.png");
    {
      f = openFile(tr, "wb");
      try {
        f.write(png.slice(0, -12));
      } finally { f.close(); }
    }
    [cp, cr] = run("scripts/repair_png.js", tr, "--check", "--json");
    check("PNG: truncated IEND is invalid (rc 1)", (truth((equal(cr.returncode, 1))) && truth((((pyOr(cp, {})["summary"] ?? {})["hasIend"] ?? null) === false))), String(((pyOr(cp, {})["summary"] ?? {})["hasIend"] ?? null)));
    fx = join(td, "fixed.png");
    [fp_, fr] = run("scripts/repair_png.js", tr, "--dpi", "300", "-o", fx, "--json");
    after = ((pyOr(fp_, {})["summary"] ?? {})["after"] ?? {});
    check("PNG: repair appends IEND and writes 300dpi pHYs", (truth((equal(fr.returncode, 0))) && truth(((after["hasIend"] ?? null) === true)) && truth((Math.abs(subtract(pyOr((after["dpi"] ?? null), 0), 300)) < 1))), String((after["dpi"] ?? null)));
    [gp, gr] = run("scripts/repair_png.js", fx, "--check", "--json");
    check("PNG: repaired file remains clean on recheck", (truth((equal(gr.returncode, 0))) && truth(((pyOr(gp, {})["ok"] ?? null) === true))), String(((pyOr(gp, {})["summary"] ?? {})["badCrc"] ?? null)));
    [sf_p, _sf_r] = run("scripts/subset_fonts.py", "--probe", "--json");
    tool = ((pyOr(sf_p, {})["summary"] ?? {})["tool"] ?? {});
    check("Font: probe reports fontTools pin 4.53.1 and installed version", (truth((equal((tool["pinned"] ?? null), "4.53.1"))) && truth((contains(tool, "available"))) && truth((contains(tool, "version")))), String(tool));
    check("Font: envelope carries both fail-closed policies", (equal(((pyOr(sf_p, {})["summary"] ?? {})["policy"] ?? null), {["on_tool_missing"]: "stop", ["on_glyph_missing"]: "stop"})), String(((pyOr(sf_p, {})["summary"] ?? {})["policy"] ?? null)));
    [al_p, al_r] = run("scripts/subset_fonts.py", "--json", "--allow-version-drift", "--font", join(td, "nope.ttf"), "--out", join(td, "out.ttf"), "--text", "abc");
    check("Font: subset requires alias under OFL RFN", (truth((equal(al_r.returncode, 1))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(al_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["license/alias-required"])))), String((() => { const __items: any[] = []; for (const d of iterable((pyOr(al_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })()));
    [nf_p, nf_r] = run("scripts/subset_fonts.py", "--json", "--allow-version-drift", "--alias", "jstack Sans KR", "--font", join(td, "nope.ttf"), "--out", join(td, "out.ttf"), "--text", "abc");
    check("Font: missing font emits input/read without traceback", (truth((equal(nf_r.returncode, 1))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((pyOr(nf_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["input/read"]))) && truth((!contains(nf_r.stderr, "Traceback")))), nf_r.stderr.trim().slice(-60));
  } finally { rmSync(td,{recursive:true,force:true}); }
  cjk = subprocessRun([python, join(ROOT, "tests", "test_cjk_contract.js")], {capture_output:true, text:true, cwd:ROOT});
  check("CJK: tests/test_cjk_contract.js passes", (equal(cjk.returncode, 0)), (truth(pyOr(cjk.stdout, cjk.stderr)) ? splitLines(pyOr(cjk.stdout, cjk.stderr).trim(), false).at(-1)!.slice(0, 100) : "no output"));
  n_cjk = length(regexFindall("(?m)^\\[(?:PASS|FAIL)\\]", cjk.stdout));
  check("CJK: suite measures 13 results", (equal(n_cjk, 13)), (String(n_cjk) + " results"));
  check_ref_contracts(check, ROOT, [["upstream-integration.md", "context, parser execution, source fidelity, accessibility and Office export", ["procurement", "explanatory", "drawio_extract.py", "mermaid_extract.py", "excalidraw_extract.py", "untrusted data", "fidelity ledger", "role=\"img\"", "rgba(r,g,b,a)", "10pt"], 5700], ["type-catalog.md", "type selection and quantitative ownership boundary", ["40-type", "dataviz", "type-it-state.md", "type-db-schema.md", "template.html"], 6500], ["type-placement.md", "five-type placement grammar", ["left-to-right spine", "happy path", "actual transition", "Lane", "participant", "Stage", "Local adaptations"], 4122], ["connector-rules.md", "all six connector rules and validator path", ["automatically fail", "6–10px", "bridge/hop", "L * k / (N + 1)", "stroke-dasharray", "verify-geometry.js", "schemaVersion", "supportedFixes", "requiresEvidence", "connector/diagonal", "Collinear", "Drawing a rounded", "sibling exemption", "--no-crossings"], 14205], ["output-spec.md", "three dials and Korean font contract", ["Apple SD Gothic Neo", "Noto Sans Mono CJK KR", "One full-width character equals 1em", "12px", "grayscale printing", "## Procurement complexity budget", "## Grayscale legibility replaces the two-accent limit", "### Legend placement"], 9461], ["export.md", "scale formula and 1–4 clamp", ["target_width / viewBox_width", "device_scale_factor", "Below 1", "Above 4"], 1780], ["cjk-contract.md", "21 medium-specific CJK requirements with evaluators", ["90% character width", "Evaluator", "Medium-specific CJK contract", "encodeURIComponent", "Noto Sans KR", "effective pt"], 5292], ["font-delivery.md", "identity SSoT, delivery tiers, OFL RFN, and tool pin", ["environment-dependent", "Reserved Font Name", "identity_rewrite", "on_glyph_missing", "4.53.1"], 3115], ["taste-gate.md", "omission, signal, six-rule checks, and delivery visual review", ["## Omission test", "Does the diagram omit any RFP requirement?", "at most two", "automatically fail", "without reusing the Japanese stack", "Visual review at delivery", "visual_review: pending"], 6045]]);
  live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) { if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"]))))) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
  ev = join(dirname(dirname(ROOT)), "evals", "discriminating", "diagram-connector-rules", "graders", "criteria.md");
  check("eval: discriminating-case criteria exist", isFile(ev));
  if (truth(isFile(ev))) {
    crit = openFile(ev, {encoding:"utf-8"}).read();
    rules = openFile(join(ROOT, "references", "connector-rules.md"), {encoding:"utf-8"}).read();
    nums = regexFindall("(?m)^## (?:(?:Rule )?([0-6]))[.:\\s]", rules);
    check("eval: live rules contain all seven rules 0–6", (equal(sorted(new Set(iterable(nums))), Array.from("0123456"))), (String(sorted(new Set(iterable(nums))))));
    check("eval: criteria and live Rule 0 both require arrows before boxes", (truth((contains(crit, "Draw arrows before boxes"))) && truth((contains(rules, "draw arrows before boxes")))));
    check("eval: criteria clearance matches the live rule", (truth((contains(crit, "6~10px"))) && truth((contains(rules, "6–10px")))));
  }
  check_no_constant_assertions(check, __file__);
  check_contract_coverage(check, __file__, ROOT, {per_file: {["references/upstream-integration.md"]: 3, ["references/type-catalog.md"]: 4, ["SKILL.md"]: 74, ["NOTICE"]: 9, ["LICENSE.upstream"]: 1, ["UPSTREAM.sha256"]: 8, ["LICENSE.archify"]: 2, ["references/type-placement.md"]: 4, ["references/connector-rules.md"]: 30, ["references/output-spec.md"]: 27, ["references/export.md"]: 3, ["references/taste-gate.md"]: 30, ["references/cjk-contract.md"]: 5, ["references/font-delivery.md"]: 3}, live_ran: live_ran});
  check_body_deletion(check, __file__, ROOT, {minimum: 96, extra_strip: ["references/output-spec.md"], live_ran: live_ran});
  check_script_contracts(check, __file__, ROOT, {scripts: SCRIPT_FLOORS, live_ran: live_ran});
  check_total(check, results, add(TOTAL_BASE, (truth(_tracked(tp_path)) ? 1 : 0)));
  passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
  console.log(("\n" + String(passed) + "/" + String(length(results)) + " 통과"));
  return (truth((equal(passed, length(results)))) ? 0 : 1);
}

if(isMain(import.meta.url))process.exitCode=main();
