/**
Calculate export scaling and clamp verdicts, including A3-or-larger exceptions.

Enforces scale = target_width / viewBox_width and the 1–4 clamp in
references/export.md. Upstream justifies the upper limit with an aesthetic
statement about a smaller canvas; this fails for Korean procurement A3 foldouts.

Measurements requiring an exception:
| Page | Target width at 300dpi | Scale from viewBox 1120 | Verdict |
|---|---:|---:|---|
| A4 landscape, 297mm | 3508px | 3.13 | Within clamp |
| A4 landscape at 4x | 4480px | 4.00 | Boundary gives 383dpi, with margin |
| A3 landscape, 420mm | 4961px | 4.43 | Clamp lowers output to 271dpi |

A3 foldouts are a procurement convention; A1 boards are outside this calculation's
scope. An unchanged clamp silently prevents A3 appendix diagrams reaching 300dpi.

Exceptions require font outlining. Either condition lifts the upper limit:
1. A3 or larger (--paper a3 or above).
2. Vector delivery is unavailable (--no-vector). HWP/HWPX effectively blocks SVG
   embedding, forcing raster output; the preferred print route of SVG-to-PDF is
   unavailable in this use case.

Above 4x, hinted text can have inconsistent weight and spacing. Outlining glyphs
removes that inconsistency but also removes translation, search, and editing.
Use outlined output only for final submissions and retain the source SVG.

Limitations:
- Does not open or edit diagrams; only calculates scale and evaluates numeric inputs.
- Does not export or invoke a renderer. repair_png.js separately checks exported
  PNG structure.
- Does not enforce outlining. requiresOutlinedFonts records the requirement, but
  a person must verify compliance.
- Only PAPERS lists known page sizes. Supply other formats with --target-width.

Usage:
    node scripts/export_scale.js --viewbox-width 1120 --target-width 4480
    node scripts/export_scale.js --viewbox-width 1120 --paper a3 --dpi 300
    node scripts/export_scale.js --viewbox-width 1120 --paper a3 --dpi 300 --json
*/
import {isMain,round,g,Row} from '../../../../../runtime/diagram/common.js';
export const MIN_SCALE=1,MAX_SCALE=4,MM_PER_INCH=25.4;
export const PAPERS:Record<string,[number,number]>={letter:[279.4,0],a4:[297,1],a3:[420,2],a2:[594,3],a1:[841,4],a0:[1189,5]};
export const UNLOCK_RANK=PAPERS.a3![1];
export const target_px=(paper:string,dpi:number)=>PAPERS[paper]![0]/MM_PER_INCH*dpi;
export const effective_dpi=(targetWidth:number,paper:string)=>targetWidth/(PAPERS[paper]![0]/MM_PER_INCH);
export function evaluate(viewbox_width:number,target_width:number,options:{paper?:string|null;vector?:boolean}={}):Row{if(!Number.isFinite(viewbox_width)||viewbox_width<=0)throw new Error('viewBox width must be positive');if(!Number.isFinite(target_width))throw new Error('target width must be finite');const paper=options.paper??null,vector=options.vector??true,scale=target_width/viewbox_width,large=paper!==null&&PAPERS[paper]![1]>=UNLOCK_RANK,unlocked=large||!vector,reasons:string[]=[];if(large)reasons.push(`paper ${paper} is A3 or larger`);if(!vector)reasons.push('vector delivery is unavailable (raster path forced)');const rec:Row={scale:round(scale,4),viewBoxWidth:viewbox_width,targetWidth:target_width,paper,clamp:[MIN_SCALE,MAX_SCALE],unlocked,unlockReasons:reasons,requiresOutlinedFonts:unlocked&&scale>MAX_SCALE};if(paper)rec.effectiveDpi=round(effective_dpi(target_width,paper),1);if(scale<MIN_SCALE)Object.assign(rec,{ok:false,verdict:'below-clamp',message:`scale ${g(scale)} is below the 1x floor - the type would be crushed; redraw at a smaller preset instead of shrinking the export (export.md clamp)`});else if(scale<=MAX_SCALE)Object.assign(rec,{ok:true,verdict:'within-clamp',message:`scale ${g(scale)} is within the 1..4 clamp`});else if(unlocked)Object.assign(rec,{ok:true,verdict:'unlocked',message:`scale ${g(scale)} exceeds the 4x ceiling but the ceiling is lifted (${reasons.join('; ')}) - outline the fonts before export and keep the source SVG (export.md A3 exception)`});else Object.assign(rec,{ok:false,verdict:'above-clamp',message:`scale ${g(scale)} exceeds the 4x ceiling on ${paper||'an unstated paper'} with vector delivery available - the ceiling lifts only for A3+ or when vector delivery is impossible; pick a larger size dial instead (export.md clamp)`});return rec;}
export function main(argv:string[]):number{let width:number|undefined,target:number|undefined,paper:string|undefined,dpi=300,vector=true,json=false;for(let i=0;i<argv.length;i++){const flag=argv[i]!;if(flag==='--json'){json=true;continue;}if(flag==='--no-vector'){vector=false;continue;}const value=argv[++i];if(value===undefined)return 2;if(flag==='--paper'){if(!(value in PAPERS))return 2;paper=value;}else{const n=Number(value);if(!Number.isFinite(n))return 2;if(flag==='--viewbox-width')width=n;else if(flag==='--target-width')target=n;else if(flag==='--dpi')dpi=n;else return 2;}}if(width===undefined||target===undefined&&!paper)return 2;try{const rec=evaluate(width,target??target_px(paper!,dpi),{paper,vector});if(json)console.log(JSON.stringify({schemaVersion:1,ok:rec.ok,source:'export-scale',summary:{scale:rec.scale,verdict:rec.verdict,requiresOutlinedFonts:rec.requiresOutlinedFonts},result:rec},null,2));else{console.log(`[${rec.ok?'ok':'FAIL'}] ${rec.message}`);if(rec.effectiveDpi!==undefined)console.log(`  effective ${g(rec.effectiveDpi)} dpi on ${rec.paper}`);if(rec.requiresOutlinedFonts)console.log('  REQUIRED: outline the fonts (glyphs -> paths) before export');}return rec.ok?0:1;}catch(error){console.error((error as Error).message);return 2;}}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
