/**
Postprocess PNG: restore truncated IEND and set DPI through pHYs.

Why this is required:
Some draw.io CLI -e (embed) versions drop the final eight bytes of the IEND chunk.
The file is unreadable despite exit code 0: vision APIs return 400, Hangul viewers
show an empty box, and users waste time diagnosing missing output. This script
addresses the gap between successful exit status and a broken artifact.

Why DPI is handled here:
PNG stores pixels per meter in pHYs, not DPI directly. Without that chunk, Hangul
and Word assume 96dpi and can place an A4 diagram at twice the page size. Exporting
at 300dpi through export_scale.js without writing pHYs discards that calculation.

Excluded operations:
- Does not repair pixels, truncated scanlines, or corrupted IDAT. Checks only
  structure: chunk boundaries, CRC, and IEND.
- Does not overwrite the original unless --in-place is supplied.

Limitations:
- Does not repair pixels. This repeats the exclusion because SKILL.md links here.
- Cannot recover corrupt IDAT compression. Structural repair may still leave the
  image unreadable; re-export is then the only solution.
- No special handling for APNG or interlacing. Chunk checks can report intact
  structure despite broken APNG frame relationships.
- Only adjusts pHYs metadata, leaving iCCP color profiles and gAMA untouched.

Usage:
    node scripts/repair_png.js out.png --dpi 300 -o fixed.png
    node scripts/repair_png.js out.png --check --json
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import {isMain,round,g,pyRepr,Row} from '../../../../../runtime/diagram/common.js';
export const SIG=Buffer.from([137,80,78,71,13,10,26,10]),IEND=Buffer.from('0000000049454e44ae426082','hex'),METERS_PER_INCH=39.3701;
const CRC_TABLE=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;CRC_TABLE[n]=c>>>0;}
export function crc32(bytes:Buffer):number{let value=0xffffffff;for(const byte of bytes)value=CRC_TABLE[(value^byte)&255]!^(value>>>8);return (value^0xffffffff)>>>0;}
export function* chunks(data:Buffer):Generator<[Buffer,Buffer,boolean]>{let i=SIG.length;while(i+8<=data.length){const length=data.readUInt32BE(i),type=data.subarray(i+4,i+8),end=i+12+length;if(end>data.length)return;const payload=data.subarray(i+8,i+8+length),crc=data.readUInt32BE(i+8+length);yield[type,payload,crc===crc32(Buffer.concat([type,payload]))];i=end;}}
export function make_chunk(type:Buffer,payload:Buffer):Buffer{const result=Buffer.alloc(payload.length+12);result.writeUInt32BE(payload.length);type.copy(result,4);payload.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([type,payload])),8+payload.length);return result;}
export function phys_chunk(dpi:number):Buffer{const ppm=round(dpi*METERS_PER_INCH);if(!Number.isSafeInteger(ppm)||ppm<0||ppm>0xffffffff)throw new Error('DPI cannot be represented in PNG pHYs');const payload=Buffer.alloc(9);payload.writeUInt32BE(ppm);payload.writeUInt32BE(ppm,4);payload[8]=1;return make_chunk(Buffer.from('pHYs'),payload);}
export function inspect(data:Buffer):Row{const rec:Row={signature:data.subarray(0,SIG.length).equals(SIG),chunks:[],badCrc:[],hasIend:false,hasPhys:false,dpi:null,trailingBytes:0};if(!rec.signature)return rec;let consumed=SIG.length;for(const[type,payload,ok]of chunks(data)){const name=type.toString('latin1');rec.chunks.push(name);if(!ok)rec.badCrc.push(name);if(name==='IEND')rec.hasIend=true;if(name==='pHYs'&&payload.length===9){const x=payload.readUInt32BE(0),unit=payload[8];rec.hasPhys=true;if(unit===1&&x)rec.dpi=round(x/METERS_PER_INCH,2);}consumed+=12+payload.length;}rec.trailingBytes=data.length-consumed;return rec;}
export function repair(data:Buffer,options:{dpi?:number|null}={}):[Buffer,string[]]{const actions:string[]=[],dpi=options.dpi??null;if(!data.subarray(0,SIG.length).equals(SIG))throw new Error('not a PNG (signature mismatch)');const kept:Buffer[]=[SIG];let sawIend=false;for(const[type,payload,ok]of chunks(data)){const name=type.toString('latin1');if(name==='IEND'){sawIend=true;break;}if(!ok)actions.push(`recomputed CRC for ${name}`);if(name==='pHYs'&&dpi!==null){actions.push('replaced pHYs');continue;}kept.push(make_chunk(type,payload));}if(dpi!==null){kept.push(phys_chunk(dpi));actions.push(`wrote pHYs for ${g(dpi)} dpi`);}kept.push(IEND);if(!sawIend)actions.push('appended the missing IEND chunk');return [Buffer.concat(kept),actions];}
export function main(argv:string[]):number{let png:string|undefined,out:string|undefined,inPlace=false,dpi:number|undefined,check=false,json=false;for(let i=0;i<argv.length;i++){const flag=argv[i]!;if(flag==='--json')json=true;else if(flag==='--check')check=true;else if(flag==='--in-place')inPlace=true;else if(['-o','--out','--dpi'].includes(flag)&&argv[i+1]){const value=argv[++i]!;if(flag==='--dpi'){dpi=Number(value);if(!Number.isFinite(dpi))return 2;}else out=value;}else if(png===undefined&&!flag.startsWith('-'))png=flag;else return 2;}if(png===undefined)return 2;let data:Buffer;try{data=fs.readFileSync(png);}catch(error){console.error(`${png}: cannot read - ${(error as Error).name}: ${(error as Error).message}`);return 1;}const before=inspect(data),broken=!before.signature||!before.hasIend||before.badCrc.length>0;if(check){if(json)console.log(JSON.stringify({schemaVersion:1,ok:!broken,source:'repair-png',summary:before},null,2));else console.log(`[${broken?'broken':'ok'}] ${path.basename(png)}: ${before.chunks.length} chunk(s), IEND ${before.hasIend?'present':'MISSING'}, bad CRC ${before.badCrc.length?pyRepr(before.badCrc):'none'}, dpi ${before.dpi??'None'}`);return broken?1:0;}try{const[fixed,actions]=repair(data,{dpi}),extension=path.extname(png),dest=inPlace?png:out??png.slice(0,extension?-extension.length:undefined)+'.fixed.png';fs.writeFileSync(dest,fixed);const after=inspect(fixed);if(json)console.log(JSON.stringify({schemaVersion:1,ok:after.hasIend,source:'repair-png',summary:{out:dest,actions,before,after}},null,2));else{for(const action of actions)console.log(action);console.log(`Summary: wrote ${dest} (${fixed.length} bytes), IEND ${after.hasIend?'present':'MISSING'}, dpi ${after.dpi??'None'}`);}return after.hasIend?0:1;}catch(error){console.error(`${png}: ${(error as Error).message}`);return 1;}}
if(isMain(import.meta.url))process.exitCode=main(process.argv.slice(2));
