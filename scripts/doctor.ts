import { isMain } from '../runtime/entry.js';
import { pathToFileURL } from 'node:url';
import { doctorDev } from './doctor-dev.js';
import { doctorWork } from './doctor-work.js';
export function doctor(argv: string[], diagnostics: { dev: () => {code:number;lines:string[]}; work: (skill?:string) => {code:number;lines:string[]} } = {dev:doctorDev,work:doctorWork}) {
  if (argv.length > 1) return {code: 2, lines: ['usage: doctor [skill]']};
  const dev = argv.length ? {code: 0, lines: []} : diagnostics.dev(); const work = diagnostics.work(argv[0]);
  return {code: Math.max(dev.code, work.code), lines: [...dev.lines, ...work.lines]};
}
if (isMain(import.meta.url)) { const result = doctor(process.argv.slice(2)); console.log(result.lines.join('\n')); process.exitCode = result.code; }
