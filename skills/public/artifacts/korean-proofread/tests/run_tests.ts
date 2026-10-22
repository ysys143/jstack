/** Proof owning contracts. One deployed Node counter, independent fixed oracle, and consent-bound spell checks. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runProcess } from '../../../../../runtime/os.js';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, check_script_contracts, in_deleted_run, content_bytes, type Result } from '../../../../_suite_lib.js';
import { truth, length, contains, unique, sorted, repr, at, slice, strip, lstrip, rstrip, split, lines, count, starts, ends, lower, joinText, replace, findall, finditer, search, match, group, sub, isdir, isinstance, temporaryDirectory, removeTree, range, isdigit, enumerate } from '../../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),SCRIPTS=join(ROOT,'scripts'),COUNT_JS=join(SCRIPTS,'korean_character_count.js'),SPELL_JS=join(SCRIPTS,'korean_spell_check.js');
const results:Result[]=[];
function check(name:string,ok:boolean,detail=''):void{results.push([name,ok,detail]);console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
const read=(p:string)=>readFileSync(p,'utf8');
function countReport(text:string,profile='default'):Record<string,any>|null{const r=runProcess(process.execPath,[COUNT_JS,'--text',text,'--profile',profile,'--format','json']);if(r.status!==0)return null;try{return JSON.parse(r.stdout);}catch{return null;}}
function _c(text:string,profile='default'):Record<string,any>{return countReport(text,profile)?.counts??{};}
// Captured from the independent legacy Python counter during authoring, not produced by
// the deployed JavaScript module. All 16 discriminating inputs and both profiles remain.
const COUNT_ORACLE: Array<{text:string;default:Record<string,number>;neis:Record<string,number>}>=
[
  {
    "text": "한글 abc",
    "default": {
      "characters": 6,
      "characters_without_whitespace": 5,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 1,
      "bytes": 10,
      "bytes_utf8": 10,
      "bytes_neis": 10
    },
    "neis": {
      "characters": 6,
      "characters_without_whitespace": 5,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 1,
      "bytes": 10,
      "bytes_utf8": 10,
      "bytes_neis": 10
    }
  },
  {
    "text": "",
    "default": {
      "characters": 0,
      "characters_without_whitespace": 0,
      "code_points": 0,
      "utf16_code_units": 0,
      "lines": 0,
      "bytes": 0,
      "bytes_utf8": 0,
      "bytes_neis": 0
    },
    "neis": {
      "characters": 0,
      "characters_without_whitespace": 0,
      "code_points": 0,
      "utf16_code_units": 0,
      "lines": 0,
      "bytes": 0,
      "bytes_utf8": 0,
      "bytes_neis": 0
    }
  },
  {
    "text": "가나다\n라마바",
    "default": {
      "characters": 7,
      "characters_without_whitespace": 6,
      "code_points": 7,
      "utf16_code_units": 7,
      "lines": 2,
      "bytes": 19,
      "bytes_utf8": 19,
      "bytes_neis": 20
    },
    "neis": {
      "characters": 7,
      "characters_without_whitespace": 6,
      "code_points": 7,
      "utf16_code_units": 7,
      "lines": 2,
      "bytes": 20,
      "bytes_utf8": 19,
      "bytes_neis": 20
    }
  },
  {
    "text": "안녕👨‍👩‍👧",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 3,
      "code_points": 7,
      "utf16_code_units": 10,
      "lines": 1,
      "bytes": 24,
      "bytes_utf8": 24,
      "bytes_neis": 24
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 3,
      "code_points": 7,
      "utf16_code_units": 10,
      "lines": 1,
      "bytes": 24,
      "bytes_utf8": 24,
      "bytes_neis": 24
    }
  },
  {
    "text": "REQ-001 요구사항",
    "default": {
      "characters": 12,
      "characters_without_whitespace": 11,
      "code_points": 12,
      "utf16_code_units": 12,
      "lines": 1,
      "bytes": 20,
      "bytes_utf8": 20,
      "bytes_neis": 20
    },
    "neis": {
      "characters": 12,
      "characters_without_whitespace": 11,
      "code_points": 12,
      "utf16_code_units": 12,
      "lines": 1,
      "bytes": 20,
      "bytes_utf8": 20,
      "bytes_neis": 20
    }
  },
  {
    "text": "０１２ 전각",
    "default": {
      "characters": 6,
      "characters_without_whitespace": 5,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 1,
      "bytes": 16,
      "bytes_utf8": 16,
      "bytes_neis": 16
    },
    "neis": {
      "characters": 6,
      "characters_without_whitespace": 5,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 1,
      "bytes": 16,
      "bytes_utf8": 16,
      "bytes_neis": 16
    }
  },
  {
    "text": "ㄱㄴㄷ",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 3,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 1,
      "bytes": 9,
      "bytes_utf8": 9,
      "bytes_neis": 9
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 3,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 1,
      "bytes": 9,
      "bytes_utf8": 9,
      "bytes_neis": 9
    }
  },
  {
    "text": "café",
    "default": {
      "characters": 4,
      "characters_without_whitespace": 4,
      "code_points": 4,
      "utf16_code_units": 4,
      "lines": 1,
      "bytes": 5,
      "bytes_utf8": 5,
      "bytes_neis": 5
    },
    "neis": {
      "characters": 4,
      "characters_without_whitespace": 4,
      "code_points": 4,
      "utf16_code_units": 4,
      "lines": 1,
      "bytes": 5,
      "bytes_utf8": 5,
      "bytes_neis": 5
    }
  },
  {
    "text": "혼합 mix 混合",
    "default": {
      "characters": 9,
      "characters_without_whitespace": 7,
      "code_points": 9,
      "utf16_code_units": 9,
      "lines": 1,
      "bytes": 17,
      "bytes_utf8": 17,
      "bytes_neis": 17
    },
    "neis": {
      "characters": 9,
      "characters_without_whitespace": 7,
      "code_points": 9,
      "utf16_code_units": 9,
      "lines": 1,
      "bytes": 17,
      "bytes_utf8": 17,
      "bytes_neis": 17
    }
  },
  {
    "text": "가\r\n나",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 4,
      "utf16_code_units": 4,
      "lines": 2,
      "bytes": 8,
      "bytes_utf8": 8,
      "bytes_neis": 8
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 4,
      "utf16_code_units": 4,
      "lines": 2,
      "bytes": 8,
      "bytes_utf8": 8,
      "bytes_neis": 8
    }
  },
  {
    "text": "첫 줄\r\n둘째 줄🙂",
    "default": {
      "characters": 9,
      "characters_without_whitespace": 6,
      "code_points": 10,
      "utf16_code_units": 11,
      "lines": 2,
      "bytes": 23,
      "bytes_utf8": 23,
      "bytes_neis": 23
    },
    "neis": {
      "characters": 9,
      "characters_without_whitespace": 6,
      "code_points": 10,
      "utf16_code_units": 11,
      "lines": 2,
      "bytes": 23,
      "bytes_utf8": 23,
      "bytes_neis": 23
    }
  },
  {
    "text": "가\r나",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 7,
      "bytes_utf8": 7,
      "bytes_neis": 8
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 8,
      "bytes_utf8": 7,
      "bytes_neis": 8
    }
  },
  {
    "text": "가 나",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 9,
      "bytes_utf8": 9,
      "bytes_neis": 8
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 8,
      "bytes_utf8": 9,
      "bytes_neis": 8
    }
  },
  {
    "text": "가 나",
    "default": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 9,
      "bytes_utf8": 9,
      "bytes_neis": 8
    },
    "neis": {
      "characters": 3,
      "characters_without_whitespace": 2,
      "code_points": 3,
      "utf16_code_units": 3,
      "lines": 2,
      "bytes": 8,
      "bytes_utf8": 9,
      "bytes_neis": 8
    }
  },
  {
    "text": "\r\n",
    "default": {
      "characters": 1,
      "characters_without_whitespace": 0,
      "code_points": 2,
      "utf16_code_units": 2,
      "lines": 2,
      "bytes": 2,
      "bytes_utf8": 2,
      "bytes_neis": 2
    },
    "neis": {
      "characters": 1,
      "characters_without_whitespace": 0,
      "code_points": 2,
      "utf16_code_units": 2,
      "lines": 2,
      "bytes": 2,
      "bytes_utf8": 2,
      "bytes_neis": 2
    }
  },
  {
    "text": "가\r\n\r\n나",
    "default": {
      "characters": 4,
      "characters_without_whitespace": 2,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 3,
      "bytes": 10,
      "bytes_utf8": 10,
      "bytes_neis": 10
    },
    "neis": {
      "characters": 4,
      "characters_without_whitespace": 2,
      "code_points": 6,
      "utf16_code_units": 6,
      "lines": 3,
      "bytes": 10,
      "bytes_utf8": 10,
      "bytes_neis": 10
    }
  }
];
function main():number {
let CASES:any, CC_TERMS:any, JS:any, PY_COUNT:any, TERMS:any, _:any, _axis:any, _body:any, _c_missing:any, _crlf:any, _crlf_n:any, _fam:any, _fam_n:any, _fb:any, _fb_names:any, _floor:any, _fn:any, _gone:any, _got:any, _lb_literals:any, _live_ran:any, _ls:any, _ls_n:any, _min:any, _needles:any, _only_declared:any, _only_measured:any, _ps:any, _ps_n:any, _skill_raw:any, _t_missing:any, a:any, ab:any, b:any, c:any, d:any, f:any, ja:any, jb:any, js_src:any, label:any, lib_probe:any, ln:any, m_chars:any, m_thr:any, mismatch:any, n:any, nb:any, nbn:any, nbu:any, needle:any, nl_n:any, nl_u:any, node_absent:any, ok:any, out:any, passed:any, probe:any, probe_dir:any, prof:any, py_ok:any, py_src:any, r:any, ref_cc:any, ref_sp:any, skill:any, skill_fm:any, spell_src:any, src_main:any, text:any, u:any, ub:any, x:any;
(_skill_raw=read(join(ROOT, "SKILL.md")));
([skill_fm, skill]=split_frontmatter(_skill_raw));
(spell_src=read(SPELL_JS));
check("Warning: SKILL.md discloses external transmission", (truth((contains(skill, "nara-speller.co.kr"))) && truth((contains(skill, "sends input text")))));
check("Warning: procurement transmission is forbidden by default", (contains(skill, "Do not send procurement proposals")));
check("Warning: upstream exception becomes the default boundary here", (contains(skill, "here they define the default boundary")));
check("Warning: obtain consent", (contains(skill, "obtain consent")));
check("Warning: redact where possible", (contains(skill, "Redact them where possible before sending")));
check("Distinction: table contrasts local and external computation", (truth((contains(skill, "Local and deterministic"))) && truth((contains(skill, "Sends text to an external web service")))));
check("Behavior: webpage imitation is disclosed", (contains(skill, "not an official API")));
for (const [label, needle] of [["User-Agent imitation", "User-Agent"], ["Origin header", "Origin"], ["HTML regex parsing", "regular expressions"]]) {
check(("Behavior: evidence for " + repr(label)), (contains(skill, needle)));
}
check("Behavior: script sets browser headers", (truth((contains(spell_src, "User-Agent"))) && truth((contains(spell_src, "Origin")))));
check('Behavior: script parses HTML with regex',spell_src.includes('extract_result_payload')&&/\/data\\s/.test(spell_src)&&spell_src.includes('fetch('));
(m_chars=search("DEFAULT_MAX_CHARS\\s*=\\s*(\\d+)", spell_src));
(m_thr=search("DEFAULT_THROTTLE_SECONDS\\s*=\\s*([\\d.]+)", spell_src));
check("Behavior: documented chunk size matches code", (truth(truth(m_chars)) && truth((contains(skill, group(m_chars, 1))))), (truth(m_chars) ? group(m_chars, 1) : "missing"));
check("Behavior: documented throttle matches code", (truth(truth(m_thr)) && truth((contains(skill, group(m_thr, 1))))), (truth(m_thr) ? group(m_thr, 1) : "missing"));
(probe_dir=temporaryDirectory());
(probe=join(probe_dir, "_probe_transmission.mjs"));
writeFileSync(probe, "import {pathToFileURL} from 'node:url';\nlet calls=0;globalThis.fetch=async()=>{calls++;throw Error('NET');};\nconst m=await import(pathToFileURL(process.argv[2]).href);let rc;\ntry{rc=await m.main(['--text','가나다',...process.argv.slice(3)]);}catch{rc='EXC';}\nconsole.log('EXIT',rc,'CALLS',calls);\n");
function run_probe(...extra:string[]):string {return runProcess(process.execPath,[probe,SPELL_JS,...extra]).stdout.trim();}
(out=run_probe());
check("Guard: noninteractive calls without consent do not network", (truth((contains(out, "CALLS 0"))) && truth((contains(out, "EXIT 2")))), out);
(lib_probe=join(probe_dir, "_probe_lib.mjs"));
writeFileSync(lib_probe, "import {pathToFileURL} from 'node:url';\nlet calls=0;globalThis.fetch=async()=>{calls++;throw Error('NET');};\nconst m=await import(pathToFileURL(process.argv[2]).href);\nfor(const fn of [()=>m.check_text('대외비'),()=>m.fetch_spell_check_html('대외비')]){try{await fn();}catch{}}\nconsole.log('CALLS',calls);\n");
r=runProcess(process.execPath,[lib_probe,SPELL_JS]);
check("Guard: direct library calls are blocked (check_text/fetch)", (contains(r.stdout, "CALLS 0")), (strip(r.stdout)||slice(r.stderr,-60)));
(out=run_probe("--consent-external-transmission"));
check("Guard: consent permits a transmission attempt", (contains(out, "CALLS 1")), out);
removeTree(probe_dir, {ignore_errors: true});
(src_main=spell_src);
check("Guard: notice reports destination and bytes before transmission", (truth((contains(src_main, "External transmission notice"))) && truth((contains(src_main, "Payload")))));
check("Guard: SKILL.md documents the consent flag", (contains(skill, "--consent-external-transmission")));
check("Guard: library opt-in API is documented", (truth((contains(skill, "allow_external_transmission()"))) && truth((contains(skill, "Otherwise raises ExternalTransmissionDenied")))));
(d=countReport("본 컨소시엄은 요구사항을 충족합니다."));
check("Counting: default profile works", (d !== null));
c=(d?.counts??d)??{};
check("Counting: includes counts with and without whitespace", (truth((contains(c, "characters"))) && truth((contains(c, "characters_without_whitespace")))));
check("Counting: identical input gives identical output", (truth((d !== null)) && truth(isDeepStrictEqual(countReport("본 컨소시엄은 요구사항을 충족합니다."),d))));
(n=countReport("가나다", "neis"));
(u=countReport("가나다", "default"));
nb=n?(n.counts??n).bytes:null;
ub=u?(u.counts??u).bytes:null;
check("Counting: NEIS exists and uses Hangul 3B", (nb === 9), ("neis=" + repr(nb)));
(nl_n=countReport("가나\n다라", "neis"));
(nl_u=countReport("가나\n다라", "default"));
nbn=nl_n?(nl_n.counts??nl_n).bytes:null;
nbu=nl_u?(nl_u.counts??nl_u).bytes:null;
check("Counting: newline distinguishes profiles (NEIS 2B)", (truth((nbn !== null)) && truth((nbu !== null)) && truth((nbn === (nbu + 1)))), ("neis=" + repr(nbn) + " / default=" + repr(nbu)));
(a=countReport("abc", "neis"));
ab=a?(a.counts??a).bytes:null;
check("Counting: NEIS ASCII 1B", (ab === 3), ("ascii=" + repr(ab)));
check("Counting: documents NEIS for public forms", (contains(skill, "NEIS counting")));
check("Counting: warns default can exceed submission limits", (contains(skill, "can still exceed the submission limit")));
check("Boundary: style routes to humanize", (contains(skill, "| Style, AI-tell removal, translationese, excessive passive voice |")));
check("Boundary: layout routes to deck", (contains(skill, "`deck` (layout)")));
check("Chain: humanize → proof → hwpx order and rationale", (truth((contains(skill, "humanize → proof → hwpx"))) && truth((contains(skill, "Rewriting changes length")))));
PY_COUNT=COUNT_JS;
check("Self-contained: canonical Node counter exists", existsSync(PY_COUNT));
(CASES=["한글 abc", "", "가나다\n라마바", "안녕👨‍👩‍👧", "REQ-001 요구사항", "０１２ 전각", "ㄱㄴㄷ", "café", "혼합 mix 混合", "가\r\n나", "첫 줄\r\n둘째 줄🙂", "가\r나", "가 나", "가 나", "\r\n", "가\r\n\r\n나"]);
(py_ok=true);
for(const text of CASES){for(const prof of ['default','neis']){const result=countReport(text,prof);if(result===null){py_ok=false;break;}}}
check(("Self-contained: canonical Node counter completes " + repr(length(CASES)) + " inputs across 2 profiles"), py_ok);
const oracleMismatch:string[]=[];for(const expected of COUNT_ORACLE){for(const profile of ['default','neis'] as const){const actual=countReport(expected.text,profile);if(actual===null||!isDeepStrictEqual(actual.counts,expected[profile]))oracleMismatch.push(`${JSON.stringify(expected.text.slice(0,8))}/${profile}`);}}check('자기검사: deployed counter matches independent fixed expectations for both profiles',oracleMismatch.length===0,`mismatches ${JSON.stringify(oracleMismatch.slice(0,3))}`);
(JS=join(SCRIPTS, "korean_character_count.js"));
(js_src=read(JS));
check("Counter(js): NEIS rules are grapheme-based", (truth((contains(js_src, "Hangul grapheme=3B"))) && truth((contains(js_src, "ASCII grapheme=1B")))));
check("Counter(js): documents UTF-8 fallback", (contains(js_src, "falls back to UTF-8 bytes")), "Without this clause, emoji ZWJ sequences can diverge from Python");
check("Counter(js): emits both profiles (bytes_utf8 / bytes_neis)", (truth((contains(js_src, "bytes_neis"))) && truth((contains(js_src, "bytes_utf8")))));
check("Counter(js): counts graphemes with Intl.Segmenter", (contains(js_src, "Intl.Segmenter")));
check("Provenance: MIT and original skill name are disclosed", (truth((contains(skill, "MIT"))) && truth((contains(skill, "korean-spell-check")))));
check_ref_contracts(check, ROOT, [["spell-check.md", "Transmission policy, service name, chunk size", ["license: MIT", "Bareun Hangul", "1500", "chunks"], 3212], ["character-count.md", "Counting method and NEIS byte rules", ["license: MIT", "Intl.Segmenter", "3B", "1B", "neis"], 2407]], {label_prefix: "출처"});
(ref_cc=read(join(ROOT, "references", "character-count.md")));
(ref_sp=read(join(ROOT, "references", "spell-check.md")));
(TERMS=["noncommercial", "free access only for individuals or students", "robots.txt", "/test_speller/", "user-directed final review", "low-frequency requests", "bulk batches", "SaaS backend", "resale", "a paid API agreement"]);
(_t_missing=Array.from(TERMS).filter((n: any) => truth((!contains(ref_sp, n)))).map((n: any) => (n)));
check("Reference contract: spell-check.md policy density (noncommercial/robots/no resale)", !truth(_t_missing), ("missing " + repr(_t_missing)));
check("Reference contract: spell-check.md explicitly prohibits disallowed uses", (truth((contains(ref_sp, "Do not use it"))) && truth((contains(ref_sp, "provider permission")))));
(CC_TERMS=["empty string => `0`", "Count CRLF as one line break, not two", "Hangul grapheme => 3B", "ASCII grapheme => 1B", "line-break sequence => 2B", "Other characters fall back to UTF-8 byte length", "U+2028, and U+2029 each count as one line break", "Node 18+"]);
(_c_missing=Array.from(CC_TERMS).filter((n: any) => truth((!contains(ref_cc, n)))).map((n: any) => (n)));
check("Reference contract: character-count.md values (empty=0/CRLF=1/Enter=2B/fallback)", !truth(_c_missing), ("missing " + repr(_c_missing)));
for (const [_fn, _body, _needles, _floor] of [["spell-check.md", ref_sp, TERMS, 3065], ["character-count.md", ref_cc, CC_TERMS, 2289]]) {
(_got=content_bytes(_body, _needles));
check(("Reference contract: " + repr(_fn) + " volume (>= " + repr(_floor) + "B, zero slack)"), (_got >= _floor), (repr(_got) + "B"));
}

check("Measured contract: empty string has zero lines", ((_c("")["lines"] ?? null) === 0), ("lines=" + repr((_c("")["lines"] ?? null))));
(_crlf=_c("가\r\n나"));
check("Measured contract: CRLF is one break/grapheme (2 lines/3 characters)", (truth(((_crlf["lines"] ?? null) === 2)) && truth(((_crlf["characters"] ?? null) === 3))), ("lines=" + repr((_crlf["lines"] ?? null)) + " chars=" + repr((_crlf["characters"] ?? null))));
(_crlf_n=_c("가\r\n나", "neis"));
check("Measured contract: Enter/newline is NEIS 2B (3+2+3)", ((_crlf_n["bytes"] ?? null) === 8), ("neis=" + repr((_crlf_n["bytes"] ?? null))));
([_ls, _ps]=[_c("가 나"), _c("가 나")]);
check("Measured contract: U+2028/U+2029 each count as one break", (truth(((_ls["lines"] ?? null) === 2)) && truth(((_ps["lines"] ?? null) === 2))), ("LS=" + repr((_ls["lines"] ?? null)) + " PS=" + repr((_ps["lines"] ?? null))));
([_ls_n, _ps_n]=[_c("가 나", "neis"), _c("가 나", "neis")]);
check("Measured contract: U+2028/U+2029 each use NEIS 2B", (truth(((_ls_n["bytes"] ?? null) === 8)) && truth(((_ps_n["bytes"] ?? null) === 8))), ("LS=" + repr((_ls_n["bytes"] ?? null)) + " PS=" + repr((_ps_n["bytes"] ?? null))));
(_fam="👨‍👩‍👧");
(_fam_n=_c(_fam, "neis"));
check("Measured contract: NEIS falls back to UTF-8 for other characters", (truth(((_fam_n["characters"] ?? null) === 1)) && truth(((_fam_n["bytes"] ?? null) === Buffer.byteLength(_fam,"utf8")))), ("chars=" + repr((_fam_n["characters"] ?? null)) + " neis=" + repr((_fam_n["bytes"] ?? null)) + " utf8=" + repr(Buffer.byteLength(_fam,"utf8"))));
py_src=js_src;
_lb_literals=js_src.match(/const LINE_BREAK_PATTERN\s*=/g)??[];
check('Counter(js): line breaks have one source (LINE_BREAK_PATTERN)',_lb_literals.length===1&&count(js_src,'LINE_BREAK_PATTERN')>=3&&js_src.includes('matchAll(LINE_BREAK_PATTERN)'),`literals=${_lb_literals.length} / references=${count(js_src,'LINE_BREAK_PATTERN')}`);
const breakDeclaration=js_src.split('\n').find((line:string)=>line.includes('const LINE_BREAK_PATTERN'))??'';check('Counter(js): constant contains all five break forms',['\\r\\n','\\n','\\r','\\u2028','\\u2029'].every(form=>breakDeclaration.includes(form)));
// The retired second script's ownership becomes a real input-route contract.
const inputDir=temporaryDirectory();try{const file=join(inputDir,'mixed.txt'),text='가\r\n나🙂';writeFileSync(file,text);const expected=countReport(text,'neis');const fromFile=runProcess(process.execPath,[COUNT_JS,'--file',file,'--profile','neis','--format','json']);const fromStdin=runProcess(process.execPath,[COUNT_JS,'--stdin','--profile','neis','--format','json'],{input:text});let fileReport=null,stdinReport=null;try{fileReport=JSON.parse(fromFile.stdout);stdinReport=JSON.parse(fromStdin.stdout);}catch{}check('Counting: text, file, and stdin routes preserve the same report',expected!==null&&fromFile.status===0&&fromStdin.status===0&&isDeepStrictEqual(fileReport,expected)&&isDeepStrictEqual(stdinReport,expected));}finally{removeTree(inputDir);}
(_min=search("Node\\.js (\\d+) or newer", js_src));
check("Counter(js): requires a numeric minimum Node version", (truth(truth(_min)) && truth((contains(js_src, "Intl.Segmenter is required")))), (truth(_min) ? group(_min, 1) : "missing"));
check("Counter(js): version matches reference requirement", (truth(truth(_min)) && truth((contains(ref_cc, ("Node " + repr(group(_min, 1)) + "+"))))), ("js=" + repr((truth(_min) ? group(_min, 1) : "missing"))));
check_skill_body(check, ROOT, {needles: ["korean_character_count.js", "Character counting", "Spelling check", "procurement"], floor: 4003});
check_no_constant_assertions(check, SUITE_FILE);
(_live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), ["자기검사:", "계약 커버리지:"])))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 28, "references/character-count.md": 6, "references/spell-check.md": 6}, live_ran: _live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 40, extra_strip: ["references/spell-check.md", "references/character-count.md"], live_ran: _live_ran});
// The two old counter files owned floors 7 and 15. The canonical counter
// preserves their sum plus the measured text/file/stdin route contract.
check_script_contracts(check,SUITE_FILE,ROOT,{scripts:{'scripts/korean_character_count.js':23,'scripts/korean_spell_check.js':7},live_ran:_live_ran,extra_skip:['스크립트 계약:']});
if(!in_deleted_run()){
const axis='자기검사: restricted PATH preserves every runtime judgment';
if(process.env.JSTACK_PROOF_PATH_PROBE==='1')check(axis,process.env.PATH===''&&isAbsolute(process.execPath)&&Number(process.versions.node.split('.')[0])>=20,'Known absolute Node executable remains usable without PATH lookup');
else{
const child=runProcess(process.execPath,[SUITE_FILE],{cwd:ROOT,env:{...process.env,PATH:'',FREEZE_REFS:undefined,JSTACK_PROOF_PATH_PROBE:'1'}});
const names=[...child.stdout.matchAll(/^\[(?:PASS|FAIL)\] (.+)$/gm)].map(m=>m[1]);
const environmental=['동결본이 커밋된 문서에서 나왔다','이 커밋돼 있다','동결본이 커밋된 그대로다','헤더의 blob 과 일치한다','가리키는 blob 을 꺼낼 수 있다','동결본이 현재 문서에서 나왔다 (git 밖)','줄 생존율'];
const gone=results.filter(([name])=>!environmental.some(marker=>name.includes(marker))&&!names.some(line=>line===name||line.startsWith(name+' — '))).map(([name])=>name);
check(axis,child.status===0&&gone.length===0,`child rc=${child.status}; missing judgments=${JSON.stringify(gone.slice(0,3))}`);
}}

check_total(check, results, 80);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));

console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((passed === length(results))) ? 0 : 1);
}
process.exitCode=main();
