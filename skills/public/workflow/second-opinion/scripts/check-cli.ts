#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
import { executable } from './bridge-common.js';
export function checkCli(name: string): number {
  if (executable(name)) return 0;
  process.stderr.write(`ERROR: '${name}' CLI not found.\n\n`);
  const guidance: Record<string, string> = {
    codex: 'Install Codex CLI:\n  npm install -g @openai/codex\n  # or\n  brew install codex  (macOS)\n\nThen authenticate:\n  export OPENAI_API_KEY="your-key"\n  # or\n  codex login\n\nDocs: https://github.com/openai/codex\n',
  };
  process.stderr.write(guidance[name] ?? `No install instructions available for '${name}'.\nInstall it and ensure it is on your PATH.\n`); return 1;
}
export function main(argv = process.argv.slice(2)): number {
  if (argv.length !== 1 || !argv[0]) { console.error('Usage: check-cli <cli-name>'); return 1; }
  return checkCli(argv[0]);
}
if (isMain(import.meta.url)) process.exitCode = main();
