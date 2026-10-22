#!/usr/bin/env node
/** 0: all formats; 1: HTML only; 2: marp missing. Never install dependencies. */
import { accessSync, constants, statSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
function executable(path: string): boolean { try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
}
catch {
    return false;
} }
function command(name: string): boolean {
    const extensions = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
    return (process.env.PATH ?? '').split(delimiter).some(dir => extensions.some(ext => executable(join(dir, name + ext))));
}
export function main(): number {
    let program = '', args: string[] = [];
    if (command('marp'))
        program = 'marp';
    else if (command('npx') && runProcess('npx', ['--no-install', '@marp-team/marp-cli', '--version']).status === 0) {
        program = 'npx';
        args = ['--no-install', '@marp-team/marp-cli'];
    }
    if (!program) {
        console.log('[2] marp missing; slide rendering unavailable\n    Install: brew install marp-cli   or   npx @marp-team/marp-cli');
        return 2;
    }
    console.log(`marp: ${runProcess(program, [...args, '--version']).stdout.split(/\r?\n/)[0]}`);
    let found = '';
    for (const app of ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app', '/Applications/Chromium.app', '/Applications/Firefox.app']) {
        try {
            if (statSync(app).isDirectory()) {
                found = basename(app, '.app');
                break;
            }
        }
        catch { }
    }
    if (!found)
        for (const browser of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'firefox'])
            if (command(browser)) {
                found = browser;
                break;
            }
    if (process.platform === 'win32' && !found)
        for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[])
            for (const browser of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'Mozilla Firefox/firefox.exe']) {
                const path = join(base, browser);
                if (executable(path)) {
                    found = path;
                    break;
                }
            }
    if (process.env.CHROME_PATH && executable(process.env.CHROME_PATH))
        found = `CHROME_PATH=${process.env.CHROME_PATH}`;
    if (!found) {
        console.log("[1] no browser; HTML only. PDF/PPTX/images unavailable\n    marp --help Browser Options specifies 'for PDF, PPTX, and image'");
        return 1;
    }
    console.log(`browser: ${found}\n[0] all formats available (HTML, PDF, PPTX, images)`);
    return 0;
}
if (isMain(import.meta.url))
    process.exitCode = main();
