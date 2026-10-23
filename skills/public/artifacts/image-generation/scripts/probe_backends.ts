#!/usr/bin/env node
/** Report both image paths without generating images or exposing key contents. */
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
function file(path: string): boolean { try {
    return statSync(path).isFile();
}
catch {
    return false;
} }
function executable(path: string): boolean { try {
    accessSync(path, constants.X_OK);
    return file(path);
}
catch {
    return false;
} }
function command(name: string): boolean { const extensions = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : ['']; return (process.env.PATH ?? '').split(delimiter).some(dir => extensions.some(ext => executable(join(dir, name + ext)))); }
export function main(): number {
    const codex = command('codex');
    console.log(codex ? `codex: ${runProcess('codex', ['--version']).stdout.split(/\r?\n/)[0]}` : 'codex: 없음');
    const script = join(dirname(fileURLToPath(import.meta.url)), 'nanobanana.py'), keyFile = join(process.env.HOME ?? homedir(), '.claude', '.env.nanobanana');
    let keySource = '';
    if (process.env.GEMINI_API_KEY)
        keySource = 'environment variable';
    else if (file(keyFile)) {
        try {
            if (readFileSync(keyFile, 'utf8').includes('GEMINI_API_KEY'))
                keySource = keyFile;
        }
        catch { }
    }
    const nano = file(script) && !!keySource;
    if (nano)
        console.log(`nanobanana: 사용 가능 (key source: ${keySource})`);
    else if (!file(script))
        console.log('nanobanana: 스크립트 없음');
    else {
        console.log('nanobanana: GEMINI_API_KEY 없음 — optional for Google API key holders');
        console.log('  1) Obtain: https://aistudio.google.com/apikey (Google account required; usage is billed to that account)');
        console.log(`  2) Configure: printf 'GEMINI_API_KEY=YOUR_ISSUED_KEY\\n' > ${keyFile} && chmod 600 ${keyFile}`);
        console.log('     Or in the shell: export GEMINI_API_KEY=YOUR_ISSUED_KEY');
        console.log('  3) Dependencies: uv pip install -r <skill>/requirements.txt (install explicitly)');
        console.log('  Note: the working directory .env overrides home settings. Never commit keys');
    }
    if (codex && nano) {
        console.log('[0] 두 경로 모두 가능 — for dimensional control, propose nanobanana; each run needs approval');
        return 0;
    }
    if (codex || nano) {
        console.log(codex ? '[1] codex 만 가능 — aspect ratio and resolution cannot be fixed through arguments' : '[1] nanobanana 만 가능 — propose it; each run needs approval');
        return 1;
    }
    console.log('[2] 두 경로 모두 불가 — cannot generate images');
    return 2;
}
if (isMain(import.meta.url))
    process.exitCode = main();
