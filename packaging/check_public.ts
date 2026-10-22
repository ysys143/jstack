import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const PRIVATE_DIRS = new Set(['.git', '.jstack', '.omc', '.omo', '.gjc', '.senpi', '__pycache__', 'node_modules', '.pytest_cache', '.ruff_cache']);
const PRIVATE_FILES = new Set(['.env', 'credentials.json', 'credentials.enc', 'token.json', 'oauth_token.json', 'client_secret.json', '.DS_Store']);
export const KEYS = /(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{25,}|xox[baprs]-[A-Za-z0-9-]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
/**
 * Deliberately fake credential-shaped values in test fixtures and one sample transcript of the vendored
 * journey-qa leak-scanner suite, pinned by package path and content hash. A changed byte, or the same value anywhere else, is flagged.
 */
export const REVIEWED_FIXTURES: ReadonlyMap<string, string> = new Map([
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/redact/transcript-secrets.txt', '48fd57fd42d3a084362aa9457d6503a30a5af0d8915c25774ee345730ca71a4a'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/apikey-ghp.txt', '8daee8401b26e21aaf62a2726993e384fadc26c6f1296fb7b42a4bbd4cbbc2fd'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/apikey-sk-ant.txt', '107e8f97fd93c8d84dd9c015a595177ee179cc5daab5ebf89bc1a50ddf985520'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/private-key-rsa.txt', 'ade290ec1a191be1cd866c48796e01e191ca7d06b0d4f38edc740005d9f59de3'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/private-key-openssh.txt', 'f02bedb08bb7caf7ef2841b50204adb8bd5c7922e8654455d78b03f9e33db87e'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/apikey-slack.txt', '0b81621e8e8572c9a0a19012849b459b03800f1d8f9daa98abf81d8767f40457'],
  ['skills/journey-qa/repos/journey-qa/gates/selftest/fixtures/text/apikey-sk.txt', 'a6587cddc20a6f1f10bb08ab514ff5508c5f8d412ef1baf478b681600e4bfe3d'],
  ['skills/journey-qa/repos/journey-qa/capture/sample/01-sample-terminal.raw.txt', '45fd7669d13f3df1a2ca70d6bcf4cdcff4fb141ec5c183c33052a10885ec31f0'],
]);
export function reviewedFixture(rel: string, raw: Buffer): boolean {
  const pinned = REVIEWED_FIXTURES.get(rel.replace(/^(?:plugins\/jstack\/)?payload\//, ''));
  return pinned !== undefined && createHash('sha256').update(raw).digest('hex') === pinned;
}
const DRIVE = /`(?:0A|1)[A-Za-z0-9_-]{20,}`|https:\/\/docs\.google\.com\/(?:document|spreadsheets)\/d\/([A-Za-z0-9_-]{20,})/g;
const HOME = new RegExp('/' + 'Users/([A-Za-z0-9_.-]+)', 'g');
const EXAMPLE_USERS = new Set(['user', 'username', 'name', 'you', 'me', 'example', 'test', 'testuser', 'alice', 'bob', 'someone', 'tester', 'a', 'b', 'x']);
export interface PublicReport { scannedFiles: number; findings: { path: string; kind: string }[]; passed: boolean }

/** Publication boundary, not a complete secret or license scanner. Never print matched values. */
export function inspectPublic(directory: string, privateValues: string[] = []): PublicReport {
  if (!Array.isArray(privateValues) || privateValues.some(value => typeof value !== 'string')) throw new Error('Private comparison list must contain strings');
  const root = realpathSync(directory);
  const findings: PublicReport['findings'] = [];
  let scannedFiles = 0;
  function walk(parent: string): void {
    for (const name of readdirSync(parent).sort()) {
      const path = join(parent, name), rel = relative(root, path).split(sep).join('/');
      const parts = rel.split('/'), stat = lstatSync(path);
      const add = (kind: string) => findings.push({ path: rel, kind });
      if (stat.isSymbolicLink()) { add('symlink in distributable'); continue; }
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile()) { add('special file in distributable'); continue; }
      scannedFiles++;
      if (parts.some(part => PRIVATE_DIRS.has(part)) || PRIVATE_FILES.has(name) || (parts.includes('evals') && parts.includes('results'))) add('private state or development output');
      const raw = readFileSync(path);
      if (privateValues.some(value => value && raw.includes(Buffer.from(value)))) add('private comparison match');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { continue; }
      if (KEYS.test(text) && !reviewedFixture(rel, raw)) add('credential-shaped value');
      if (!parts.includes('repos')) {
        const ids = [...text.matchAll(DRIVE)].map(m => m[0].replace(/^`|`$/g, ''));
        if (ids.some(id => !/^[0-9a-f]{40,64}$/.test(id))) add('embedded business resource ID');
        if ([...text.matchAll(HOME)].some(m => !EXAMPLE_USERS.has(m[1].toLowerCase()))) add('machine user path');
      }
    }
  }
  walk(root);
  if (!scannedFiles) findings.push({ path: '.', kind: 'empty publication surface' });
  return { scannedFiles, findings, passed: scannedFiles > 0 && findings.length === 0 };
}
