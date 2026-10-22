/**
Check label width, counting CJK as two units and detecting container overflow.

Coefficients are provisional. ASCII 0.6em comes from upstream nodeTextFit.widthFactor
for Geist; full-width 1.0em comes from references/output-spec.md. Actual advances
have not been measured with Apple SD Gothic Neo or Noto Sans KR, so small Korean
overruns may be missed. SKILL.md discloses this limitation as well.

Ported and divergent behavior:
Rewrites textUnits() in renderers/shared/utils.mjs and nodeTextFit in
renderers/shared/text-fit.mjs from up:archify (MIT, https://github.com/tt-a1i/archify).
text_units() preserves the FULLWIDTH ranges and variation selectors exactly:
VS15 counts as one unit and VS16 as two.

The width formula deliberately diverges. Enforcing upstream's mask-width guidance
of approximately 6.5px * ASCII units + 13px flags eight of 11 masks in
example-architecture.html: RESP 39 > 32, READ MDX 65 > 60, QUERY 45.5 > 44,
EXT/CMS 32.5 > 28, EDGE/ORIG 39 > 32, CONTENT 58.5 > 52. At widthFactor 0.6,
6.5px/unit assumes a 10.8px font; our labels use 7–8px, creating 20–40%
overestimates. Enforce a font-size-scaled model and retain the empirical formula
only as authoring guidance in documentation and finding evidence.

    advance = fs * (0.6 * ascii_units + 1.0 * fullwidth_chars)
              + ls_em * fs * max(0, n_chars - 1)

Count letter-spacing across n−1 gaps, excluding trailing space. Without that
correction, DEPLOY TRIGGER in example-swimlane.html falsely fails at −0.6px.
Use full-width 1.0em, not upstream's converted 0.6 * 2 = 1.2em, following
output-spec.md and Korean fallback full-width advances. The more permissive
coefficient is safer against false positives.

Container selection: abandon height heuristics.
Earlier code classified 8≤h≤14 as masks and h≥40 as nodes, causing two defects:
- A 16px zone-mask fell outside the range and paired its label with a 696px zone
  rectangle, passing 1.4x overflow (present in example-dp-integration.html).
- Required 12px CJK labels needed masks taller than 14px, classifying as neither
  masks nor nodes and silently disappearing without findings or unmeasurable status.

Now use the smallest rectangle by area containing the anchor. Exclude only
background rectangles (percentage dimensions or at least 90% of viewBox area)
and rectangles inside defs, pattern, marker, symbol, clipPath, or mask. A label
mask naturally wins as the smallest enclosing box without a height range.

Respect text-anchor:
Comparing advance only with box width allowed a start-anchored label protruding
150px past the right edge to pass and count as measured. Compute left/right
extents: start [x,x+adv], middle [x−adv/2,x+adv/2], end [x−adv,x], and compare
with the container edges.

Coordinate systems:
Grouping nodes with g transform="translate(...)" is standard SVG. Earlier code
marked all such text unmeasurable, a parser defect on valid syntax. Accumulate
ancestor translations into one absolute coordinate system for rectangles and text.
Inherit font-size, letter-spacing, and text-anchor from ancestors too.
Unsupported rotate, scale, matrix, or skew transforms cannot be compared with
axis-aligned boxes; emit text/out-of-scope warnings rather than silently omit them.

Do not silence parsing failures:
If size cannot be found in attributes, style, or CSS, emit text/unmeasurable (error)
rather than assuming 12px. Assets use all three forms: font-size="8", class font
shorthand (.node-name{font:600 12px var(--sans)}), and element selectors
(svg text{font-size:12px}). Reading only class selectors formerly rejected valid
SVG using element selectors. tspan children and textLength require a different
layout model and emit text/out-of-scope warnings; neither occurs in current assets.

The --json summary reports actual coverage through labels/texts and skipped details.
Those counts distinguish zero overflows from a parser that never reached the content.

Usage:
    node scripts/verify-text-width.js assets/example-*.html
    node scripts/verify-text-width.js --all
    node scripts/verify-text-width.js --all --json
*/
import * as path from 'node:path';
import {isMain,read_text,DecodeError,errorName,number as _f,lineAt,sliceChars,pyRepr,round,fixed,g,assets,unescapeHtml,Row} from '../../../../../runtime/diagram/common.js';
export {_f};
export const FULLWIDTH_RANGES = [[4352, 4447], [8986, 8987], [9001, 9002], [9193, 9196], [9200, 9200], [9203, 9203], [9725, 9726], [9748, 9749], [9776, 9783], [9800, 9811], [9855, 9855], [9866, 9871], [9875, 9875], [9889, 9889], [9898, 9899], [9917, 9918], [9924, 9925], [9934, 9934], [9940, 9940], [9962, 9962], [9970, 9971], [9973, 9973], [9978, 9978], [9981, 9981], [9989, 9989], [9994, 9995], [10024, 10024], [10060, 10060], [10062, 10062], [10067, 10069], [10071, 10071], [10133, 10135], [10160, 10160], [10175, 10175], [11035, 11036], [11088, 11088], [11093, 11093], [11904, 42191], [43360, 43388], [44032, 55203], [63744, 64255], [65040, 65049], [65072, 65135], [65281, 65376], [65504, 65510], [94176, 101887], [110576, 110591], [110592, 111359], [126976, 129791], [131072, 262141]];
export const VARIATION_SELECTOR_FIRST = 65024;
export const VARIATION_SELECTOR_LAST = 65039;
export const VARIATION_SELECTOR_TEXT = 65038;
export const VARIATION_SELECTOR_EMOJI = 65039;
export const ASCII_EM = 0.6;
export const FULLWIDTH_EM = 1.0;
export const SLACK_PX = 4.0;
export const UPSTREAM_RULE_OF_THUMB = "6.5*asciiUnits+13";
export const BACKGROUND_AREA_RATIO = 0.9;
export const EPS = 0.01;
export const ROOT_FRAME = {"font_size": null, "font_size_source": null, "ls": null, "anchor": "start", "tx": 0.0, "ty": 0.0, "transform_ok": true, "skip": false};
export const REPAIR_STEPS = [["shorten", "Shorten the label to the briefest wording within the width budget"], ["widen", "Widen the container (mask or node)"], ["resize", "Reduce font size, staying above the output-spec.md minimum; hiding overflow through typography reduction violates the taste gate"], ["restructure", "Split the label into two elements or change the layout"], ["delete", "Last resort: record evidence that the label is unnecessary before deleting it"]];
export const is_fullwidth=(ch:string)=>FULLWIDTH_RANGES.some(([lo,hi])=>ch.codePointAt(0)!>=lo!&&ch.codePointAt(0)!<=hi!);
export function measure(text:string):[number,number,number,number]{const chars=[...text];let units=0,ascii=0,fw=0,n=0;for(let i=0;i<chars.length;i++){const ch=chars[i]!,cp=ch.codePointAt(0)!;if(cp>=VARIATION_SELECTOR_FIRST&&cp<=VARIATION_SELECTOR_LAST)continue;const next=chars[i+1]?.codePointAt(0)??-1;n++;if(next===VARIATION_SELECTOR_EMOJI){units+=2;fw++;}else if(next===VARIATION_SELECTOR_TEXT){units++;ascii++;}else if(is_fullwidth(ch)){units+=2;fw++;}else{units++;ascii++;}}return [units,ascii,fw,n];}
export const text_units=(text:string)=>measure(text)[0];
export function advance(text:string,font_size:number,ls_em:number):number{const[,ascii,fw,n]=measure(text);return font_size*(ASCII_EM*ascii+FULLWIDTH_EM*fw)+ls_em*font_size*Math.max(0,n-1);}
export const extents=(x:number,adv:number,anchor:string):[number,number]=>anchor==='middle'?[x-adv/2,x+adv/2]:anchor==='end'?[x-adv,x]:[x,x+adv];
const FONT_SIZE_RE=/(?:^|[;\s])font-size\s*:\s*([\d.]+)px/i,FONT_SHORTHAND_RE=/(?:^|[;\s])font\s*:\s*[^;}]*?([\d.]+)px/i,LETTER_SPACING_RE=/(?:^|[;\s])letter-spacing\s*:\s*(-?[\d.]+)(em|px)/i,TEXT_ANCHOR_RE=/(?:^|[;\s])text-anchor\s*:\s*(start|middle|end)/i;
export const SKIP_TAGS=new Set(['defs','pattern','marker','symbol','clippath','mask','filter','lineargradient','radialgradient','style','script','title','desc','metadata']);
export const VOID_TAGS=new Set(['rect','line','path','circle','ellipse','polygon','polyline','use','image','stop','br','meta','link','img','input','hr','source']);
export const ANCHORS=['start','middle','end'];
export function attrs_of(raw:string):Record<string,string>{return Object.fromEntries([...raw.matchAll(/([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1]!.toLowerCase(),m[2]||m[3]||'']));}
export function blank_out(source:string):string{let value=source.replace(/<!--.*?-->/gs,match=>match.replace(/[^\n]/g,' '));for(const tag of ['style','script'])value=value.replace(new RegExp(`(<${tag}\\b[^>]*>)(.*?)(</${tag}\\s*>)`,'gis'),(_,open,body,close)=>open+body.replace(/[^\n]/g,' ')+close);return value;}
export function parse_translate(value:string):[number,number]|null{const body=value.trim();if(!body)return [0,0];let dx=0,dy=0,seen=0;for(const match of body.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)){seen++;if(match[1]!.toLowerCase()!=='translate')return null;const nums=match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(_f);if(!nums.length||nums.length>2||nums.some(v=>v===null))return null;dx+=nums[0]!;dy+=nums[1]??0;}return seen?[dx,dy]:null;}
export function parse_css(source:string):Row{const out:Row={class:{},type:{}};for(const block of source.matchAll(/<style[^>]*>(.*?)<\/style>/gis))for(const match of block[1]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)){const fs=FONT_SIZE_RE.exec(match[2]!)??FONT_SHORTHAND_RE.exec(match[2]!),ls=LETTER_SPACING_RE.exec(match[2]!),ta=TEXT_ANCHOR_RE.exec(match[2]!);if(!fs&&!ls&&!ta)continue;for(const selector of match[1]!.split(',')){const one=selector.trim();if(!one||one.startsWith('@'))continue;const last=one.split(/[\s>+~]+/).at(-1)!,classes=[...last.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m=>m[1]!),el=/^([A-Za-z][\w-]*)/.exec(last),targets=classes.length?[['class',classes.at(-1)!]]:el?[['type',el[1]!.toLowerCase()]]:[];for(const[kind,name]of targets){const slot=out[kind!]![name!]??={};if(fs)slot.font_size=Number(fs[1]);if(ls)slot.ls=[Number(ls[1]),ls[2]!.toLowerCase()];if(ta)slot.anchor=ta[1]!.toLowerCase();}}}return out;}
export function css_lookup(css:Row,tag:string,classes:string[],key:string):[any,string|null]{for(const c of [...classes].reverse()){const rule=css.class[c];if(rule&&key in rule)return [rule[key],`css:.${c}`];}const rule=css.type[tag];return rule&&key in rule?[rule[key],`css:${tag}`]:[null,null];}
export function resolve_props(tag:string,attrs:Row,css:Row,parent:Row):Row{const classes=(attrs.class??'').trim().split(/\s+/).filter(Boolean),style=attrs.style??'';let fs:number|null=null,src:string|null=null;if('font-size'in attrs){fs=_f(attrs['font-size'].trim().replace(/[px]+$/,'').trim());src='attribute';}if(fs===null&&style){const m=FONT_SIZE_RE.exec(';'+style)??FONT_SHORTHAND_RE.exec(';'+style);if(m){fs=Number(m[1]);src='style';}}if(fs===null)[fs,src]=css_lookup(css,tag,classes,'font_size');if(fs===null){fs=parent.font_size;src=parent.font_size_source;}const ls=attrs['letter-spacing'];let pair:any=null;if(ls){const m=/^\s*(-?[\d.]+)(em|px)?\s*$/.exec(ls);if(m)pair=[Number(m[1]),(m[2]??'px').toLowerCase()];}if(pair===null&&style){const m=LETTER_SPACING_RE.exec(';'+style);if(m)pair=[Number(m[1]),m[2]!.toLowerCase()];}if(pair===null)[pair]=css_lookup(css,tag,classes,'ls');if(pair===null)pair=parent.ls;let anchor=(attrs['text-anchor']??'').trim().toLowerCase();if(!ANCHORS.includes(anchor))anchor='';if(!anchor&&style){const m=TEXT_ANCHOR_RE.exec(';'+style);if(m)anchor=m[1]!.toLowerCase();}if(!anchor){const[got]=css_lookup(css,tag,classes,'anchor');anchor=got||parent.anchor;}return {font_size:fs,font_size_source:src,ls:pair,anchor};}
export function walk(source:string,css:Row):[Row[],Row[]]{const rects:Row[]=[],texts:Row[]=[],stack:Row[]=[{...ROOT_FRAME}];let skipTo=0;for(const m of source.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:'[^']*'|"[^"]*"|[^>'"])*)(\/?)>/gs)){if(m.index!<skipTo)continue;const closing=m[1],tag=m[2]!.toLowerCase(),raw=m[3]!,selfClosing=m[4];if(closing){if(stack.length>1)stack.pop();continue;}const attrs=attrs_of(raw),parent=stack.at(-1)!,frame=resolve_props(tag,attrs,css,parent);frame.skip=parent.skip||SKIP_TAGS.has(tag);const tr='transform'in attrs?parse_translate(attrs.transform!):[0,0];frame.transform_ok=parent.transform_ok&&tr!==null;frame.tx=parent.tx+(tr?.[0]??0);frame.ty=parent.ty+(tr?.[1]??0);const line=lineAt(source,m.index!),end=m.index!+m[0].length;if(tag==='text'&&!frame.skip){const close=/<\/text\s*>/i.exec(source.slice(end)),inner=close?source.slice(end,end+close.index):source.slice(end);if(close)skipTo=end+close.index+close[0].length;const label=unescapeHtml(inner.replace(/\s+/g,' ')).trim(),x=_f(attrs.x??'0'),y=_f(attrs.y??'0');texts.push({label,line,attrs,x:x===null?null:x+frame.tx,y:y===null?null:y+frame.ty,font_size:frame.font_size,font_size_source:frame.font_size_source,ls:frame.ls,anchor:frame.anchor,transform_ok:frame.transform_ok,has_tspan:inner.toLowerCase().includes('<tspan'),has_text_length:'textlength'in attrs});continue;}if(tag==='rect'&&!frame.skip&&frame.transform_ok){const w=_f(attrs.width),h=_f(attrs.height),x=_f(attrs.x??'0'),y=_f(attrs.y??'0'),pct=(attrs.width??'').includes('%')||(attrs.height??'').includes('%');if(!pct&&x!==null&&y!==null&&w!==null&&h!==null&&w>0&&h>0)rects.push({x:x+frame.tx,y:y+frame.ty,w,h,line});}if(!selfClosing&&!VOID_TAGS.has(tag))stack.push(frame);}return [rects,texts];}
export function viewbox_area(source:string):number|null{const m=/<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i.exec(source);if(!m)return null;const nums=m[1]!.trim().split(/[\s,]+/).filter(Boolean).map(_f);if(nums.length!==4||nums.some(v=>v===null))return null;return Math.abs(nums[2]!*nums[3]!)||null;}
export const supported_fixes=()=>REPAIR_STEPS.map(([action,description],index)=>({order:index+1,action,description,requiresEvidence:action==='delete'}));
export function diagnostic(code:string,message:string,subject:Row,evidence:Row,severity='error'):Row{return {code,severity,message,subject,evidence,supportedFixes:code==='text/overflow'?supported_fixes():[]};}
export const empty_stats=():Row=>({texts:0,measured:0,noContainer:0,unmeasurable:0,outOfScope:0});
export function check(file:string):[Row[],Row]{const stats=empty_stats(),name=path.basename(file);let source:string;try{source=read_text(file);}catch(error){if(error instanceof DecodeError)return [[diagnostic('input/decode',`${name}: not valid UTF-8 at byte ${error.start} - ${error.reason}; re-save the file as UTF-8`,{file:name,path:file},{reason:error.reason,encoding:error.encoding,byteOffset:error.start})],stats];const reason=errorName(error);return [[diagnostic('input/read',`${name}: cannot read file - ${reason}: ${(error as Error).message}`,{file:name,path:file},{errno:(error as NodeJS.ErrnoException).errno??null,reason})],stats];}const css=parse_css(source),[rects,texts]=walk(blank_out(source),css),vb=viewbox_area(source),containers=rects.filter(r=>vb===null||r.w*r.h<BACKGROUND_AREA_RATIO*vb),findings:Row[]=[];
  for(const t of texts){if(!t.label)continue;stats.texts++;const label=t.label,line=t.line,attrs=t.attrs;let scope:string|null=null;if(t.has_tspan)scope='<tspan> child';else if(t.has_text_length)scope='textLength attribute';else if(!t.transform_ok)scope='non-translate transform (rotate/scale/matrix) on an ancestor or on <text>';if(scope!==null){stats.outOfScope++;findings.push(diagnostic('text/out-of-scope',`${name}:${line}: label ${pyRepr(sliceChars(label,40))} is outside this checker's model - ${scope}; it was NOT measured`,{file:name,line,label},{reason:scope,class:attrs.class??null,units:text_units(label)},'warning'));continue;}const fs=t.font_size;if(fs===null){stats.unmeasurable++;findings.push(diagnostic('text/unmeasurable',`${name}:${line}: label ${pyRepr(sliceChars(label,40))} cannot be measured - no font-size in attribute, style, CSS class, CSS element rule, or any ancestor (${attrs.class||'no class'})`,{file:name,line,label},{reason:'no font-size',class:attrs.class??null,units:text_units(label)}));continue;}const x=t.x,y=t.y;if(x===null||y===null){stats.unmeasurable++;findings.push(diagnostic('text/unmeasurable',`${name}:${line}: label ${pyRepr(sliceChars(label,40))} cannot be measured - x/y is not a plain number`,{file:name,line,label},{reason:'non-numeric x/y',x:attrs.x??null,y:attrs.y??null}));continue;}const pool=containers.filter(r=>r.x-EPS<=x&&x<=r.x+r.w+EPS&&r.y-EPS<=y&&y<=r.y+r.h+EPS);if(!pool.length){stats.noContainer++;continue;}const box=pool.reduce((a,b)=>a.w*a.h<=b.w*b.h?a:b);stats.measured++;const[lsValue,lsUnit]=t.ls??[0,'em'],lsEm=lsUnit==='em'?lsValue:fs?lsValue/fs:0,adv=advance(label,fs,lsEm),[left,right]=extents(x,adv,t.anchor),overLeft=box.x-SLACK_PX-left,overRight=right-(box.x+box.w+SLACK_PX);if(overLeft>0||overRight>0){const[units,ascii,fw]=measure(label),side=overLeft>=overRight?'left':'right';findings.push(diagnostic('text/overflow',`${name}:${line}: label ${pyRepr(label)} needs ${fixed(adv,1)}px and spans [${fixed(left,1)}, ${fixed(right,1)}] (anchor ${t.anchor}) but its container is [${g(box.x)}, ${g(box.x+box.w)}] (slack ${g(SLACK_PX)}px) - exceeds the output-spec.md width budget`,{file:name,line,label},{units,asciiUnits:ascii,fullwidthChars:fw,fontSize:fs,letterSpacingEm:lsEm,fontSizeSource:t.font_size_source,advancePx:round(adv,2),anchor:t.anchor,labelLeft:round(left,2),labelRight:round(right,2),containerX:box.x,containerWidth:box.w,containerLine:box.line,overflowSide:side,overflowPx:round(Math.max(overLeft,overRight),2),slackPx:SLACK_PX,upstreamRuleOfThumb:UPSTREAM_RULE_OF_THUMB}));}}
  if(stats.measured===0&&stats.texts>0&&containers.length)findings.push(diagnostic('text/no-pairings',`${name}: ${stats.texts} <text> and ${containers.length} container rect(s) found but zero pairings - no label's anchor point fell inside any container, so nothing was measured; 0 overflow finding here proves nothing`,{file:name},{texts:stats.texts,containers:containers.length,noContainer:stats.noContainer,unmeasurable:stats.unmeasurable,outOfScope:stats.outOfScope},'warning'));return [findings,stats];
}
export function main(argv:string[]):number{let all=false,json=false;const files:string[]=[];for(const arg of argv){if(arg==='--all')all=true;else if(arg==='--json')json=true;else if(arg.startsWith('--'))return 2;else files.push(arg);}const targets=all?assets():files;if(!targets.length){console.error('pass one or more files, or --all');return 2;}const findings:Row[]=[],total=empty_stats(),perFile:Row={};for(const file of targets){const[got,stats]=check(file);findings.push(...got);for(const[key,value]of Object.entries(stats))total[key]+=value;perFile[path.basename(file)]=stats;}const errors=findings.filter(row=>row.severity==='error');if(json)console.log(JSON.stringify({schemaVersion:1,ok:!errors.length,source:'verify-text-width',summary:{files:targets.length,findings:findings.length,labels:total.measured,texts:total.texts,skipped:{noContainer:total.noContainer,unmeasurable:total.unmeasurable,outOfScope:total.outOfScope},perFile},diagnostics:findings},null,2));else{for(const row of findings)console.log(row.message);console.log(`Summary: ${targets.length} file(s) checked, ${findings.length} finding(s), measured ${total.measured} of ${total.texts} label(s) (${total.noContainer} without a container, ${total.unmeasurable} unmeasurable, ${total.outOfScope} out of scope).`);}return errors.length?1:0;}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
