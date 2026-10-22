/** Native fixture IO, ZIP metadata, and minimal path operations for HWPX contracts. */
import {existsSync,realpathSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {zipSync,unzipSync,type Zippable} from 'fflate';
export class PyPath {
 constructor(public value:string){}
 toString():string{return this.value;}
 [Symbol.toPrimitive]():string{return this.value;}
 get name():string{return basename(this.value);}
 get parents():PyPath[]{const out:PyPath[]=[];let p=dirname(this.value);while(p!==dirname(p)){out.push(new PyPath(p));p=dirname(p);}out.push(new PyPath(p));return out;}
 resolve():PyPath{return new PyPath(existsSync(this.value)?realpathSync(this.value):resolve(this.value));}
 relative_to(base:PyPath|string):PyPath{return new PyPath(relative(String(base),this.value));}
 as_posix():string{return this.value.replaceAll('\\','/');}
 exists():boolean{return existsSync(this.value);}
 is_file():boolean{try{return statSync(this.value).isFile();}catch{return false;}}
 mkdir(_opts:unknown={}):void{mkdirSync(this.value,{recursive:true});}
 read_bytes():Buffer{return readFileSync(this.value);}
 read_text(_opts:unknown={}):string{return readFileSync(this.value,'utf8');}
 write_bytes(bytes:Buffer):void{writeFileSync(this.value,bytes);}
 write_text(text:string,_opts:unknown={}):void{writeFileSync(this.value,text);}
 rglob(_pattern:string):PyPath[]{const out:PyPath[]=[];const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const p=join(dir,entry.name);out.push(new PyPath(p));if(entry.isDirectory())walk(p);}};walk(this.value);return out;}
}
export function Path(value:unknown):PyPath{return value instanceof PyPath?value:new PyPath(String(value));}
export function pathJoin(a:unknown,b:unknown):PyPath{return Path(join(String(a),String(b)));}
export function joinPaths(...args:unknown[]):string{return join(...args.map(String));}
export interface ZipInfo{filename:string;compress_type:number;}
export class ZipArchive {
 private payload:Record<string,Uint8Array>={};private infos:ZipInfo[]=[];
 constructor(private path:PyPath|string,private mode='r'){
  if(mode==='w')return;
  const bytes=readFileSync(String(path));this.payload=unzipSync(bytes);
  // Read central-directory metadata; compression methods are evidence, not
  // inferred from fflate's decompressed entry map.
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('ZIP end-of-central-directory not found');
  let offset=bytes.readUInt32LE(end+16);const count=bytes.readUInt16LE(end+10);
  for(let i=0;i<count;i++){
   if(bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('ZIP central-directory entry missing');
   const n=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
   this.infos.push({filename:bytes.subarray(offset+46,offset+46+n).toString('utf8'),compress_type:bytes.readUInt16LE(offset+10)});offset+=46+n+extra+comment;
  }
 }
 read(name:string):Buffer{if(!(name in this.payload))throw new Error(`ZIP entry absent: ${name}`);return Buffer.from(this.payload[name]);}
 namelist():string[]{return this.infos.map(info=>info.filename);}
 infolist():ZipInfo[]{return this.infos.map(info=>({...info}));}
 writestr(name:string|ZipInfo,data:string|Buffer|Uint8Array,options:{compress_type?:number}={}):void{
  const info=typeof name==='string'?{filename:name,compress_type:0}:{...name};if(options.compress_type!==undefined)info.compress_type=options.compress_type;
  this.payload[info.filename]=typeof data==='string'?Buffer.from(data):data;
  const existing=this.infos.findIndex(i=>i.filename===info.filename);if(existing>=0)this.infos[existing]=info;else this.infos.push(info);
 }
 close():void{if(this.mode!=='w')return;const entries:Zippable={};for(const info of this.infos)entries[info.filename]=[this.payload[info.filename],{level:info.compress_type===0?0:6}];writeFileSync(String(this.path),zipSync(entries));}
}
export const zipfile={ZipFile:(path:PyPath|string,mode='r')=>new ZipArchive(path,mode),ZipInfo:(filename:string):ZipInfo=>({filename,compress_type:0}),ZIP_STORED:0,ZIP_DEFLATED:8};
export function openFile(path:PyPath|string,mode:string|Record<string,unknown>='r',_opts:unknown={}){return {read:()=>typeof mode==='string'&&mode.includes('b')?readFileSync(String(path)):readFileSync(String(path),'utf8'),write:(data:Buffer|string)=>writeFileSync(String(path),data),close:()=>{}};}
export function bytesFromHex(value:string):Buffer{return Buffer.from(value,'hex');}
