import { isMain } from '../../../../../runtime/entry.js';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
/** Registration: {"matcher":"Bash|Read|Write|Edit"} */
const HH = 'http://www.hancom.co.kr/hwpml/2011/head';
const REQUIRED = ['Contents/header.xml', 'Contents/section0.xml'];
const OWN_TOOLS = ['md_to_hwpx.py','validate_hwpx.py','build_hwpx.py','analyze_template.py','batch_convert.py','text_extract.py','fix_borders.py','sanitize_template.py','ensure_hwpx.sh'].flatMap(name=>[name,name.replace(/\.(?:py|sh)$/,'.js')]);
export function candidatePaths(input: Record<string, unknown>): string[] {
    const blob = Object.values(input).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
    return [...new Set([...blob.matchAll(/[^\s"'`<>|]+\.hwpx/g)].map(match => match[0]))];
}
export function borderedCharPr(xml: Uint8Array): number {
    const errors: string[] = [];
    const document = new DOMParser({onError: (_level, message) => { errors.push(message); }}).parseFromString(Buffer.from(xml).toString('utf8'),'application/xml');
    if (errors.length) throw Error('Cannot parse HWPX header XML');
    const bad = new Set<string>();
    const fills = document.getElementsByTagNameNS(HH,'borderFill');
    for (let index=0; index<fills.length; index++) {
        const fill = fills.item(index)!;
        if (!fill.hasAttribute('id')) continue;
        for (let child=fill.firstChild;child;child=child.nextSibling) {
            if (child.nodeType !== 1) continue;
            const element = child as unknown as {namespaceURI:string;localName:string;getAttribute(name:string):string|null};
            if (element.namespaceURI===HH && ['leftBorder','rightBorder','topBorder','bottomBorder'].includes(element.localName) && (element.getAttribute('type')||'NONE')!=='NONE') {bad.add(fill.getAttribute('id')!);break;}
        }
    }
    let count = 0;
    const properties = document.getElementsByTagNameNS(HH,'charPr');
    for (let index=0;index<properties.length;index++) if(bad.has(properties.item(index)!.getAttribute('borderFillIDRef')??'')) count++;
    return count;
}
// Read the central-directory order used by Python ZipFile, rather than trusting
// object property order from the decompressor. ZIP64 offsets are checked exactly.
export function firstZipEntry(bytes:Buffer): {name:string;method:number}|undefined {
    let end=-1;
    for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--) {
        if(bytes.readUInt32LE(offset)===0x06054b50 && offset+22+bytes.readUInt16LE(offset+20)===bytes.length) {end=offset;break;}
    }
    if(end<0)throw Error('ZIP end directory missing');
    let entries=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);
    if(entries===0xffff||offset===0xffffffff) {
        if(end<20||bytes.readUInt32LE(end-20)!==0x07064b50)throw Error('ZIP64 locator missing');
        const record=Number(bytes.readBigUInt64LE(end-12));
        if(!Number.isSafeInteger(record)||bytes.readUInt32LE(record)!==0x06064b50)throw Error('ZIP64 record missing');
        entries=Number(bytes.readBigUInt64LE(record+32));offset=Number(bytes.readBigUInt64LE(record+48));
    }
    if(!entries)return;
    if(!Number.isSafeInteger(offset)||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid ZIP central directory');
    const length=bytes.readUInt16LE(offset+28);
    return {name:bytes.subarray(offset+46,offset+46+length).toString('utf8'),method:bytes.readUInt16LE(offset+10)};
}
export function inspect(path:string):string[] {
    const bytes=readFileSync(path),first=firstZipEntry(bytes);
    if(!first)return[];
    const entries=unzipSync(bytes),problems:string[]=[];
    if(first.name!=='mimetype')problems.push('mimetype is not the first ZIP entry');
    else if(first.method!==0)problems.push('mimetype should use ZIP_STORED');
    else if(Buffer.from(entries.mimetype).toString('utf8').trim()!=='application/hwp+zip')problems.push('Invalid mimetype');
    for(const name of REQUIRED)if(!Object.hasOwn(entries,name))problems.push(`Missing required file: ${name}`);
    const preview=entries['Preview/PrvImage.png'];
    if(preview&&preview.length>67)problems.push(`Preview/PrvImage.png still carries the reference thumbnail (${preview.length} bytes) — run scripts/sanitize_template.py --fix`);
    const header=entries['Contents/header.xml'];
    if(header){const count=borderedCharPr(header);if(count)problems.push(`${count} charPr point at a bordered borderFill — every character would be boxed; run scripts/fix_borders.py --fix`);}
    return problems;
}
export function handle(payload:{tool_input?:unknown}):{decision:'block';reason:string}|undefined {
    const input=payload.tool_input;
    if(!input||typeof input!=='object'||Array.isArray(input))return;
    const values=input as Record<string,unknown>,command=String(values.command??'');
    if(OWN_TOOLS.some(tool=>command.includes(tool)))return;
    const blocking:string[]=[];
    for(const path of candidatePaths(values)) {
        try{if(!statSync(path).isFile())continue;blocking.push(...inspect(path).map(problem=>`${path}: ${problem}`));}catch{continue;}
    }
    if(blocking.length)return{decision:'block',reason:'Repair this .hwpx before handing it to the user:\n- '+blocking.join('\n- ')+'\nValidate: python3 scripts/validate_hwpx.py <file> --semantic'};
}
if(isMain(import.meta.url)) {try {const result=handle(JSON.parse(readFileSync(0,'utf8')));if(result)console.log(JSON.stringify(result));}catch(error){if(!(error instanceof SyntaxError))console.error(`hwpx_guard error: ${error}`);}}
