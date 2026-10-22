#!/usr/bin/env node
/** Check optional HWPX readiness on demand; do not install dependencies. */
import {specialistStatus} from '../../../../../runtime/specialists.js';
import {runProcess} from '../../../../../runtime/os.js';
import {isMain} from '../../../../../runtime/entry.js';
export function main():number{
 let python='';
 try{const state=specialistStatus('hwpx',{home:process.env.JSTACK_SPECIALIST_HOME});if(state.state==='ready')python=state.python;}catch{}
 if(!python){console.log('[2] Optional HWPX environment missing: .hwpx generation and validation unavailable\n    Prepare explicitly: jst optional setup hwpx\n    The locked setup uses uv pip install with the reviewed requirements lock.');return 2;}
 const lxml=runProcess(python,['-c','import lxml.etree as e; print(e.__version__)']);
 if(lxml.status!==0){console.log('[2] lxml missing: OWPML manipulation unavailable\n    Prepare explicitly: jst optional setup hwpx\n    lxml preserves the namespaces and ordering required by Hancom.');return 2;}
 console.log(`lxml: ${lxml.stdout.trim()}`);
 if(process.platform!=='win32'){console.log('[1] .hwp input unavailable: requires Windows, Hancom Office, and pywin32\n    .hwpx generation and validation remain available; see references/com-windows-guide.md');return 1;}
 let windowsPython='';try{const state=specialistStatus('hwpx-windows',{home:process.env.JSTACK_SPECIALIST_HOME});if(state.state==='ready')windowsPython=state.python;}catch{}
 if(!windowsPython||runProcess(windowsPython,['-c','import win32com']).status!==0){console.log('[1] pywin32 missing: only .hwp input is unavailable\n    Prepare explicitly: jst optional setup hwpx-windows');return 1;}
 console.log('pywin32: available (.hwp input supported; actual Hancom COM execution needs separate validation)');return 0;
}
if(isMain(import.meta.url))process.exitCode=main();
