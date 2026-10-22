/**
Arrow-label width caps measured in em, not character counts.

Upstream up:diagram-design section 6 requires <=14 characters, all-caps. Both
parts fail for this use case.

1. A character-count cap produces a 1.8x width difference for Korean: 14 Korean
   characters occupy 14em, versus about 7.7em for 14 Latin characters. The same
   count therefore invalidates fixed mask widths such as width="36" for one script.
2. Uppercase is undefined for Korean. This checker does not pretend to measure it:
   treating every Korean label as either passing or failing would add no information.

Mixed-script weights (references/cjk-contract.md, item 19):

| Character class | Weight | Rationale |
|---|---|---|
| Full-width Korean, Han, kana, symbols | 1.00em | Noto Sans KR, Apple SD Gothic Neo, and Malgun Gothic use 1000/1000 upm advances |
| Whitespace | 0.25em | Counting a space as 1em incorrectly gives it a Korean character's width |
| ASCII Latin, digits, symbols | 0.55em | Reproduces 14 Latin characters = 7.7em |
| Other characters | 0.55em | Treat non-wide Latin extensions and Cyrillic as narrow |

Applying one em per full-width character to an entire string is the defect.
It is valid for one Korean syllable but overestimates mixed strings by 20–25%,
creating oversized masks that can violate rule 6. This is a case where a
conservative overestimate is not safer.

Default cap: 14em, interpreting upstream's 14-character limit in Korean em.
Exactly 14 Korean characters reach the cap; 14 Latin characters use just over
half. Override with --cap.

Limitations:
- Does not edit or open diagram files or discover labels. A person selects the
  string; the script measures em width and compares it with the cap.
- Coefficients are a model, not measured font data. EM_WIDE/EM_NARROW/EM_SPACE
  were not verified by reading advances from Noto Sans KR or Apple SD Gothic Neo
  font files. Small overruns may be missed.
- Does not account for letter-spacing or word-spacing set through SVG attributes.
  verify-text-width.js handles the broader SVG width model.
- Cannot measure vertical writing (cjk-contract.md). verify-connectors.js
  --strict-rules emits taste/writing-mode for that condition.

Usage:
    node scripts/measure_label.js "인증 서비스 게이트웨이"
    node scripts/measure_label.js --json "READ MDX" "인증 서비스"
    node scripts/measure_label.js --cap 10 --font-size 8 "QUERY"
*/
import {WIDE_RANGES,COMBINING_RANGES} from '../../../../../runtime/diagram/unicode-data.js';
import {isMain,PY_SPACE,chars,round,g,pyRepr,diagnostic as envelope,Row} from '../../../../../runtime/diagram/common.js';
export const DEFAULT_CAP_EM=14,EM_SPACE=.25,EM_WIDE=1,EM_NARROW=.55;
const includes=(ch:string,ranges:number[][])=>{const cp=ch.codePointAt(0)!;let low=0,high=ranges.length-1;while(low<=high){const mid=(low+high)>>1,[start,end]=ranges[mid]!;if(cp<start!)high=mid-1;else if(cp>end!)low=mid+1;else return true;}return false;};
export function char_em(ch:string):number{if(PY_SPACE.test(ch))return EM_SPACE;if(includes(ch,WIDE_RANGES))return EM_WIDE;if(includes(ch,COMBINING_RANGES))return 0;return EM_NARROW;}
export const measure_em=(text:string)=>chars(text).reduce((sum,ch)=>sum+char_em(ch),0);
export function breakdown(text:string):Row{const cp=chars(text),wide=cp.filter(ch=>!PY_SPACE.test(ch)&&includes(ch,WIDE_RANGES)).length,space=cp.filter(ch=>PY_SPACE.test(ch)).length,combining=cp.filter(ch=>includes(ch,COMBINING_RANGES)).length;return {wide,space,combining,narrow:cp.length-wide-space-combining};}
export function measure(text:string,options:{cap?:number;font_size?:number|null}={}):Row{const cap=options.cap??DEFAULT_CAP_EM,em=measure_em(text),rec:Row={text,chars:chars(text).length,em:round(em,4),cap,over:em>cap,breakdown:breakdown(text)};if(options.font_size!==undefined&&options.font_size!==null){rec.fontSize=options.font_size;rec.px=round(em*options.font_size,3);}return rec;}
export function diagnostic(rec:Row):Row{return envelope('label/em-cap',`${pyRepr(rec.text)}: ${g(rec.em)}em exceeds the ${g(rec.cap)}em arrow-label cap (${rec.chars} chars; wide=${rec.breakdown.wide} narrow=${rec.breakdown.narrow} space=${rec.breakdown.space}) - shorten the label or widen the mask; do not shrink the type`,{label:rec.text},{em:rec.em,cap:rec.cap,breakdown:rec.breakdown});}
export function main(argv:string[]):number{let cap=DEFAULT_CAP_EM,font_size:number|undefined,json=false;const labels:string[]=[];for(let i=0;i<argv.length;i++){const arg=argv[i]!;if(arg==='--json')json=true;else if(['--cap','--font-size'].includes(arg)&&argv[i+1]){const n=Number(argv[++i]);if(!Number.isFinite(n))return 2;if(arg==='--cap')cap=n;else font_size=n;}else if(arg==='--'){labels.push(...argv.slice(i+1));break;}else if(arg.startsWith('--'))return 2;else labels.push(arg);}if(!labels.length){console.error('pass one or more labels');return 2;}const recs=labels.map(text=>measure(text,{cap,font_size})),over=recs.filter(rec=>rec.over);if(json)console.log(JSON.stringify({schemaVersion:1,ok:!over.length,source:'measure-label',summary:{labels:recs.length,over:over.length,cap},measurements:recs,diagnostics:over.map(diagnostic)},null,2));else{for(const r of recs)console.log(`[${r.over?'OVER':'ok'}] ${pyRepr(r.text)}: ${g(r.em)}em${r.px!==undefined?' = '+g(r.px)+'px':''} (chars ${r.chars}, cap ${g(r.cap)}em)`);console.log(`Summary: ${recs.length} label(s) measured, ${over.length} over cap.`);}return over.length?1:0;}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
