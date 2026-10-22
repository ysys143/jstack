import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, platform, arch } from 'node:os';
import { runProcess, atomicWrite } from '../../../../../runtime/os.js';
import { type Roots, type Candidate, type Redactor, type Config, saveCandidate, ensure, findCandidate, appendReceipt, saveConfig, headline, clip } from './state.js';

export interface Details { expected?: string; actual?: string; steps?: string }
const DOCTOR = fileURLToPath(new URL('../../../../../scripts/doctor.js', import.meta.url));
const MARKER = /<!-- jstack-report id=(rpt-[0-9a-f]{12}) signature=([0-9a-f]{64}) -->/;

const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Receipt text is data from a file: one short line, no control characters, never a heading or a list item of its own. */
const text = (value: unknown) => (typeof value === 'string' ? clip(value, 80) : '') || '?';
const HOSTS = ['claude', 'codex'] as const;
/** A delivered package keeps package-receipt.json beside the payload directory that holds its scripts. */
export function payloadReceipt(moduleFile: string): string | undefined {
  for (let dir = dirname(moduleFile); dirname(dir) !== dir; dir = dirname(dir)) if (basename(dir) === 'payload') return join(dirname(dir), 'package-receipt.json');
  return undefined;
}
const RUNNING_RECEIPT = payloadReceipt(fileURLToPath(import.meta.url));
const packageReceipt = (file: string | undefined): { version: string; hash: string } | undefined => {
  const receipt = file ? readJson(file) as { version?: unknown; sourceSha256?: unknown } | undefined : undefined;
  return typeof receipt?.version === 'string' ? { version: text(receipt.version), hash: text(receipt.sourceSha256) } : undefined;
};
/**
 * What jst install recorded comes first: the claude and codex entries of its installation receipt,
 * then the package receipt of its managed marketplace, which names the missing or broken
 * installation receipt. Without either, the package receipt of the running payload names a
 * host-native install and the same problem. Package receipts carry a source hash, not the tree digest.
 */
export function environment(r: Roots, env: NodeJS.ProcessEnv = process.env, running = RUNNING_RECEIPT): Record<string, string> {
  const file = join(r.jstack, 'installation.json'), installation = readJson(file), hosts = plain(installation) ? installation.hosts : undefined;
  // A malformed host entry is skipped; a damaged receipt must not stop the report that describes the damage.
  const listed = plain(hosts) ? HOSTS.flatMap(host => hosts[host] === undefined ? [] : [{ host, entry: hosts[host] }]) : [];
  const installed = listed.flatMap(({ host, entry }) => plain(entry) ? [{ host, entry }] : []);
  const anomaly = installation === undefined ? existsSync(file) ? 'unreadable' : 'missing'
    : !plain(installation) || (hosts !== undefined && !plain(hosts)) || listed.length > installed.length ? 'malformed' : 'lists no hosts';
  let version = anomaly === 'missing' ? 'not installed through jst install (no installation receipt)' : `unknown (installation receipt ${anomaly})`, digest = 'unknown';
  const managed = installed.length ? [] : HOSTS.flatMap(host => { const p = packageReceipt(join(r.jstack, 'marketplace', 'plugins', host, 'jstack', 'package-receipt.json')); return p ? [{ host, ...p }] : []; });
  const own = installed.length || managed.length ? undefined : packageReceipt(running);
  if (installed.length) { version = installed.map(({ host, entry }) => `${host} ${text(entry.version)}`).join(', '); digest = installed.map(({ host, entry }) => `${host} ${text(entry.digest)}`).join(', '); }
  else if (managed.length) {
    version = managed.map(p => `${p.host} ${p.version} (package receipt; installation receipt ${anomaly})`).join(', ');
    digest = managed.map(p => `${p.host} ${p.hash} (package receipt source hash)`).join(', ');
  } else if (own) { version = `${own.version} (running package receipt; installation receipt ${anomaly})`; digest = `${own.hash} (package receipt source hash)`; }
  const host = env.CLAUDECODE ? 'claude' : env.CODEX_THREAD_ID || env.CODEX_SANDBOX ? 'codex' : 'unknown';
  let hostVersion = 'unknown';
  if (host !== 'unknown') { const result = runProcess(host, ['--version'], { env, timeout: 10000 }); if (result.status === 0) hostVersion = result.stdout.trim().split('\n')[0] ?? 'unknown'; }
  return { 'jstack version': version, 'Package digest': digest, Host: host, 'Host version': hostVersion, OS: `${platform()} ${release()} ${arch()}`, Node: process.version };
}
export function doctorSummary(env: NodeJS.ProcessEnv = process.env): string {
  if (!existsSync(DOCTOR)) return '- doctor: unavailable in this installation';
  const result = runProcess(process.execPath, [DOCTOR], { env, timeout: 60000 });
  const blocked = `${result.stdout ?? ''}`.split('\n').filter(line => /\[blocked\]/.test(line)).map(line => `  - ${line.trim()}`);
  return [`- doctor exit code: ${result.status ?? 'not completed'}`, `- blocked rows: ${blocked.length ? '' : 'none'}`, ...blocked].join('\n');
}
const field = (value: string | undefined) => value?.trim() ? value.trim() : '(not provided by the reporter)';

