/** Test adapters for the manifest-locked optional HWPX Python backend.
 * Assertions and fixtures live in the Node suite. This bridge invokes existing
 * Python APIs and serializes their return values without evaluating verdicts.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
export class XmlNode {
 constructor(public element:any){}
 static parse(bytes:Buffer|string):XmlNode {const document=new DOMParser().parseFromString(String(bytes),'text/xml');return new XmlNode(document.documentElement);}
 getroot():XmlNode{return this;}
 get tag():string{return `{${this.element.namespaceURI??''}}${this.element.localName}`;}
 get(name:string):string|null{return this.element.hasAttribute(name)?this.element.getAttribute(name):null;}
 set(name:string,value:string):void{this.element.setAttribute(name,value);}
 getparent():XmlNode{return new XmlNode(this.element.parentNode);}
 remove(child:XmlNode):void{this.element.removeChild(child.element);}
 findall(pattern:string):XmlNode[]{
  const descendants=pattern.startsWith('.//'),name=pattern.replace(/^\.\/\//,'').replace(/^\{[^}]*\}/,'');
  const out:XmlNode[]=[];
  const visit=(node:any)=>{for(const child of Array.from(node.childNodes) as any[])if(child.nodeType===1){if(name==='*'||child.localName===name)out.push(new XmlNode(child));if(descendants)visit(child);}};
  visit(this.element);return out;
 }
 find(pattern:string):XmlNode|null{return this.findall(pattern)[0]??null;}
 iter(pattern:string):XmlNode[]{const name=pattern.replace(/^\{[^}]*\}/,'');return [...(this.element.localName===name?[this]:[]),...this.findall('.//'+pattern)];}
 toString():string{return new XMLSerializer().serializeToString(this.element);}
 *[Symbol.iterator]():Generator<XmlNode>{for(const child of Array.from(this.element.childNodes) as any[])if(child.nodeType===1)yield new XmlNode(child);}
}
const bridge=String.raw`
import json,sys,base64,importlib,contextlib,io
from pathlib import Path
sys.path.insert(0,sys.argv[1])
def decode(value):
 if isinstance(value,list):return [decode(x) for x in value]
 if isinstance(value,dict):
  if '$bytes' in value:return base64.b64decode(value['$bytes'])
  if '$path' in value:return Path(value['$path'])
  if '$xml' in value:
   from lxml import etree
   return etree.fromstring(value['$xml'].encode())
  return {k:decode(v) for k,v in value.items()}
 return value
def encode(value):
 if isinstance(value,bytes):return {'$bytes':base64.b64encode(value).decode()}
 if isinstance(value,Path):return {'$path':str(value)}
 if isinstance(value,(list,tuple,set)):return [encode(x) for x in value]
 if isinstance(value,dict):return {k:encode(v) for k,v in value.items()}
 if hasattr(value,'getroot'):value=value.getroot()
 if hasattr(value,'tag'):
  from lxml import etree
  return {'$xml':etree.tostring(value,encoding='unicode')}
 return value
try:
 request=json.loads(Path(sys.argv[2]).read_text()); module=importlib.import_module(request['module'])
 with contextlib.redirect_stdout(io.StringIO()):
  if request.get('inspect'):
   missing=[n for n in request['inspect'] if not hasattr(module,n)]
   result={'missing':missing,'constants':{n:encode(getattr(module,n)) for n in request.get('constants',[]) if hasattr(module,n)}}
  else:
   args=decode(request.get('args',[]));kwargs=decode(request.get('kwargs',{}))
   if request.get('targetParagraph') is not None:
    args.append([args[0].findall('.//{*}p')[request['targetParagraph']]])
   result=getattr(module,request['name'])(*args,**kwargs)
   if request.get('mutation'):
    result={'value':result,'xml':encode(args[0])}
   if request.get('owningIndex'):
    root=args[0];item=root.findall('.//{*}linesegarray')[0]
    result=list(root.findall('.//{*}p')).index(module.owning_paragraph(item))
 print(json.dumps({'ok':True,'value':encode(result)},ensure_ascii=False))
except Exception as error:
 print(json.dumps({'ok':False,'type':type(error).__name__,'error':str(error)},ensure_ascii=False))
`;
export class PythonBackend {
 constructor(public python:string,public scripts:string){}
 private encode(value:any):any{
  if(Buffer.isBuffer(value))return {$bytes:value.toString('base64')};
  if(value instanceof XmlNode)return {$xml:value.toString()};
  if(value?.constructor?.name==='PyPath')return {$path:String(value)};
  if(Array.isArray(value))return value.map(v=>this.encode(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.encode(v)]));
  return value;
 }
 private decode(value:any):any{
  if(value&&typeof value==='object'){
   if('$bytes'in value)return Buffer.from(value.$bytes,'base64');
   if('$path'in value)return value.$path;
   if('$xml'in value)return XmlNode.parse(value.$xml);
   if(Array.isArray(value))return value.map(v=>this.decode(v));
   return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.decode(v)]));
  }return value;
 }
 request(request:Record<string,any>):any{
  const work=mkdtempSync(join(tmpdir(),'jstack-hwpx-api-'));const requestFile=join(work,'request.json');writeFileSync(requestFile,JSON.stringify(this.encode(request)));
  let r;try{r=spawnSync(this.python,['-c',bridge,this.scripts,requestFile],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:30000,maxBuffer:32*1024*1024});}finally{rmSync(work,{recursive:true,force:true});}
  if(r.status!==0)throw new Error(r.stderr||`Optional Python exited ${r.status}`);
  let response;try{response=JSON.parse(r.stdout);}catch{throw new Error('Optional Python bridge returned malformed JSON');}
  if(!response.ok){const error=new Error(response.error);error.name=response.type;throw error;}
  return this.decode(response.value);
 }
 call(module:string,name:string,args:any[]=[],kwargs:Record<string,any>={}):any{return this.request({module,name,args,kwargs});}
 inspect(module:string,names:string[],constants:string[]=[]):any{return this.request({module,inspect:names,constants});}
 clear(root:XmlNode,paragraphs?:XmlNode[]):number{
  const target=paragraphs?root.findall('.//{*}p').findIndex(node=>node.element===paragraphs[0].element):undefined;
  const result=this.request({module:'rekian_xml',name:'clear_linesegarrays',args:[root],mutation:true,targetParagraph:target});
  root.element=result.xml.element;return result.value;
 }
 owningIndex(root:XmlNode):number{return this.request({module:'rekian_xml',name:'owning_paragraph',args:[root],owningIndex:true});}
}
export const etree={fromstring:(bytes:Buffer|string)=>XmlNode.parse(bytes),parse:(path:string)=>XmlNode.parse(readFileSync(path)),tostring:(node:XmlNode,_opts:unknown={})=>Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n'+node.toString())};
