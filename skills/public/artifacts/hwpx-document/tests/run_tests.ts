#!/usr/bin/env node
/** Owning skill contracts. Individual assertions and measured deletion floors are preserved. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep, basename, extname} from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isMain } from '../../../../../runtime/entry.js';
import { in_deleted_run, skipped_names, section, check_script_contracts, check_body_deletion, check_contract_coverage, check_no_constant_assertions, check_total,
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
function contains(haystack: any, needle: any): boolean { return Buffer.isBuffer(haystack) ? haystack.includes(needle) : typeof haystack === 'string' ? haystack.includes(needle) : [...iterable(haystack)].some((value: any) => equal(value, needle)); }
function starts(text: string, prefixes: string | string[]): boolean { return typeof prefixes === 'string' ? text.startsWith(prefixes) : prefixes.some(prefix => text.startsWith(prefix)); }
function sorted(value: any): any[] { return [...iterable(value)].sort((a: any, b: any) => pyStr(a) < pyStr(b) ? -1 : pyStr(a) > pyStr(b) ? 1 : 0); }
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

import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {specialistStatus} from '../../../../../runtime/specialists.js';
import {PythonBackend,XmlNode,etree} from './_backend.js';
import {Path,PyPath,pathJoin,joinPaths as join,zipfile,openFile} from './_suite-support.js';
let python='';
try{const environment=specialistStatus('hwpx',{home:process.env.JSTACK_SPECIALIST_HOME,root:dirname(SKILLS)});if(environment.state==='ready')python=environment.python;}catch{}
const backend=new PythonBackend(python,join(ROOT,'scripts'));
const _MARK_PATH=process.env.HWPX_SUITE_CHILD_MARK;delete process.env.HWPX_SUITE_CHILD_MARK;
function subprocessRun(args:any[],opts:any={}):any{const argv=args.map(String);if(argv[1]?.endsWith('.js'))argv[0]=process.execPath;const r=spawnSync(argv[0]||'__missing_optional_python__',argv.slice(1),{encoding:'utf8',input:opts.input,env:opts.env??{...process.env,PYTHONDONTWRITEBYTECODE:'1'},cwd:opts.cwd,maxBuffer:32*1024*1024});return {returncode:r.status??2,stdout:r.stdout??'',stderr:r.stderr??pyStr(r.error??'')};}
function stripChars(text:string,chars:string):string{let a=0,b=text.length;while(a<b&&chars.includes(text[a]))a++;while(b>a&&chars.includes(text[b-1]))b--;return text.slice(a,b);}
function pyStr(value:any):string{if(value===undefined)throw new ReferenceError('Dependent fixture has not been produced');return String(value);}
function pyOr(...values:any[]):any{return values.find(truth)??values.at(-1);}
function add(a:any,b:any):any{return Buffer.isBuffer(a)&&Buffer.isBuffer(b)?Buffer.concat([a,b]):Array.isArray(a)&&Array.isArray(b)?[...a,...b]:a+b;}
function multiply(a:any,b:number):any{return Buffer.isBuffer(a)?Buffer.concat(Array.from({length:b},()=>a)):typeof a==='string'?a.repeat(b):a*b;}
function popKey(obj:any,key:string):any{const old=obj[key];delete obj[key];return old;}
function subsetOrCompare(a:any,b:any):boolean{return a instanceof Set&&b instanceof Set?[...a].every(v=>b.has(v)):a<=b;}
function escapeRegex(text:string):string{return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const SCRIPTS = join(ROOT, "scripts");
const FIXTURE = join(ROOT, "assets", "fixtures", "minimal.md");
const BASE = pathJoin(pathJoin(Path(ROOT), "templates"), "base");
const _REEXEC = "HWPX_SUITE_LXML_VIA_UV";
const _MARK = "HWPX_SUITE_CHILD_MARK";
const _FORCE_NO_LXML = "HWPX_SUITE_FORCE_NO_LXML";
const TOTAL_EXPECTED = 213;
const TOTAL_NAME = ("자기검사: 검사 총수가 " + pyStr(TOTAL_EXPECTED) + " 건이다");

function _write_child_mark(rc:number):void{if(!_MARK_PATH)return;try{writeFileSync(_MARK_PATH,`${results.length} ${rc}\n`);}catch{}}

function _read_child_mark(path:string):[number,number]|null{try{const parts=readFileSync(path,'utf8').trim().split(/\s+/);if(parts.length!==2||parts.some(v=>!/^[-+]?\d+$/.test(v)))return null;return [Number(parts[0]),Number(parts[1])];}catch{return null;}}

function _runner_for(_provider:unknown):null{return null;}

function _lxml_provider():[string|null,string]{if(process.env[_FORCE_NO_LXML])return [null,'fallback path forced by self-check'];if(!python)return [null,'Manifest-locked optional hwpx environment is absent'];const r=spawnSync(python,['-c','import lxml; print(lxml.__file__)'],{encoding:'utf8'});return r.status===0?['uv-child',r.stdout.trim()]:[null,'lxml import failed in the optional environment'];}
const SKIPPED_AXES = ["delta: reference preview does not leak into the output", "delta: preview is replaced with the neutral image", "delta: all three zip-slip path forms are blocked", "delta: safe entries pass", "delta: clear_linesegarrays removes caches", "delta: a targeted paragraph mutation preserves untouched paragraph caches", "delta: the surviving cache belongs to the second paragraph", "delta: the rewrite path actually clears caches (caller binding)", "delta: the template list is static", "core: Markdown parsing produces blocks", "core: tables, lists, and paragraphs are all recognized", "core: output contains required entries", "core: mimetype is the first entry", "core: mimetype is uncompressed (ZIP_STORED)", "core: preview text reflects the document body", "baseline: block structure matches the frozen copy", "validate_hwpx: valid output has no errors", "validate_hwpx: a missing required entry is detected (live assertion)", "validate_hwpx: a missing file is an error", "validate_hwpx: the required-entry list is nonempty", "validate_hwpx: the required-entry list matches the canonical order", "validate_hwpx: the required-entry probe covers the complete list", "validate_hwpx: a missing mimetype is detected", "validate_hwpx: a missing Contents/content.hpf is detected", "validate_hwpx: a missing Contents/header.xml is detected", "validate_hwpx: a missing Contents/section0.xml is detected", "validate_hwpx: EXPECTED_MIMETYPE is the canonical OPC value", "validate_hwpx: an incorrect mimetype value is detected", "validate_hwpx: the required secPr child names match the canonical set", "validate_hwpx: required secPr children cover all eight concrete types", "validate_hwpx: valid output has no secPr child defects", "validate_hwpx: the base probe starts with a complete secPr", "validate_hwpx: removing pagePr from secPr is detected", "validate_hwpx: a missing margin inside pagePr is detected separately", "validate_hwpx: that defect is classified as document/structure", "diagnostics: --json output is one valid JSON value", "diagnostics: envelope has schemaVersion 1 and identifies its source", "diagnostics: valid output has ok=true and no diagnostics", "diagnostics: missing required entry becomes package/missing-file", "diagnostics: severity is error", "diagnostics: diagnostic count equals validate() result count (no swallowing)", "diagnostics: the injected IDRef mutation changes the file", "diagnostics: injected undefined IDRef is classified as reference/undefined", "diagnostics: evidence structures idref instead of raw text", "diagnostics: five repair stages appear in relocate-to-delete order", "diagnostics: only deletion requires evidence (requiresEvidence)", "diagnostics: package defects omit the five stages (no false guidance)", "diagnostics: steering paragraph was actually injected", "diagnostics: paragraph text cannot steer the code (F1)", "diagnostics: body text cannot fabricate reference evidence (F1)", "diagnostics: a missing file becomes input/read", "diagnostics: VALID line remains unchanged without --json", "diagnostics: human-readable output does not mix in JSON", "text_extract: extracted output agrees with body-text presence", "text_extract: a missing file is an error", "rekian_xml: parses XML from a path and returns a tree", "office/unpack: extracts hwpx into a directory (rc=0)", "office/unpack: unpacking and repacking preserves entries", "analyze_template: base template header.xml exists", "analyze_template: reads actual font definitions from the base template", "batch_convert: strips numeric prefixes and changes underscores to spaces", "batch_convert: converter path points inside this skill", "스크립트 계약: hooks/hwpx_guard.js", "스크립트 계약: scripts/analyze_template.py", "스크립트 계약: scripts/batch_convert.py", "스크립트 계약: scripts/build_hwpx.py", "스크립트 계약: scripts/fix_borders.py", "스크립트 계약: scripts/hwpx_zip.py", "스크립트 계약: scripts/md_to_hwpx.py", "스크립트 계약: scripts/office/pack.py", "스크립트 계약: scripts/office/unpack.py", "스크립트 계약: scripts/rekian_xml.py", "스크립트 계약: scripts/sanitize_template.py", "스크립트 계약: scripts/text_extract.py", "스크립트 계약: scripts/validate_hwpx.py", "계약 커버리지: 선언 목록이 실제 파일과 일치한다", "계약 커버리지: NOTICE", "계약 커버리지: LICENSE.kordoc", "계약 커버리지: SKILL.md", "계약 커버리지: agents/openai.yaml", "계약 커버리지: references/com-windows-guide.md", "계약 커버리지: references/example-flow.md", "계약 커버리지: references/hangul-practice.md", "계약 커버리지: references/hitl-review.md", "계약 커버리지: references/hwpx-format.md", "계약 커버리지: references/kordoc-public-doc.md", "계약 커버리지: references/markdown-proposal-rules.md", "계약 커버리지: references/render-checklist.md", "계약 커버리지: references/style-intake.md", "계약 커버리지: references/troubleshooting.md", "계약 커버리지: references/validation-rules.md", "계약 커버리지: references/workflows.md", "계약 커버리지: references/xml-structure.md", "계약 커버리지: scripts/ensure_hwpx.js", "자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)", "자기검사: 사본에서 검사가 소멸하지 않았다", "자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다"];
const _LIVE_SKIPPED = Array.from((() => { const __items: any[] = []; for (const n of iterable(SKIPPED_AXES)) { if (!truth((!truth(starts(n, ["자기검사:", "계약 커버리지:", "스크립트 계약:"]))))) continue; __items.push(n); } return __items; })());
const _SECTION_PREFIXES = ["delta:", "core:", "baseline:", "validate_hwpx:", "diagnostics:", "text_extract:", "rekian_xml:", "office/unpack:", "analyze_template:", "batch_convert:"];

function _axes(...prefixes: any[]): any {
  let n: any;
  return Array.from((() => { const __items: any[] = []; for (const n of iterable(_LIVE_SKIPPED)) { if (!truth(starts(n, prefixes))) continue; __items.push(n); } return __items; })());
}

function _run_py(script:string,...args:any[]):any{return subprocessRun([python,script,...args.map(String)]);}

function _run_hook(hook:string,payload:unknown,opts:{raw?:string}={}):any{return subprocessRun([process.execPath,hook],{input:opts.raw??JSON.stringify(payload)});}
const _NEUTRAL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
const _HH = "{http://www.hancom.co.kr/hwpml/2011/head}";

function _make_probe(path:PyPath,opts:{neutral_preview:boolean,box_every_char?:boolean,drop_header?:boolean,mimetype_last?:boolean}):string{
 const entries:Record<string,Buffer>={};for(const src of BASE.rglob('*'))if(src.is_file()&&src.name!=='mimetype')entries[src.relative_to(BASE).as_posix()]=src.read_bytes();
 if(opts.neutral_preview)entries['Preview/PrvImage.png']=_NEUTRAL_PNG;
 if(opts.box_every_char){const root=XmlNode.parse(entries['Contents/header.xml']);for(const bf of root.iter(_HH+'borderFill'))if(bf.get('id')==='2')for(const side of ['leftBorder','rightBorder','topBorder','bottomBorder']){const el=bf.find(_HH+side);if(el)el.set('type','SOLID');}entries['Contents/header.xml']=etree.tostring(root);}
 if(opts.drop_header)delete entries['Contents/header.xml'];const z=zipfile.ZipFile(path,'w');if(!opts.mimetype_last)z.writestr(zipfile.ZipInfo('mimetype'),'application/hwp+zip',{compress_type:zipfile.ZIP_STORED});for(const[name,data]of Object.entries(entries))z.writestr(name,data);if(opts.mimetype_last)z.writestr(zipfile.ZipInfo('mimetype'),'application/hwp+zip',{compress_type:zipfile.ZIP_STORED});z.close();return pyStr(path);
}

function make_reference(tmp: any, preview: any): any {
  let ref: any, rel: any, src: any, z: any;
  ref = pathJoin(tmp, "reference.hwpx");
  {
    z = zipfile.ZipFile(ref, "w");
    try {
      z.writestr("mimetype", "application/hwp+zip");
      for (rel of iterable(["Contents/header.xml", "Contents/section0.xml", "Contents/content.hpf", "META-INF/container.xml", "settings.xml", "version.xml", "Preview/PrvText.txt"])) {
        src = pathJoin(BASE, rel);
        z.writestr(rel, (truth(src.exists()) ? src.read_bytes() : Buffer.from("3c782f3e", "hex")));
      }
      z.writestr("Preview/PrvImage.png", preview);
    } finally { z.close(); }
  }
  return ref;
}

function main(): any {
  let AGENT: any, ENSURE: any, MD2HWPX_FLAGS: any, PACK: any, PAGEBREAK_ROWS: any, REF_CONTRACTS: any, REQUIRED_CANON: any, SECPR_CANON: any, SECRET: any, VAL: any, _: any, _absent: any, _after: any, _agent: any, _axis: any, _base_errs: any, _boxed: any, _clean: any, _cmds: any, _dead: any, _dirty: any, _e: any, _errs: any, _f: any, _face: any, _fb: any, _fb_lines: any, _fb_skips: any, _fmt: any, _fmt2: any, _fr: any, _full: any, _hangul_block: any, _hdr_txt: any, _help: any, _hook: any, _hp: any, _hz: any, _info: any, _inj_r: any, _label: any, _left: any, _left3: any, _lost: any, _m: any, _m2h_src: any, _mi: any, _mime_last: any, _missing: any, _mt_errs: any, _mt_probe: any, _needle: any, _no_header: any, _out: any, _paths: any, _pd: any, _probe_dir: any, _r: any, _raw: any, _rb: any, _rc: any, _req: any, _req_base: any, _req_names: any, _rows: any, _rp: any, _sd: any, _sec: any, _secpr_base: any, _self_name: any, _sp: any, _src: any, _st: any, _stale: any, _still_boxed: any, _text_extract: any, _ud: any, _uncovered: any, _undoc: any, _unimpl: any, _wf: any, _wi: any, analyze_template: any, b: any, bad_p: any, bad_r: any, bad_sec: any, base_sec: any, batch_convert: any, blocked: any, blocks: any, broken: any, broken_path: any, build_hwpx: any, c: any, codes: any, crit: any, d: any, d0: any, detail: any, e: any, el: any, errs_bad: any, errs_ok: any, ev: any, evil: any, f: any, fabricated: any, fixes: any, fmt: any, fonts: any, gold: any, got: any, h: any, has_text: any, hdr: any, hroot: any, i: any, inj_ds: any, inj_p: any, inj_path: any, inj_sec: any, inside: any, it: any, kinds: any, label: any, left: any, left2: any, live_ran: any, ln: any, m: any, md_to_hwpx: any, miss: any, n: any, n2: any, names: any, needle: any, neutral: any, nf_p: any, nf_r: any, office_unpack: any, ok: any, ok_p: any, ok_r: any, ord_ds: any, out: any, out2: any, outdir: any, paras: any, passed: any, payload: any, probe: any, provider: any, prv: any, r: any, ref: any, ref2: any, rekian_xml: any, rel: any, root: any, root2: any, sec: any, sec_xml: any, sem_ds: any, sem_p: any, sem_path: any, sem_r: any, shape: any, skill: any, skill_fm: any, src: any, steps: any, tmp: any, tmpl: any, token: any, tree: any, tx: any, validate_hwpx: any, want: any, why: any, x: any, xml: any, xml_path: any, z: any, zin: any, zout: any;
  [provider, detail] = _lxml_provider();
  tmp = Path(mkdtempSync(join(tmpdir(), "jstack-hwpx-")));
  process.on("exit",()=>rmSync(pyStr(tmp),{recursive:true,force:true}));
  {
    _f = openFile(join(ROOT, "SKILL.md"), {encoding:"utf-8"});
    try {
      _raw = _f.read();
    } finally { _f.close(); }
  }
  [skill_fm, skill] = split_frontmatter(_raw);
  steps = regexFindall("(?m)^\\d+\\. ", split(skill, "## Commands")[0]);
  check("SKILL.md: Workflow section contains steps", (length(steps) >= 3), (pyStr(length(steps)) + " steps"));
  _paths = new Set(iterable(regexFindall("\\$\\{CLAUDE_PLUGIN_ROOT\\}/skills/hwpx/([\\w./-]+)", skill)));
  _paths = union(_paths, new Set((() => { const __items: any[] = []; for (const m of iterable(regexFindall("\\$env:CLAUDE_PLUGIN_ROOT\\\\skills\\\\hwpx\\\\([\\w.\\\\-]+)", skill))) { __items.push(m.replaceAll("\\", "/")); } return __items; })()));
  _paths = union(_paths, new Set((() => { const __items: any[] = []; for (const m of iterable(regexFindall("\\$Skill\\\\([\\w.\\\\-]+)", skill))) { __items.push(m.replaceAll("\\", "/")); } return __items; })()));
  for (_m of iterable([...skill.matchAll(regex("`((?:scripts|references|hooks|templates|assets|agents)/[\\w./-]+)`", "g"))])) {
    if (truth((contains(skill.slice(Math.max(0, subtract(_m.index, 40)), _m.index), "plugin root")))) {
      continue;
    }
    _paths.add(_m[1]);
  }
  check("SKILL.md reference existence: population is nonempty (zero iterations do not pass)", (length(_paths) >= 25), (pyStr(length(_paths)) + " entries"));
  _dead = sorted((() => { const __items: any[] = []; for (const rel of iterable(_paths)) { if (!truth((!truth(existsSync(join(ROOT, rel)))))) continue; __items.push(rel); } return __items; })());
  check("SKILL.md reference existence: every referenced path exists", (!truth(_dead)), (truth(_dead) ? ("missing " + pyStr(_dead)) : (pyStr(length(_paths)) + " entries")));
  for ([label, needle] of iterable([["validation procedure", "validate_hwpx.py"], ["HITL gate: no approval before opening", "hitl-review.md"], ["reference-style reuse design", "reference"], ["Windows COM path for .hwp", "COM"], ["structural trap: attributes versus children", "references/xml-structure.md"], ["boundary before human handoff", "references/render-checklist.md"], ["handoff gate inspects at delivery time", "hooks/hwpx_guard.js"]])) {
    check(("SKILL.md contract: " + pyStr(label)), (contains(skill, needle)));
  }
  check("SKILL.md: does not install dependencies on the user's behalf", (contains(skill, "Users install dependencies")));
  check_skill_body(check, ROOT, {needles: ["md_to_hwpx.py", "references/hitl-review.md", "references/troubleshooting.md", "`.hwpx` remains available", "references/xml-structure.md", "scripts/fix_borders.py"], floor: 3818});
  ev = join(dirname(dirname(ROOT)), "evals", "discriminating", "hwpx-format-units", "graders", "criteria.md");
  check("eval: discriminating-case criteria exist", isFile(ev));
  if (truth(isFile(ev))) {
    crit = openFile(ev, {encoding:"utf-8"}).read();
    fmt = openFile(join(ROOT, "references", "hwpx-format.md"), {encoding:"utf-8"}).read();
    for ([token, why] of iterable([["1/7200", "HWPUNIT definition"], ["100 HWPUNIT", "pt conversion"], ["283.46", "mm conversion"], ["59528", "A4 width"], ["84186", "A4 height"]])) {
      check(("eval: " + pyStr(why) + " value matches concrete files"), (truth((contains(fmt, token))) && truth((contains(crit, token)))), token);
    }
    tmpl = join(ROOT, "templates", "base", "Contents", "section0.xml");
    check("eval: documentation identifies the real template as A4-height evidence", (truth((contains(fmt, "84186 is the value Hangul uses, not a calculated conversion"))) && truth((contains(fmt, "section0.xml")))));
    check("eval: that template actually uses 84186", (truth(isFile(tmpl)) && truth((contains(openFile(tmpl, {encoding:"utf-8"}).read(), "height=\"84186\"")))));
  }
  AGENT = join(ROOT, "agents", "openai.yaml");
  check("agent card: openai.yaml exists", isFile(AGENT));
  _agent = (truth(isFile(AGENT)) ? openFile(AGENT, {encoding:"utf-8"}).read() : "");
  for ([_label, _needle] of iterable([["analyzes the reference first", "Analyze the provided reference"], ["asks about missing mappings (HITL)", "ask for any missing"], ["validates both structure and semantics", "structurally and semantically"]])) {
    check(("agent card contract: " + pyStr(_label)), (contains(_agent, _needle)), _needle);
  }
  src = openFile(join(SCRIPTS, "build_hwpx.py"), {encoding:"utf-8"}).read();
  check("delta: argparse enforces the allowlist", (contains(src, "choices=AVAILABLE_TEMPLATES")));
  check("prohibition: proposal template is absent from the tree", (!truth(pathJoin(pathJoin(Path(ROOT), "templates"), "proposal").exists())));
  check("fixture exists", existsSync(FIXTURE));
  REF_CONTRACTS = [["com-windows-guide.md", "the only .hwp input path: required COM environment and entry pattern", ["pywin32", "HWPFrame.HwpObject", "Windows"], 890], ["example-flow.md", "actual converter arguments and ambiguity-question format", ["md_to_hwpx.py", "--reference", "--title", "2.1.1.1", "inferred draft"], 2292], ["hitl-review.md", "status-label set: no approval before human acceptance", ["ready-for-review", "accepted-by-user", "not-run", "Do not block initial delivery"], 1471], ["hwpx-format.md", "OWPML container structure: section, header, and mimetype", ["section", "header", "mimetype"], 6038], ["markdown-proposal-rules.md", "concrete mapping pairs, table rules, and unsupported features", ["hp:tbl", "--preserve-heading-numbers", "--roman-to-arabic", "표 내용", "merged cells", "page body width"], 1527], ["style-intake.md", "concrete reference-inspection items and gap questions", ["analyze_template.py", "2.1.1.1", "line spacing", "style-generated", "one short grouped question"], 1849], ["troubleshooting.md", "failures that remain possible after validator success", ["validate_hwpx.py", "Hancom layout looks wrong", "Korean paths", "missing styles"], 604], ["validation-rules.md", "concrete structural and semantic checks plus diagnostic contract (H-4)", ["ZIP_STORED", "secPr", "colPr", "styleIDRef", "--semantic", "schemaVersion", "supportedFixes", "requiresEvidence", "internal/unclassified"], 804], ["workflows.md", "actual commands, arguments, and batch ownership rules for every path", ["analyze_template.py", "md_to_hwpx.py", "--semantic-validate", "PYTHONUTF8", "one worker per output file"], 1522], ["xml-structure.md", "secPr attribute misuse, required hp:pic children, and ID-reference rules", ["hp:pagePr", "masterPageCnt", "hp:imgClip", "hp:renderingInfo", "binaryItemIDRef", "itemCnt"], 7905], ["hangul-practice.md", "table overflow, anchoring, paragraph-property inheritance, and font substitution", ["repeatHeader", "pageBreak=\"CELL\"", "vertRelTo", "isEmbedded=\"0\"", "ON_SECTION", "hp:textart"], 6028], ["render-checklist.md", "automated/HITL boundary and handoff timing rules", ["--check", "At least two days before submission", "hp:pagePr", "repeatHeader", "review one day before submission often functions only as notice"], 3988], ["kordoc-public-doc.md", "bullet-style endings, layer thresholds, official hierarchy, and explicit exclusions", ["bullet-style rules", "Ministry of the Interior and Safety ordinance", "2020 행정업무운영 편람", "Equations", "OCR"], 5580]];
  ENSURE = join(ROOT, "scripts", "ensure_hwpx.js");
  check("ensure: check script exists", existsSync(ENSURE));
  _r = subprocessRun([process.execPath, ENSURE], {capture_output:true, text:true});
  check("ensure: exit code is within the contract (0, 1, or 2)", (contains([0, 1, 2], _r.returncode)), ("rc=" + pyStr(_r.returncode)));
  _src = openFile(ENSURE, {encoding:"utf-8"}).read();
  check("ensure: missing lxml maps to exit 2", (truth((contains(_src, "import lxml"))) && truth((contains(_src, "return 2")))));
  check("ensure: unavailable .hwp input maps to exit 1 while .hwpx remains available", (truth((contains(_src, "return 1"))) && truth((contains(_src, ".hwpx generation and validation remain available")))));
  check("ensure: advises installation without performing it", (contains(_src, "uv pip install")));
  check_ref_contracts(check, ROOT, REF_CONTRACTS);
  MD2HWPX_FLAGS = ["--reference", "--title", "--roman-to-arabic", "--preserve-heading-numbers", "--reference-cache-dir", "--validate", "--semantic-validate"];
  _cmds = split(skill, "## Commands", 1).at(-1)!;
  _wf = openFile(join(ROOT, "references", "workflows.md"), {encoding:"utf-8"}).read();
  _undoc = (() => { const __items: any[] = []; for (const f of iterable(MD2HWPX_FLAGS)) { if (!truth((truth((!contains(_cmds, f))) && truth((!contains(_wf, f)))))) continue; __items.push(f); } return __items; })();
  check("cross-check: all canonical md_to_hwpx flags are documented", (!truth(_undoc)), ("missing from docs " + pyStr(_undoc)));
  _help = _run_py(join(SCRIPTS, "md_to_hwpx.py"), "--help");
  _unimpl = (() => { const __items: any[] = []; for (const f of iterable(MD2HWPX_FLAGS)) { if (!truth((!contains(_help.stdout, f)))) continue; __items.push(f); } return __items; })();
  check("cross-check: md_to_hwpx.py accepts those flags (executed --help)", (truth((equal(_help.returncode, 0))) && truth((!truth(_unimpl)))), ("rc=" + pyStr(_help.returncode) + " missing from implementation " + pyStr(_unimpl)));
  _m2h_src = openFile(join(SCRIPTS, "md_to_hwpx.py"), {encoding:"utf-8"}).read();
  check("cross-check: --semantic-validate is wired to semantic validation", (truth((contains(_m2h_src, "validate_output(args.output, semantic=args.semantic_validate)"))) && truth((contains(_m2h_src, "validator.validate_semantic(str(output))")))));
  _fmt = openFile(join(ROOT, "references", "hwpx-format.md"), {encoding:"utf-8"}).read();
  _hdr_txt = openFile(pyStr(pathJoin(pathJoin(BASE, "Contents"), "header.xml")), {encoding:"utf-8"}).read();
  _fr = regexSearch("<hh:fontRef hangul=\"([^\"]+)\"", _hdr_txt);
  check("cross-check: real header.xml uses a numeric fontRef hangul ID", (truth(truth(_fr)) && truth(/^\d+$/.test(_fr[1]))), (truth(_fr) ? _fr[1] : "missing"));
  _hangul_block = regexSearch("<hh:fontface lang=\"HANGUL\".*?</hh:fontface>", _hdr_txt, "s");
  _face = (truth((truth(_fr) && truth(_hangul_block))) ? regexSearch(pyStr("<hh:font id=\"%s\" face=\"([^\"]+)\"").replace("%s",pyStr(escapeRegex(_fr[1]))), _hangul_block[0]) : null);
  check("cross-check: that ID identifies a real font in the HANGUL fontface", truth(_face), (truth(_face) ? _face[1] : "not found"));
  check("cross-check: documented fontRef matches the real value", (truth(truth(_fr)) && truth((contains(_fmt, pyStr("<hh:fontRef hangul=\"%s\" latin=").replace("%s",pyStr(_fr[1])))))));
  check("cross-check: documented font name matches the real face", (truth(truth(_face)) && truth((contains(_fmt, _face[1])))), (truth(_face) ? _face[1] : ""));
  check("cross-check: documentation preserves the warning against name-valued references", (truth((contains(_fmt, "Hancom does not resolve a name there"))) && truth((contains(_fmt, "numeric IDs, not font names")))));
  PAGEBREAK_ROWS = [["`TABLE`", "Keeps the table whole; if it does not fit, moves **the entire table to the next page**"], ["`CELL`", "Splits **between cells**; paragraphs within one cell do not cross pages"], ["`NONE`", "Does not split; overflow is **clipped and invisible**"]];
  _hp = openFile(join(ROOT, "references", "hangul-practice.md"), {encoding:"utf-8"}).read();
  _sec = split(_hp, "### Three `pageBreak` values", 1).at(-1)!.split(regex("(?m)^#{2,3} "))[0];
  _rows = (() => { const __items: any[] = []; for (const ln of iterable(_sec.split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== ""))) { if (!truth(starts(ln, "| `"))) continue; __items.push(Array.from((() => { const __items: any[] = []; for (const c of iterable(split(stripChars(ln.trim(), "|"), "|"))) { __items.push(c.trim()); } return __items; })()).slice(0, 2)); } return __items; })();
  check("cross-check: pageBreak table value/behavior pairs match the canonical rows", (equal(_rows, (() => { const __items: any[] = []; for (const r of iterable(PAGEBREAK_ROWS)) { __items.push(Array.from(r)); } return __items; })())), (pyStr(_rows)));
  check("cross-check: repeatHeader and CELL pairing rule is preserved", (contains(_sec, "`repeatHeader=\"1\"` matters only with `pageBreak=\"CELL\"`")));
  check("template: base/mimetype has the canonical OPC value without a newline", (equal(pathJoin(BASE, "mimetype").read_bytes(), Buffer.from("6170706c69636174696f6e2f6877702b7a6970", "hex"))), pyStr(pathJoin(BASE, "mimetype").read_bytes().slice(0, 40)));
  PACK = join(SCRIPTS, "office", "pack.py");
  check("office/pack: script exists", isFile(PACK));
  _pd = Path(mkdtempSync(join(tmpdir(), "jstack-hwpx-")));
  try {
    pathJoin(_pd, "src").mkdir();
    pathJoin(pathJoin(_pd, "src"), "mimetype").write_bytes(Buffer.from("6170706c69636174696f6e2f6877702b7a6970", "hex"));
    pathJoin(pathJoin(_pd, "src"), "Contents").mkdir();
    pathJoin(pathJoin(pathJoin(_pd, "src"), "Contents"), "header.xml").write_text(add("<a/>", multiply("x", 4000)));
    _out = pathJoin(_pd, "packed.hwpx");
    _r = _run_py(PACK, pathJoin(_pd, "src"), _out);
    check("office/pack: packages a directory as hwpx (rc=0)", (truth((equal(_r.returncode, 0))) && truth(_out.is_file())), _r.stderr.trim().slice(0, 80));
    _info = (truth(_out.is_file()) ? zipfile.ZipFile(_out).infolist() : []);
    check("office/pack: mimetype is the first entry", (truth(truth(_info)) && truth((equal(_info[0].filename, "mimetype")))), (truth(_info) ? _info[0].filename : "no entries"));
    check("office/pack: mimetype is uncompressed (ZIP_STORED)", (truth(truth(_info)) && truth((equal(_info[0].compress_type, zipfile.ZIP_STORED)))), (truth(_info) ? pyStr(_info[0].compress_type) : ""));
    check("office/pack: remaining entries are compressed (ZIP_DEFLATED)", (() => { const __items: any[] = []; for (const i of iterable(_info)) { __items.push((truth((!equal(i.filename, "mimetype"))) && truth((equal(i.compress_type, zipfile.ZIP_DEFLATED))))); } return __items; })().some(truth), pyStr((() => { const __items: any[] = []; for (const i of iterable(_info)) { __items.push([i.filename, i.compress_type]); } return __items; })()));
    check("office/pack: all files are included", (equal(new Set((() => { const __items: any[] = []; for (const i of iterable(_info)) { __items.push(i.filename); } return __items; })()), new Set(["mimetype", "Contents/header.xml"]))), pyStr(sorted((() => { const __items: any[] = []; for (const i of iterable(_info)) { __items.push(i.filename); } return __items; })())));
    pathJoin(_pd, "bad").mkdir();
    pathJoin(pathJoin(_pd, "bad"), "Contents").mkdir();
    pathJoin(pathJoin(pathJoin(_pd, "bad"), "Contents"), "header.xml").write_text("<a/>");
    _rb = _run_py(PACK, pathJoin(_pd, "bad"), pathJoin(_pd, "bad.hwpx"));
    check("office/pack: rejects a directory without mimetype (rc!=0)", (!equal(_rb.returncode, 0)), ("rc=" + pyStr(_rb.returncode)));
    _rc = _run_py(PACK, pathJoin(_pd, "nope"), pathJoin(_pd, "nope.hwpx"));
    check("office/pack: classifies a missing directory as input error (rc=1)", (equal(_rc.returncode, 1)), ("rc=" + pyStr(_rc.returncode)));
  } finally {
    rmSync(pyStr(_pd), {recursive:true,force:true});
  }
  _probe_dir = mkdtempSync(join(tmpdir(), "jstack-hwpx-"));
  try {
    _clean = _make_probe(pathJoin(Path(_probe_dir), "clean.hwpx"), {neutral_preview: true});
    _dirty = _make_probe(pathJoin(Path(_probe_dir), "dirty.hwpx"), {neutral_preview: false});
    _boxed = _make_probe(pathJoin(Path(_probe_dir), "boxed.hwpx"), {neutral_preview: true, box_every_char: true});
    _absent = join(_probe_dir, "nope.hwpx");
    _fb = join(SCRIPTS, "fix_borders.py");
    _r = _run_py(_fb, _clean, "--check");
    check("fix_borders: accepts a border-free file (rc=0)", (truth((equal(_r.returncode, 0))) && truth((contains(_r.stdout, "OK:")))), ("rc=" + pyStr(_r.returncode)));
    _r = _run_py(_fb, _boxed, "--check");
    check("fix_borders: finds character-border miswiring per charPr (rc=1)", (truth((equal(_r.returncode, 1))) && truth((equal(count(_r.stdout, "borders on)"), 7)))), ("rc=" + pyStr(_r.returncode) + ", " + pyStr(count(_r.stdout, "borders on)")) + " findings"));
    _r = _run_py(_fb, _boxed, "--fix");
    _after = _run_py(_fb, _boxed, "--check");
    check("fix_borders: --fix actually rebinds styles (recheck passes)", (truth((equal(_r.returncode, 0))) && truth((contains(_r.stdout, "FIXED:"))) && truth((equal(_after.returncode, 0)))), ("fix rc=" + pyStr(_r.returncode) + ", recheck rc=" + pyStr(_after.returncode)));
    _wi = zipfile.ZipFile(_boxed).infolist();
    check("hwpx_zip: rewritten output has mimetype first", (truth(truth(_wi)) && truth((equal(_wi[0].filename, "mimetype")))), (truth(_wi) ? _wi[0].filename : "no entries"));
    check("hwpx_zip: rewritten output stores mimetype uncompressed (ZIP_STORED)", (truth(truth(_wi)) && truth((equal(_wi[0].compress_type, zipfile.ZIP_STORED)))), (truth(_wi) ? pyStr(_wi[0].compress_type) : ""));
    check("hwpx_zip: remaining entries are compressed (ZIP_DEFLATED)", (() => { const __items: any[] = []; for (const i of iterable(_wi)) { __items.push((truth((!equal(i.filename, "mimetype"))) && truth((equal(i.compress_type, zipfile.ZIP_DEFLATED))))); } return __items; })().some(truth));
    _hz = openFile(join(SCRIPTS, "hwpx_zip.py"), {encoding:"utf-8"}).read();
    check("hwpx_zip: mimetype write explicitly uses ZIP_STORED (not the default)", (regexSearch("ZipInfo\\(\"mimetype\"\\),\\s*data,\\s*compress_type=zipfile\\.ZIP_STORED", _hz) !== null));
    _r = _run_py(_fb, _absent, "--check");
    check("fix_borders: classifies a missing file as input error (rc=2)", (equal(_r.returncode, 2)), ("rc=" + pyStr(_r.returncode)));
    _st = join(SCRIPTS, "sanitize_template.py");
    _r = _run_py(_st, _dirty, "--check");
    check("sanitize_template: detects a retained client preview thumbnail (rc=1)", (truth((equal(_r.returncode, 1))) && truth((contains(_r.stdout, "PrvImage.png")))), ("rc=" + pyStr(_r.returncode)));
    _r = _run_py(_st, _dirty, "--fix");
    _left = _run_py(_st, _dirty, "--check");
    check("sanitize_template: --fix replaces the preview with the neutral image", (truth((equal(_r.returncode, 0))) && truth((!contains(_left.stdout, "PrvImage.png")))), ("fix rc=" + pyStr(_r.returncode)));
    check("sanitize_template: unused styles remain without --prune-styles", (contains(_left.stdout, "unused-style:")), ("remaining " + pyStr(count(_left.stdout, "unused-style:")) + " entries"));
    _r = _run_py(_st, _dirty, "--fix", "--prune-styles");
    _left = _run_py(_st, _dirty, "--check");
    check("sanitize_template: --prune-styles removes them when requested", (truth((contains(_r.stdout, "pruned"))) && truth((!contains(_left.stdout, "unused-style:")))), (truth(_r.stdout.trim()) ? _r.stdout.trim().split(/\r?\n/).filter((_: string, i: number, xs: string[]) => i < xs.length - 1 || xs[i] !== "").at(-1)! : ""));
    _r = _run_py(_st, _absent, "--check");
    check("sanitize_template: classifies a missing file as input error (rc=2)", (equal(_r.returncode, 2)), ("rc=" + pyStr(_r.returncode)));
    _hook = join(ROOT, "hooks", "hwpx_guard.js");
    _still_boxed = _make_probe(pathJoin(Path(_probe_dir), "boxed2.hwpx"), {neutral_preview: true, box_every_char: true});
    _no_header = _make_probe(pathJoin(Path(_probe_dir), "noheader.hwpx"), {neutral_preview: true, drop_header: true});
    _mime_last = _make_probe(pathJoin(Path(_probe_dir), "mimelast.hwpx"), {neutral_preview: true, mimetype_last: true});
    check("hook: hwpx_guard.js exists", isFile(_hook));
    function _guard(cmd: any): any {
      return _run_hook(_hook, {["tool_name"]: "Bash", ["tool_input"]: {["command"]: cmd}});
    }
    _r = _guard(("open " + pyStr(_still_boxed)));
    check("hook: blocks character-border miswiring at handoff", (truth((/"decision"\s*:\s*"block"/.test(_r.stdout))) && truth((contains(_r.stdout, "fix_borders.py")))), _r.stdout.trim().slice(0, 60));
    _r = _guard(("open " + pyStr(_no_header)));
    check("hook: blocks a missing required entry at handoff", (truth((/"decision"\s*:\s*"block"/.test(_r.stdout))) && truth((contains(_r.stdout, "Contents/header.xml")))), _r.stdout.trim().slice(0, 60));
    _r = _guard(("open " + pyStr(_mime_last)));
    check("hook: blocks packages whose first entry is not mimetype", (truth((/"decision"\s*:\s*"block"/.test(_r.stdout))) && truth((contains(_r.stdout, "first ZIP entry")))), _r.stdout.trim().slice(0, 60));
    _r = _guard(("open " + pyStr(_dirty)));
    check("hook: does not block handoff of sanitized output", (truth((equal(_r.returncode, 0))) && truth((!contains(_r.stdout, "block")))), _r.stdout.trim().slice(0, 60));
    _r = _guard(("python3 md_to_hwpx.py a.md " + pyStr(_still_boxed)));
    check("hook: allows this skill's own command because it is not a handoff", (equal(_r.stdout.trim(), "")), _r.stdout.trim().slice(0, 60));
    _r = _run_hook(_hook, null, {raw: "이건 JSON 이 아니다"});
    check("hook: fails open on unreadable input (rc=0 and no output)", (truth((equal(_r.returncode, 0))) && truth((equal(_r.stdout.trim(), "")))), ("rc=" + pyStr(_r.returncode)));
  } finally {
    rmSync(pyStr(_probe_dir), {recursive:true,force:true});
  }
  _fmt2 = openFile(join(ROOT, "references", "hwpx-format.md"), {encoding:"utf-8"}).read();
  check("I-2: fontRef example uses the numeric-ID form", (contains(_fmt2, "<hh:fontRef hangul=\"1\"")));
  check("I-2: example element lacks the font-name form (correction quote excepted)", (!contains(_fmt2, "<hh:fontRef hangul=\"한양신명조\"")));
  check("I-2: font-name form appears only in the correction quote", (equal(count(_fmt2, "hangul=\"한양신명조\""), 1)), (pyStr(count(_fmt2, add(String.fromCodePoint(96), String.fromCodePoint(96)))) + " / actual " + pyStr(count(_fmt2, add(add(add("hangul=", String.fromCodePoint(34)), "한양신명조"), String.fromCodePoint(34)))) + " occurrences"));
  check("I-2: numeric-ID explanation remains", (contains(_fmt2, "`hangul=\"1\"` selects **함초롬바탕**")));
  _uncovered = sorted((() => { const __items: any[] = []; for (const n of iterable(_LIVE_SKIPPED)) { if (!truth((!truth(starts(n, _SECTION_PREFIXES))))) continue; __items.push(n); } return __items; })());
  check("자기검사: section declarations cover every disappearing check", (!truth(_uncovered)), (truth(_uncovered) ? ("uncovered " + pyStr(_uncovered)) : (pyStr(length(_LIVE_SKIPPED)) + " checks")));
  for (const [file, needles] of [["NOTICE", ["stevechoi0222", "chrisryugj/kordoc"]], ["LICENSE.kordoc", ["MIT License", "Permission is hereby granted", "WITHOUT WARRANTY"]]] as [string, string[]][]) { const path = join(ROOT, file), text = existsSync(path) ? readFileSync(path, 'utf8') : ''; check(`Provenance: ${file} keeps its attribution and license terms`, needles.every(needle => text.includes(needle)), needles.filter(needle => !text.includes(needle)).join(', ')); }
  check_no_constant_assertions(check, __file__);
  if (truth((provider === null))) {
    check("dependency: an lxml acquisition path exists", false, (pyStr(detail) + " — users install it themselves: uv pip install -r skills/hwpx/requirements.txt"));
    for (_axis of iterable(SKIPPED_AXES)) {
      console.log(("[SKIP] " + pyStr(_axis) + " — cannot run without lxml"));
    }
    check("자기검사: total check count", false, "unmeasurable without dependency; measure totals only in a full run");
    passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
    console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과, " + pyStr(length(SKIPPED_AXES)) + "개 판정 건너뜀 — 의존성 부재(스위트 판정: 실패)"));
    return 2;
  }
  check("dependency: an lxml acquisition path exists", (provider !== null), ({["ambient"]: ("ambient python3 — " + pyStr(detail)), ["uv-child"]: ("temporary uv environment; absent from ambient python3 (" + pyStr(detail) + ")")} as any)[provider]);
  broken = [];
  function need(modname:string,...attrs:string[]):any{try{const info=backend.inspect(modname,attrs,[...attrs.filter(a=>a===a.toUpperCase()),...(modname==='validate_hwpx'?['EXPECTED_MIMETYPE','SECPR_REQUIRED_CHILDREN']:[])]);if(info.missing.length){broken.push(`${modname}: missing names ${info.missing}`);return null;}return new Proxy(info.constants,{get(target,name:string){if(name in target)return target[name];if(modname==='rekian_xml'&&name==='clear_linesegarrays')return (root:XmlNode,paras?:XmlNode[])=>backend.clear(root,paras);return (...args:any[])=>backend.call(modname,name,args);}});}catch(e){broken.push(`${modname}: import failed — ${pyStr(e)}`);return null;}}
  md_to_hwpx = need("md_to_hwpx", "write_hwpx", "parse_markdown");
  rekian_xml = need("rekian_xml", "parse_xml");
  build_hwpx = need("build_hwpx", "AVAILABLE_TEMPLATES");
  analyze_template = need("analyze_template", "get_text", "analyze_fonts");
  batch_convert = need("batch_convert", "infer_title", "CONVERTER");
  _text_extract = need("text_extract", "TAG_T");
  validate_hwpx = need("validate_hwpx", "validate", "REQUIRED_FILES");
  office_unpack = null;
  try {
    office_unpack = need("office.unpack", "safe_destination");
  } catch (e: any) {
    broken.push(("office.unpack: import failed — " + pyStr(e.constructor.__name__) + ": " + pyStr(e)));
  }
  for (why of iterable(broken)) {
    check("script unavailable", false, why);
  }
  section(check, results, ..._axes("delta:", "core:", "baseline:")).run(()=>{
    SECRET = add(Buffer.from("89504e470d0a1a0a", "hex"), multiply(Buffer.from("5245464552454e43452d4f524947494e414c2d5448554d424e41494c", "hex"), 20));
    ref = make_reference(tmp, SECRET);
    out = pathJoin(tmp, "out.hwpx");
    md_to_hwpx.write_hwpx(ref, out, Buffer.from("3c7365632f3e", "hex"), Buffer.from("3c6864722f3e", "hex"), [{["type"]: "paragraph", ["text"]: "본문"}], "제목");
    {
      z = zipfile.ZipFile(out);
      try {
        got = z.read("Preview/PrvImage.png");
      } finally { z.close(); }
    }
    check("delta: reference preview does not leak into the output", (truth((!equal(got, SECRET))) && truth((!contains(got, Buffer.from("5245464552454e43452d4f524947494e414c", "hex"))))), ("output thumbnail " + pyStr(length(got)) + "B"));
    neutral = pathJoin(pathJoin(BASE, "Preview"), "PrvImage.png").read_bytes();
    check("delta: preview is replaced with the neutral image", (equal(got, neutral)));
    outdir = pathJoin(tmp, "slip");
    outdir.mkdir();
    _sd = (office_unpack?.["safe_destination"] ?? null);
    blocked = 0;
    for (evil of iterable(["../escape.txt", "../../escape.txt", "/etc/passwd"])) {
      if (truth((_sd === null))) {
        break;
      }
      try {
        _sd(outdir, evil);
      } catch (__error: any) {
        if (__error?.name !== "ValueError") throw __error;
        blocked += 1;
      }
    }
    check("delta: all three zip-slip path forms are blocked", (equal(blocked, 3)), (truth(_sd) ? (pyStr(blocked) + "/3") : "safe_destination is missing"));
    inside = (truth(_sd) ? Path(_sd(outdir, "Contents/header.xml")) : null);
    check("delta: safe entries pass", (truth((inside !== null)) && truth((contains(inside.parents, outdir.resolve())))));
    xml = Buffer.from("3c68703a73656320786d6c6e733a68703d22687474703a2f2f7777772e68616e636f6d2e636f2e6b722f6877706d6c2f323031312f706172616772617068223e3c68703a703e3c68703a6c696e6573656761727261793e3c68703a6c696e657365672f3e3c2f68703a6c696e6573656761727261793e3c2f68703a703e3c68703a703e3c68703a6c696e6573656761727261793e3c68703a6c696e657365672f3e3c2f68703a6c696e6573656761727261793e3c2f68703a703e3c2f68703a7365633e", "hex");
    root = etree.fromstring(xml);
    n = rekian_xml.clear_linesegarrays(root);
    left = length(root.findall(".//{*}linesegarray"));
    check("delta: clear_linesegarrays removes caches", (truth((equal(n, 2))) && truth((equal(left, 0)))), ("removed " + pyStr(n) + " / remaining " + pyStr(left)));
    root2 = etree.fromstring(xml);
    paras = root2.findall(".//{*}p");
    n2 = rekian_xml.clear_linesegarrays(root2, [paras[0]]);
    left2 = length(root2.findall(".//{*}linesegarray"));
    check("delta: a targeted paragraph mutation preserves untouched paragraph caches", (truth((equal(n2, 1))) && truth((equal(left2, 1)))), ("removed " + pyStr(n2) + " / remaining " + pyStr(left2)));
    check("delta: the surviving cache belongs to the second paragraph", (backend.owningIndex(root2) === 1));
    _sd = mkdtempSync(join(tmpdir(), "jstack-hwpx-"));
    _sp = join(_sd, "section0.xml");
    openFile(_sp, "w", {encoding:"utf-8"}).write("<hp:sec xmlns:hp=\"http://www.hancom.co.kr/hwpml/2011/paragraph\"><hp:p><hp:run><hp:t>가</hp:t></hp:run><hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p><hp:p><hp:run><hp:t>나</hp:t></hp:run><hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p></hp:sec>");
    try {
      rekian_xml.rewrite_redraftable_paragraphs(Path(_sp), {[0]: "다"});
      _after = etree.fromstring(openFile(_sp, "rb").read());
      _left3 = length(_after.findall(".//{*}linesegarray"));
      check("delta: the rewrite path actually clears caches (caller binding)", (equal(_left3, 0)), ("remaining " + pyStr(_left3)));
    } catch (_e: any) {
      check("delta: the rewrite path actually clears caches (caller binding)", false, pyStr(_e).slice(0, 80));
    } finally {
      rmSync(pyStr(_sd), {recursive:true,force:true});
    }
    check("delta: the template list is static", (equal(build_hwpx.AVAILABLE_TEMPLATES, ["report"])), pyStr(build_hwpx.AVAILABLE_TEMPLATES));
    blocks = md_to_hwpx.parse_markdown(openFile(FIXTURE, {encoding:"utf-8"}).read());
    check("core: Markdown parsing produces blocks", (length(blocks) > 0), (pyStr(length(blocks)) + " blocks"));
    kinds = new Set((() => { const __items: any[] = []; for (const b of iterable(blocks)) { __items.push((b["type"] ?? null)); } return __items; })());
    check("core: tables, lists, and paragraphs are all recognized", subsetOrCompare(new Set(["table", "paragraph"]), kinds), pyStr(sorted(kinds)));
    ref2 = make_reference(tmp, neutral);
    out2 = pathJoin(tmp, "fixture.hwpx");
    md_to_hwpx.write_hwpx(ref2, out2, Buffer.from("3c7365632f3e", "hex"), Buffer.from("3c6864722f3e", "hex"), blocks, "픽스처");
    {
      z = zipfile.ZipFile(out2);
      try {
        names = new Set(iterable(z.namelist()));
        prv = z.read("Preview/PrvText.txt").toString("utf8");
      } finally { z.close(); }
    }
    check("core: output contains required entries", subsetOrCompare(new Set(["mimetype", "Contents/header.xml", "Contents/section0.xml"]), names), (pyStr(length(names)) + " entries"));
    _mi = zipfile.ZipFile(out2).infolist()[0];
    check("core: mimetype is the first entry", (equal(_mi.filename, "mimetype")), _mi.filename);
    check("core: mimetype is uncompressed (ZIP_STORED)", (equal(_mi.compress_type, zipfile.ZIP_STORED)), pyStr(_mi.compress_type));
    check("core: preview text reflects the document body", (contains(prv, "테스트")), pyStr(prv.slice(0, 30)));
    gold = join(HERE, "gold", "minimal_blocks.json");
    shape = (() => { const __items: any[] = []; for (const b of iterable(blocks)) { __items.push({["type"]: (b["type"] ?? null), ["level"]: (b["level"] ?? null), ["rows"]: (truth((equal((b["type"] ?? null), "table"))) ? length((b["rows"] ?? [])) : null)}); } return __items; })();
    if (truth(existsSync(gold))) {
      want = JSON.parse(pyStr(openFile(gold, {encoding:"utf-8"}).read()));
      check("baseline: block structure matches the frozen copy", (equal(shape, want)), (truth((!equal(shape, want))) ? "mismatch" : (pyStr(length(shape)) + " blocks")));
    } else {
      if (truth((process.env["FREEZE_BASELINE"] ?? null))) {
        mkdirSync(dirname(gold), {recursive:true});
        openFile(gold, "w", {encoding:"utf-8"}).write(JSON.stringify(shape));
        check("baseline: rewrote frozen copy (FREEZE_BASELINE)", false, (pyStr(relativeTo(gold, ROOT)) + " — record the update in a commit and rerun"));
      } else {
        check("baseline: block structure matches the frozen copy", false, ("frozen copy missing (" + pyStr(relativeTo(gold, ROOT)) + ") — rerun with FREEZE_BASELINE=1 only for an intentional update"));
      }
    }
  });
  section(check, results, ..._axes("validate_hwpx:")).run(()=>{
    errs_ok = validate_hwpx.validate(pyStr(out2));
    check("validate_hwpx: valid output has no errors", (equal(errs_ok, [])), pyStr(errs_ok.slice(0, 2)));
    broken_path = pathJoin(tmp, "broken.hwpx");
    {
      zin = zipfile.ZipFile(out2);
      zout = zipfile.ZipFile(broken_path, "w");
      try {
        for (it of iterable(zin.infolist())) {
          if (truth((equal(it.filename, "Contents/header.xml")))) {
            continue;
          }
          zout.writestr(it, zin.read(it.filename));
        }
      } finally { zout.close(); zin.close(); }
    }
    errs_bad = validate_hwpx.validate(pyStr(broken_path));
    check("validate_hwpx: a missing required entry is detected (live assertion)", (!equal(errs_bad, [])), (pyStr(errs_bad.slice(0, 2))));
    check("validate_hwpx: a missing file is an error", (!equal(validate_hwpx.validate(pyStr(pathJoin(tmp, "nope.hwpx"))), [])));
    check("validate_hwpx: the required-entry list is nonempty", (length(validate_hwpx.REQUIRED_FILES) >= 3), pyStr(validate_hwpx.REQUIRED_FILES));
    REQUIRED_CANON = ["mimetype", "Contents/content.hpf", "Contents/header.xml", "Contents/section0.xml"];
    check("validate_hwpx: the required-entry list matches the canonical order", (equal(Array.from(validate_hwpx.REQUIRED_FILES), REQUIRED_CANON)), pyStr(validate_hwpx.REQUIRED_FILES));
    function _without(entry: any): any {
      let it: any, probe: any, zin: any, zout: any;
      probe = pathJoin(tmp, add(add("miss_", entry.replaceAll("/", "_")), ".hwpx"));
      {
        zin = zipfile.ZipFile(_req_base);
        zout = zipfile.ZipFile(probe, "w");
        try {
          for (it of iterable(zin.infolist())) {
            if (truth((equal(it.filename, entry)))) {
              continue;
            }
            zout.writestr(it, zin.read(it.filename));
          }
        } finally { zout.close(); zin.close(); }
      }
      return validate_hwpx.validate(pyStr(probe));
    }
    _req_base = Path(_make_probe(pathJoin(tmp, "required_base.hwpx"), {neutral_preview: true}));
    _req_names = new Set(iterable(zipfile.ZipFile(_req_base).namelist()));
    check("validate_hwpx: the required-entry probe covers the complete list", subsetOrCompare(new Set(iterable(REQUIRED_CANON)), _req_names), pyStr(sorted(subtract(new Set(iterable(REQUIRED_CANON)), _req_names))));
    for (_req of iterable(REQUIRED_CANON)) {
      _e = _without(_req);
      check(("validate_hwpx: a missing " + pyStr(_req) + " is detected"), (() => { const __items: any[] = []; for (const x of iterable(_e)) { __items.push((contains(x, ("Missing required file: " + pyStr(_req))))); } return __items; })().some(truth), (pyStr(_e.slice(0, 2))));
    }
    check("validate_hwpx: EXPECTED_MIMETYPE is the canonical OPC value", (equal(validate_hwpx.EXPECTED_MIMETYPE, "application/hwp+zip")), pyStr(validate_hwpx.EXPECTED_MIMETYPE));
    _mt_probe = pathJoin(tmp, "badmime.hwpx");
    {
      zin = zipfile.ZipFile(_req_base);
      zout = zipfile.ZipFile(_mt_probe, "w");
      try {
        for (it of iterable(zin.infolist())) {
          zout.writestr(it, (truth((equal(it.filename, "mimetype"))) ? Buffer.from("6170706c69636174696f6e2f7a6970", "hex") : zin.read(it.filename)));
        }
      } finally { zout.close(); zin.close(); }
    }
    _mt_errs = validate_hwpx.validate(pyStr(_mt_probe));
    check("validate_hwpx: an incorrect mimetype value is detected", (() => { const __items: any[] = []; for (const x of iterable(_mt_errs)) { __items.push((contains(x, "Invalid mimetype"))); } return __items; })().some(truth), (pyStr(_mt_errs.slice(0, 2))));
    SECPR_CANON = ["grid", "startNum", "visibility", "lineNumberShape", "pagePr", "footNotePr", "endNotePr", "pageBorderFill"];
    check("validate_hwpx: the required secPr child names match the canonical set", (equal(Array.from(validate_hwpx.SECPR_REQUIRED_CHILDREN), SECPR_CANON)), pyStr(validate_hwpx.SECPR_REQUIRED_CHILDREN));
    check("validate_hwpx: required secPr children cover all eight concrete types", (truth((length(validate_hwpx.SECPR_REQUIRED_CHILDREN) >= 8)) && truth((contains(validate_hwpx.SECPR_REQUIRED_CHILDREN, "pagePr")))), pyStr(validate_hwpx.SECPR_REQUIRED_CHILDREN));
    _base_errs = validate_hwpx.validate_semantic(pyStr(out2));
    check("validate_hwpx: valid output has no secPr child defects", (!truth((() => { const __items: any[] = []; for (const e of iterable(_base_errs)) { if (!truth((contains(e, "secPr is missing required child")))) continue; __items.push(e); } return __items; })())), (pyStr(_base_errs.slice(0, 2))));
    _secpr_base = Path(_make_probe(pathJoin(tmp, "secpr_base.hwpx"), {neutral_preview: true}));
    check("validate_hwpx: the base probe starts with a complete secPr", (!truth((() => { const __items: any[] = []; for (const e of iterable(validate_hwpx.validate_semantic(pyStr(_secpr_base)))) { if (!truth((contains(e, "secPr")))) continue; __items.push(e); } return __items; })())), pyStr(validate_hwpx.validate_semantic(pyStr(_secpr_base)).slice(0, 2)));
    function _secpr_probe(dropper: any): any {
      let it: any, payload: any, probe: any, sec: any, zin: any, zout: any;
      probe = pathJoin(tmp, "secpr_probe.hwpx");
      {
        zin = zipfile.ZipFile(_secpr_base);
        try {
          sec = etree.fromstring(zin.read("Contents/section0.xml"));
          dropper(sec);
          payload = etree.tostring(sec);
          {
            zout = zipfile.ZipFile(probe, "w");
            try {
              for (it of iterable(zin.infolist())) {
                if (truth((equal(it.filename, "mimetype")))) {
                  zout.writestr(zipfile.ZipInfo("mimetype"), zin.read("mimetype"));
                } else {
                  if (truth((equal(it.filename, "Contents/section0.xml")))) {
                    zout.writestr(it, payload);
                  } else {
                    zout.writestr(it, zin.read(it.filename));
                  }
                }
              }
            } finally { zout.close(); }
          }
        } finally { zin.close(); }
      }
      return validate_hwpx.validate_semantic(pyStr(probe));
    }
    function _drop(tag: any): any {
      function _f(sec: any): any {
        let el: any;
        for (el of iterable(sec.findall((".//{*}" + pyStr(tag))))) {
          el.getparent().remove(el);
        }
      }
      return _f;
    }
    _errs = _secpr_probe(_drop("pagePr"));
    check("validate_hwpx: removing pagePr from secPr is detected", (() => { const __items: any[] = []; for (const e of iterable(_errs)) { __items.push((contains(e, "hp:secPr is missing required child: hp:pagePr"))); } return __items; })().some(truth), (pyStr(_errs.slice(0, 2))));
    _errs = _secpr_probe(_drop("margin"));
    check("validate_hwpx: a missing margin inside pagePr is detected separately", (() => { const __items: any[] = []; for (const e of iterable(_errs)) { __items.push((contains(e, "hp:pagePr/hp:margin"))); } return __items; })().some(truth), (pyStr(_errs.slice(0, 2))));
    check("validate_hwpx: that defect is classified as document/structure", (equal(validate_hwpx.classify("hp:secPr is missing required child: hp:pagePr"), "document/structure")));
  });
  section(check, results, ..._axes("diagnostics:")).run(()=>{
    VAL = join(SCRIPTS, "validate_hwpx.py");
    function vpayload(...argv: any[]): any {
      let r: any;
      r = subprocessRun([python, VAL, ...argv], {capture_output:true, text:true});
      try {
        return [JSON.parse(pyStr(r.stdout)), r];
      } catch (__error: any) {
        return [null, r];
      }
    }
    [ok_p, ok_r] = vpayload(pyStr(out2), "--json");
    check("diagnostics: --json output is one valid JSON value", (ok_p !== null), pyOr(ok_r.stdout, ok_r.stderr).trim().slice(0, 80));
    check("diagnostics: envelope has schemaVersion 1 and identifies its source", (truth(truth(ok_p)) && truth((equal((ok_p["schemaVersion"] ?? null), 1))) && truth((equal((ok_p["source"] ?? null), "validate_hwpx")))), pyStr(ok_p).slice(0, 60));
    check("diagnostics: valid output has ok=true and no diagnostics", (truth(truth(ok_p)) && truth(((ok_p["ok"] ?? null) === true)) && truth((equal((ok_p["diagnostics"] ?? null), []))) && truth((equal(ok_r.returncode, 0)))), (truth(ok_p) ? pyStr((ok_p["diagnostics"] ?? null)).slice(0, 80) : "no envelope"));
    [bad_p, bad_r] = vpayload(pyStr(broken_path), "--json");
    codes = (() => { const __items: any[] = []; for (const d of iterable((pyOr(bad_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })();
    check("diagnostics: missing required entry becomes package/missing-file", (truth(truth(bad_p)) && truth(((bad_p["ok"] ?? null) === false)) && truth((!equal(bad_r.returncode, 0))) && truth((contains(codes, "package/missing-file")))), pyStr(codes));
    check("diagnostics: severity is error", (truth(truth(bad_p)) && truth((() => { const __items: any[] = []; for (const d of iterable((bad_p["diagnostics"] ?? []))) { __items.push((equal((d["severity"] ?? null), "error"))); } return __items; })().every(truth)) && truth((!equal(codes, [])))), pyStr(codes));
    check("diagnostics: diagnostic count equals validate() result count (no swallowing)", (truth(truth(bad_p)) && truth((equal(length((bad_p["diagnostics"] ?? [])), length(errs_bad))))), (pyStr(length((pyOr(bad_p, {})["diagnostics"] ?? []))) + " vs " + pyStr(length(errs_bad))));
    sem_path = pathJoin(tmp, "semantic-broken.hwpx");
    base_sec = pathJoin(pathJoin(BASE, "Contents"), "section0.xml").read_text();
    bad_sec = base_sec.replace("styleIDRef=\"0\"", "styleIDRef=\"99999\"");
    check("diagnostics: the injected IDRef mutation changes the file", (!equal(bad_sec, base_sec)));
    {
      zin = zipfile.ZipFile(out2);
      zout = zipfile.ZipFile(sem_path, "w");
      try {
        for (it of iterable(zin.infolist())) {
          zout.writestr(it, (truth((equal(it.filename, "Contents/section0.xml"))) ? Buffer.from(bad_sec) : zin.read(it.filename)));
        }
      } finally { zout.close(); zin.close(); }
    }
    [sem_p, sem_r] = vpayload(pyStr(sem_path), "--semantic", "--json");
    sem_ds = (() => { const __items: any[] = []; for (const d of iterable((pyOr(sem_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "reference/undefined")))) continue; __items.push(d); } return __items; })();
    check("diagnostics: injected undefined IDRef is classified as reference/undefined", (truth((!equal(sem_r.returncode, 0))) && truth((length(sem_ds) >= 1))), pyStr((() => { const __items: any[] = []; for (const d of iterable((pyOr(sem_p, {})["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })()).slice(0, 80));
    d0 = (truth(sem_ds) ? sem_ds[0] : {});
    check("diagnostics: evidence structures idref instead of raw text", (equal(((d0["evidence"] ?? {})["idref"] ?? null), "99999")), pyStr((d0["evidence"] ?? null)).slice(0, 80));
    fixes = (d0["supportedFixes"] ?? []);
    check("diagnostics: five repair stages appear in relocate-to-delete order", (equal((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["action"] ?? null)); } return __items; })(), ["relocate", "reroute", "shorten", "restructure", "delete"])), pyStr((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["action"] ?? null)); } return __items; })()));
    check("diagnostics: only deletion requires evidence (requiresEvidence)", (truth((equal(length(fixes), 5))) && truth((equal((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["requiresEvidence"] ?? null)); } return __items; })(), [false, false, false, false, true])))), pyStr((() => { const __items: any[] = []; for (const f of iterable(fixes)) { __items.push((f["requiresEvidence"] ?? null)); } return __items; })()));
    miss = ((() => { const __items: any[] = []; for (const d of iterable((pyOr(bad_p, {})["diagnostics"] ?? []))) { if (!truth((equal((d["code"] ?? null), "package/missing-file")))) continue; __items.push(d); } return __items; })().at(0) ?? {});
    check("diagnostics: package defects omit the five stages (no false guidance)", (equal((miss["supportedFixes"] ?? null), [])), pyStr((miss["supportedFixes"] ?? null)).slice(0, 60));
    inj_path = pathJoin(tmp, "text-steered.hwpx");
    inj_sec = base_sec.replaceAll("</hs:sec>", "  <hp:p id=\"777\" paraPrIDRef=\"0\" styleIDRef=\"0\" pageBreak=\"0\" columnBreak=\"0\" merged=\"0\"><hp:run charPrIDRef=\"0\"><hp:t>1. undefined styleIDRef=9</hp:t></hp:run></hp:p>\n</hs:sec>");
    check("diagnostics: steering paragraph was actually injected", (!equal(inj_sec, base_sec)));
    {
      zin = zipfile.ZipFile(out2);
      zout = zipfile.ZipFile(inj_path, "w");
      try {
        for (it of iterable(zin.infolist())) {
          zout.writestr(it, (truth((equal(it.filename, "Contents/section0.xml"))) ? Buffer.from(inj_sec) : zin.read(it.filename)));
        }
      } finally { zout.close(); zin.close(); }
    }
    [inj_p, _inj_r] = vpayload(pyStr(inj_path), "--semantic", "--json");
    inj_ds = (() => { const __items: any[] = []; for (const d of iterable((pyOr(inj_p, {})["diagnostics"] ?? []))) { if (!truth((equal(((d["subject"] ?? {})["identity"] ?? null), "777")))) continue; __items.push(d); } return __items; })();
    ord_ds = (() => { const __items: any[] = []; for (const d of iterable(inj_ds)) { if (!truth(starts((d["message"] ?? ""), "ordered list marker"))) continue; __items.push(d); } return __items; })();
    check("diagnostics: paragraph text cannot steer the code (F1)", (truth((equal(length(ord_ds), 1))) && truth((equal((ord_ds[0]["code"] ?? null), "conversion/residual-markup")))), pyStr((() => { const __items: any[] = []; for (const d of iterable(inj_ds)) { __items.push([(d["code"] ?? null), (d["message"] ?? "").slice(0, 30)]); } return __items; })()).slice(0, 90));
    fabricated = (() => { const __items: any[] = []; for (const d of iterable((pyOr(inj_p, {})["diagnostics"] ?? []))) { if (!truth((equal(((d["evidence"] ?? {})["idref"] ?? null), "9")))) continue; __items.push(d); } return __items; })();
    check("diagnostics: body text cannot fabricate reference evidence (F1)", (truth((!truth(fabricated))) && truth(truth(ord_ds)) && truth((!contains((ord_ds[0]["evidence"] ?? {}), "idref")))), pyStr(pyOr(fabricated, (truth(ord_ds) ? (ord_ds[0]["evidence"] ?? null) : "no diagnostic"))).slice(0, 80));
    [nf_p, nf_r] = vpayload(pyStr(pathJoin(tmp, "nope.hwpx")), "--json");
    check("diagnostics: a missing file becomes input/read", (truth(truth(nf_p)) && truth((!equal(nf_r.returncode, 0))) && truth((equal((() => { const __items: any[] = []; for (const d of iterable((nf_p["diagnostics"] ?? []))) { __items.push((d["code"] ?? null)); } return __items; })(), ["input/read"])))), (truth(nf_p) ? pyStr(((nf_p["diagnostics"] ?? [{}])[0]["code"] ?? null)) : "no envelope"));
    h = subprocessRun([python, VAL, pyStr(out2)], {capture_output:true, text:true});
    check("diagnostics: VALID line remains unchanged without --json", (truth((equal(h.returncode, 0))) && truth(starts(h.stdout, "VALID: "))), pyOr(h.stdout.trim().slice(0, 60), h.stderr.trim().slice(0, 60)));
    check("diagnostics: human-readable output does not mix in JSON", (truth((!contains(h.stdout, "schemaVersion"))) && truth((!truth(starts(h.stdout, "{"))))), h.stdout.slice(0, 60));
  });
  section(check, results, ..._axes("text_extract:")).run(()=>{
    {
      z = zipfile.ZipFile(out2);
      try {
        sec_xml = z.read("Contents/section0.xml").toString("utf8");
      } finally { z.close(); }
    }
    tx = subprocessRun([python, join(SCRIPTS, "text_extract.py"), pyStr(out2)], {capture_output:true, text:true});
    has_text = (contains(sec_xml, "<hp:t"));
    check("text_extract: extracted output agrees with body-text presence", (truth((equal(tx.returncode, 0))) && truth((equal(truth(tx.stdout.trim()), has_text)))), ("rc=" + pyStr(tx.returncode) + " section has hp:t=" + pyStr(has_text) + ", extracted=" + pyStr(length(tx.stdout.trim())) + " chars"));
    check("text_extract: a missing file is an error", (!equal(subprocessRun([python, join(SCRIPTS, "text_extract.py"), pyStr(pathJoin(tmp, "nope.hwpx"))], {capture_output:true}).returncode, 0)));
  });
  section(check, results, ..._axes("rekian_xml:")).run(()=>{
    xml_path = pathJoin(tmp, "probe.xml");
    xml_path.write_bytes(Buffer.from("3c3f786d6c2076657273696f6e3d22312e30223f3e3c613e3c622f3e3c622f3e3c2f613e", "hex"));
    tree = rekian_xml.parse_xml(xml_path);
    check("rekian_xml: parses XML from a path and returns a tree", (truth((tree !== null)) && truth((equal(length(Array.from(tree.getroot())), 2)))));
  });
  section(check, results, ..._axes("office/unpack:")).run(()=>{
    _ud = Path(mkdtempSync(join(tmpdir(), "jstack-hwpx-")));
    try {
      _src = Path(_make_probe(pathJoin(_ud, "rt.hwpx"), {neutral_preview: true}));
      _r = _run_py(join(SCRIPTS, "office", "unpack.py"), _src, pathJoin(_ud, "out"));
      check("office/unpack: extracts hwpx into a directory (rc=0)", (truth((equal(_r.returncode, 0))) && truth(pathJoin(pathJoin(_ud, "out"), "mimetype").is_file())), _r.stderr.trim().slice(0, 80));
      _rp = _run_py(join(SCRIPTS, "office", "pack.py"), pathJoin(_ud, "out"), pathJoin(_ud, "rt2.hwpx"));
      check("office/unpack: unpacking and repacking preserves entries", (truth((equal(_rp.returncode, 0))) && truth((equal(new Set(iterable(zipfile.ZipFile(pathJoin(_ud, "rt2.hwpx")).namelist())), new Set(iterable(zipfile.ZipFile(_src).namelist())))))), _rp.stderr.trim().slice(0, 80));
    } finally {
      rmSync(pyStr(_ud), {recursive:true,force:true});
    }
  });
  section(check, results, ..._axes("analyze_template:")).run(()=>{
    hdr = pathJoin(pathJoin(BASE, "Contents"), "header.xml");
    check("analyze_template: base template header.xml exists", hdr.is_file());
    hroot = etree.parse(pyStr(hdr)).getroot();
    fonts = analyze_template.analyze_fonts(hroot);
    check("analyze_template: reads actual font definitions from the base template", (length(fonts) > 1), (pyStr(length(fonts)) + " rows"));
  });
  section(check, results, ..._axes("batch_convert:")).run(()=>{
    check("batch_convert: strips numeric prefixes and changes underscores to spaces", (equal(batch_convert.infer_title(Path("01_제안_개요.md")), "제안 개요")), batch_convert.infer_title(Path("01_제안_개요.md")));
    check("batch_convert: converter path points inside this skill", (contains(pyStr(batch_convert.CONVERTER), "md_to_hwpx")), pyStr(batch_convert.CONVERTER));
  });
  live_ran = (() => { const __items: any[] = []; for (const r of iterable(results)) { if (!truth((!truth(starts(r[0], ["자기검사:", "계약 커버리지:", "스크립트 계약:"]))))) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
  check_script_contracts(check, __file__, ROOT, {runner: _runner_for(provider), live_ran: live_ran, scripts: {["scripts/analyze_template.py"]: 2, ["scripts/batch_convert.py"]: 3, ["scripts/build_hwpx.py"]: 49, ["scripts/md_to_hwpx.py"]: 58, ["scripts/rekian_xml.py"]: 54, ["scripts/text_extract.py"]: 2, ["scripts/validate_hwpx.py"]: 38, ["scripts/fix_borders.py"]: 5, ["scripts/sanitize_template.py"]: 5, ["scripts/hwpx_zip.py"]: 12, ["hooks/hwpx_guard.js"]: 3, ["scripts/office/pack.py"]: 8, ["scripts/office/unpack.py"]: 5}});
  check_contract_coverage(check, __file__, ROOT, {runner: _runner_for(provider), per_file: {"NOTICE": 1, "LICENSE.kordoc": 1, ["SKILL.md"]: 19, ["agents/openai.yaml"]: 3, ["scripts/ensure_hwpx.js"]: 3, ["references/com-windows-guide.md"]: 3, ["references/example-flow.md"]: 3, ["references/hitl-review.md"]: 3, ["references/hwpx-format.md"]: 15, ["references/markdown-proposal-rules.md"]: 3, ["references/style-intake.md"]: 3, ["references/troubleshooting.md"]: 4, ["references/validation-rules.md"]: 3, ["references/workflows.md"]: 3, ["references/xml-structure.md"]: 3, ["references/hangul-practice.md"]: 5, ["references/render-checklist.md"]: 3, ["references/kordoc-public-doc.md"]: 3}, live_ran: live_ran});
  check_body_deletion(check, __file__, ROOT, {runner: _runner_for(provider), minimum: 19, extra_strip: [], live_ran: live_ran});
  if (truth((!truth(in_deleted_run())))) {
    _fb = subprocessRun([python, resolve(__file__)], {capture_output:true, text:true, env:({...process.env, ...{[_FORCE_NO_LXML]: "1"}}), cwd:process.cwd()});
    _fb_lines = regexFindall("(?m)^\\[(?:PASS|FAIL)\\] (.+)$", _fb.stdout);
    function _ran_in_fallback(n: any): any {
      let ln: any;
      return (() => { const __items: any[] = []; for (const ln of iterable(_fb_lines)) { __items.push(pyOr((equal(ln, n)), starts(ln, add(n, " — ")))); } return __items; })().some(truth);
    }
    _fb_skips = length(regexFindall("(?m)^\\[SKIP\\] ", _fb.stdout));
    _self_name = "자기검사: [SKIP] list names every disappearing check";
    _full = union(new Set((() => { const __items: any[] = []; for (const r of iterable(results)) { __items.push(r[0]); } return __items; })()), new Set([_self_name, TOTAL_NAME, ...skipped_names()]));
    _lost = new Set((() => { const __items: any[] = []; for (const n of iterable(_full)) { if (!truth((truth((!truth(_ran_in_fallback(n)))) && truth((!equal(n, _self_name))) && truth((!truth(starts(n, "자기검사: 검사 총수"))))))) continue; __items.push(n); } return __items; })());
    _missing = sorted(subtract(_lost, new Set(iterable(SKIPPED_AXES))));
    _stale = sorted(subtract(new Set(iterable(SKIPPED_AXES)), _lost));
    check(_self_name, (truth((equal(_fb.returncode, 2))) && truth((equal(_fb_skips, length(SKIPPED_AXES)))) && truth((!truth(_missing))) && truth((!truth(_stale)))), add(add(("fallback rc=" + pyStr(_fb.returncode) + ", " + pyStr(_fb_skips) + " [SKIP] lines, " + pyStr(length(_lost)) + " disappearing checks"), (truth(_missing) ? (" · missing from list " + pyStr(_missing)) : "")), (truth(_stale) ? (" · only in list " + pyStr(_stale)) : "")));
  }
  check_total(check, results, TOTAL_EXPECTED);
  passed = (() => { const __items: any[] = []; for (const [_name, ok, _detail] of iterable(results)) { if (!truth(ok)) continue; __items.push(1); } return __items; })().reduce((sum: number, value: any) => sum + Number(value), 0);
  console.log(("\n" + pyStr(passed) + "/" + pyStr(length(results)) + " 통과"));
  return (truth((equal(passed, length(results)))) ? 0 : 1);
}

if(isMain(import.meta.url)){const rc=main();_write_child_mark(rc);process.exitCode=rc;}
