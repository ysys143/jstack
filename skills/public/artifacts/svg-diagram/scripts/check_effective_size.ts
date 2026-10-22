/**
Effective type size: pt at final placement width, not pixels.

references/output-spec.md sets a 12px floor for CJK labels, but pixels are
viewBox units, not physical size until page placement width is specified.

The unresolved upstream contradiction:
Placing print-a4-landscape (0 0 1120 792) across 297mm gives 0.265mm per unit.

| Role | px | mm | Effective pt |
|---|---:|---:|---:|
| CJK name floor | 12 | 3.18 | 9.02 |
| Print-ramp sublabel | 9 | 2.39 | 6.77 |
| Print-ramp arrow label | 8 | 2.12 | 6.01 |

The document prescribes both 12px CJK and 9px print sublabels; all three values
fall below the practical 10pt Korean grayscale laser-print floor. Procurement
diagrams often occupy 60–70% of HWP body width, reducing 9pt to 6pt; use
--hwp-fraction to model that placement.

This checker uses a 10pt floor. It does not replace output-spec.md's 12px floor:
measure both and report which fails separately.

Coverage:
- Reads font-size only from tag attributes, not CSS or inheritance. Unreadable
  size emits text/unmeasurable instead of silently assuming a default, matching
  verify-text-width.js's policy.
- A person supplies placement width through --media or --placed-mm because SVG
  does not store final page width. The default is A4 landscape.

Limitations:
- Measures only; does not edit diagram files.
- Trusts --media/--placed-mm/--hwp-fraction supplied by a person. Wrong placement
  values produce wrong verdicts.
- Reads font-size only from attributes, not CSS, inheritance, or em/% units;
  unreadable values emit text/unmeasurable instead of a default.
- Without viewBox, nothing can be measured: effective pt needs the ratio of page
  width to viewBox width, whose denominator would be missing.
- Does not replace the 12px floor. Passing pixels does not establish an effective-pt pass.

Usage:
    node scripts/check_effective_size.js assets/example-architecture.html
    node scripts/check_effective_size.js --media print-a4 --hwp-fraction 0.65 <file>
    node scripts/check_effective_size.js --all --json
*/
import * as path from 'node:path';
import {isMain,read_text,DecodeError,errorName,nums,lineAt,sliceChars,pyRepr,round,fixed,g,assets,diagnostic,Row} from '../../../../../runtime/diagram/common.js';
export {diagnostic};
export const MM_PER_INCH=25.4,PT_PER_INCH=72,MIN_EFFECTIVE_PT=10;
export const MEDIA:Record<string,number>={'print-a4':297,'print-a4-portrait':210,'print-a3':420,'print-letter':279.4};
export function attrs_of(tag:string):Record<string,string>{return Object.fromEntries([...tag.matchAll(/([a-zA-Z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1]!,m[2]||m[3]||'']));}
export function viewbox_width(source:string):number|null{const match=/viewBox\s*=\s*["']([^"']+)["']/i.exec(source);if(!match)return null;const values=nums(match[1]!);return values.length>=4&&values[2]!>0?values[2]!:null;}
export const effective_pt=(px:number,viewbox_w:number,placed_mm:number,fraction=1)=>px*(placed_mm*fraction/viewbox_w)/MM_PER_INCH*PT_PER_INCH;
export function check(file:string,options:{placed_mm:number;fraction:number;floor_pt?:number}):[Row[],Row]{const name=path.basename(file),{placed_mm,fraction}=options,floor_pt=options.floor_pt??MIN_EFFECTIVE_PT;let source:string;try{source=read_text(file);}catch(error){const decode=error instanceof DecodeError,reason=errorName(error);return [[diagnostic(decode?'input/decode':'input/read',`${name}: ${decode?'not valid UTF-8':'cannot read file'} - ${reason}: ${(error as Error).message}`,{file:name,path:file},{reason})],{}];}const vb=viewbox_width(source);if(vb===null)return [[diagnostic('input/no-viewbox',`${name}: no readable viewBox width - the effective point size cannot be derived from px`,{file:name})],{}];const findings:Row[]=[];let texts=0,measured=0,below=0,smallest:number|null=null;for(const m of source.matchAll(/<text\b([^>]*)>(.*?)<\/text>/gis)){texts++;const attrs=attrs_of('<text '+m[1]+'>'),line=lineAt(source,m.index!),label=m[2]!.replace(/<[^>]+>/g,'').trim(),values=attrs['font-size']?nums(attrs['font-size']):[],px=values[0]??null;if(px===null){findings.push(diagnostic('text/unmeasurable',`${name}:${line}: <text> ${pyRepr(sliceChars(label,24))} has no readable font-size attribute - refusing to assume a default; the effective point size is unknown`,{file:name,line},{attributes:Object.keys(attrs).sort()},'warning'));continue;}measured++;const pt=effective_pt(px,vb,placed_mm,fraction);if(smallest===null||pt<smallest)smallest=pt;if(pt+1e-9<floor_pt){below++;findings.push(diagnostic('text/effective-size',`${name}:${line}: ${pyRepr(sliceChars(label,24))} is ${g(px)}px = ${fixed(pt,2)}pt at ${g(placed_mm)}mm x ${g(fraction)} placement - below the ${g(floor_pt)}pt floor for Korean black-and-white print (output-spec.md 12px is a viewBox unit, not a physical size); enlarge the type or widen the placement`,{file:name,line,label:sliceChars(label,60)},{px,pt:round(pt,4),floorPt:floor_pt,viewBoxWidth:vb,placedMm:placed_mm,fraction}));}}const summary={file:name,viewBoxWidth:vb,texts,measured,below,smallestPt:smallest===null?null:round(smallest,4),mmPerUnit:round(placed_mm*fraction/vb,6)};if(!measured&&texts)findings.push(diagnostic('input/no-measurable-text',`${name}: ${texts} <text> element(s) but none carried a readable font-size - the effective size was not measured at all`,{file:name},{texts}));return [findings,summary];}
export function main(argv:string[]):number{const files:string[]=[];let all=false,json=false,media='print-a4',placed:number|undefined,fraction=1,floor=MIN_EFFECTIVE_PT;for(let i=0;i<argv.length;i++){const arg=argv[i]!;if(arg==='--all')all=true;else if(arg==='--json')json=true;else if(['--media','--placed-mm','--hwp-fraction','--floor-pt'].includes(arg)&&argv[i+1]){const value=argv[++i]!;if(arg==='--media'){if(!(value in MEDIA))return 2;media=value;}else{const n=Number(value);if(!Number.isFinite(n))return 2;if(arg==='--placed-mm')placed=n;else if(arg==='--hwp-fraction')fraction=n;else floor=n;}}else if(arg.startsWith('--'))return 2;else files.push(arg);}const targets=all?assets():files;if(!targets.length){console.error('pass one or more files, or --all');return 2;}placed=placed??MEDIA[media]!;const findings:Row[]=[],perFile:Row={};for(const file of targets){const[got,summary]=check(file,{placed_mm:placed,fraction,floor_pt:floor});findings.push(...got);if(Object.keys(summary).length)perFile[path.basename(file)]=summary;}const errors=findings.filter(row=>row.severity==='error');if(json)console.log(JSON.stringify({schemaVersion:1,ok:!errors.length,source:'check-effective-size',summary:{files:targets.length,findings:findings.length,floorPt:floor,placedMm:placed,fraction,perFile},diagnostics:findings},null,2));else{for(const row of findings)console.log(row.message);console.log(`Summary: ${targets.length} file(s) at ${g(placed)}mm x ${g(fraction)}, ${findings.length} finding(s), measured ${Object.values(perFile).reduce((n,row)=>n+row.measured,0)} of ${Object.values(perFile).reduce((n,row)=>n+row.texts,0)} label(s).`);}return errors.length?1:0;}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