/** The whole draft passes redaction before it is written. */
export function writeDraft(r: Roots, candidate: Candidate, details: Details, redact: Redactor, env: NodeJS.ProcessEnv = process.env): string {
  const summary = headline(candidate.excerpt) || candidate.skillOrCommand;
  const body = [
    `<!-- jstack-report id=${candidate.id} signature=${candidate.signature} -->`,
    `## Summary\n\n${clip(summary, 160)}`,
    `## Surface\n\n${candidate.skillOrCommand}`,
    `## Expected behavior\n\n${field(details.expected)}`,
    `## Actual behavior\n\n${field(details.actual)}`,
    `## Steps to reproduce\n\n${field(details.steps)}`,
    `## Evidence excerpt\n\nObserved ${candidate.observedAt || 'at an unknown time'} from ${candidate.source}.\n\n\`\`\`text\n${candidate.excerpt.replace(/```/g, "'''")}\n\`\`\``,
    `## Environment\n\n${Object.entries(environment(r, env)).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`,
    `## Doctor summary\n\n${doctorSummary(env)}`,
    `jstack-report-signature: ${candidate.signature}`,
  ].join('\n\n') + '\n';
  ensure(r); const file = join(r.reports, 'drafts', `${candidate.id}.md`);
  atomicWrite(file, Buffer.from(redact(body)));
  saveCandidate(r, { ...candidate, status: candidate.status === 'submitted' ? 'submitted' : 'drafted' });
  return file;
}

export interface Submission { code: number; status: 'submitted' | 'duplicate' | 'fallback' | 'changed'; draft: string; url?: string; message: string; matches?: unknown[] }
export function resolveDraft(r: Roots, target: string): string {
  const file = /^rpt-[0-9a-f]{12}$/.test(target) ? join(r.reports, 'drafts', `${target}.md`) : resolve(target);
  if (!existsSync(file)) throw new Error(`Draft does not exist: ${file}`);
  return file;
}
/** Submission contacts GitHub only through gh after the caller passed --confirm. */
export function submit(r: Roots, config: Config, file: string, redact: Redactor, allowNew: boolean, env: NodeJS.ProcessEnv = process.env): Submission {
  const text = readFileSync(file, 'utf8'), marker = MARKER.exec(text);
  if (!marker) throw new Error('Draft lacks its jstack-report marker; recreate it with jst report draft');
  const [, id, sig] = marker;
  if (redact(text) !== text) { atomicWrite(file, Buffer.from(redact(text))); return { code: 1, status: 'changed', draft: file, message: 'Redaction changed the draft. Review the rewritten draft before submitting it.' }; }
  const fallback = (reason: string): Submission => ({ code: 3, status: 'fallback', draft: file, message: `${reason}. The draft was kept for manual delivery: ${file}` });
  const gh = (args: string[]) => runProcess('gh', args, { env, timeout: 60000 });
  const probe = gh(['--version']);
  if (probe.error || probe.status !== 0) return fallback('gh is not installed');
  if (gh(['auth', 'status']).status !== 0) return fallback('gh is not authenticated');
  if (gh(['repo', 'view', config.repo, '--json', 'name']).status !== 0) return fallback(`gh cannot access ${config.repo}`);
  const search = gh(['issue', 'list', '--repo', config.repo, '--state', 'open', '--search', sig, '--json', 'number,title,url']);
  if (search.status !== 0) return fallback('gh could not search existing issues');
  let matches: unknown[] = []; try { matches = JSON.parse(search.stdout || '[]'); } catch { return fallback('gh returned an unreadable issue search'); }
  if (matches.length && !allowNew) return { code: 4, status: 'duplicate', draft: file, matches, message: 'An open issue already carries this signature. Nothing was submitted; add --new to submit anyway.' };
  const candidate = findCandidate(r, id);
  const title = `[report] ${candidate.skillOrCommand}: ${clip(/## Summary\n\n(.*)/.exec(text)?.[1] ?? 'malfunction', 100)}`;
  const created = gh(['issue', 'create', '--repo', config.repo, '--title', title, '--body-file', file, '--label', 'bug', '--label', 'from-report']);
  if (created.status !== 0) return fallback('gh issue create failed');
  const url = created.stdout.trim().split('\n').pop() ?? '', now = new Date().toISOString();
  appendReceipt(r, { id, url, submittedAt: now, signature: sig });
  saveCandidate(r, { ...candidate, status: 'submitted' });
  saveConfig(r, { lastRetro: now });
  return { code: 0, status: 'submitted', draft: file, url, message: `Submitted ${url}` };
}
