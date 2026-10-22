import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { install, safeSkillName, claudeHome, withFrontmatter, frontmatterKeys, privilegedKeys } from './install_skill.js';

function tempHome(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-install-skill-')));
}
function searchBody(entries: any[], total = entries.length): string {
  return JSON.stringify({ total, skills: entries });
}
/** Routes by URL: the search API call vs. the raw SKILL.md download. */
function stubFetch(searchText: string, rawByUrl: Record<string, string> = {}, rawStatus = 200): typeof fetch {
  return (async (url: any, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/skills/search')) return new Response(searchText, { status: 200 });
    // A download that follows redirects by itself would skip the per-hop address check.
    assert.equal(init?.redirect, 'manual', 'downloads must handle redirects by hand');
    const body = Object.entries(rawByUrl).find(([key]) => href === key)?.[1];
    return new Response(body ?? '', { status: body === undefined ? 404 : rawStatus });
  }) as typeof fetch;
}

test('safeSkillName normalizes the last namespace segment and rejects unsafe input', () => {
  assert.equal(safeSkillName('@wshobson/agents/Auth_Implementation Patterns'), 'auth-implementation-patterns');
  assert.equal(safeSkillName('simple-name'), 'simple-name');
  assert.throws(() => safeSkillName('@only/$$$'));
  assert.throws(() => safeSkillName(''));
});

test('claudeHome prefers CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
  // An already-absolute setting is returned unchanged, so name one the host agrees is
  // absolute: a leading slash is a relative path on Windows and resolves onto a drive.
  const custom = path.join(os.tmpdir(), 'custom-home');
  assert.equal(claudeHome({ CLAUDE_CONFIG_DIR: custom } as NodeJS.ProcessEnv), custom);
  const fallback = claudeHome({} as NodeJS.ProcessEnv);
  assert.ok(fallback.endsWith(path.join('.claude')));
});

test('withFrontmatter synthesizes frontmatter only when the body lacks it', () => {
  assert.equal(withFrontmatter('---\nname: x\n---\nbody', 'y', 'desc'), '---\nname: x\n---\nbody');
  const synthesized = withFrontmatter('# body only', 'my-skill', 'a description');
  assert.match(synthesized, /^---\nname: my-skill\ndescription: "a description"\n---\n\n# body only$/);
});

test('withFrontmatter folds a multi-line description onto one quoted line so it cannot add keys', () => {
  const synthesized = withFrontmatter('body', 'my-skill', 'ok\nallowed-tools: Bash\r\n  "quoted" \u2028 end');
  assert.equal(synthesized, '---\nname: my-skill\ndescription: "ok allowed-tools: Bash \\"quoted\\" end"\n---\n\nbody');
  assert.deepEqual(frontmatterKeys(synthesized), ['name', 'description']);
  assert.match(withFrontmatter('body', 'my-skill', '  \n '), /^---\nname: my-skill\ndescription: "my-skill"\n---/);
});

test('frontmatterKeys lists the top-level keys and ignores nested lines and the body', () => {
  assert.deepEqual(frontmatterKeys('---\nname: x\nallowed-tools:\n  - Bash\n  nested: 1\n---\nbody: not a key'), ['name', 'allowed-tools']);
  assert.deepEqual(frontmatterKeys('no frontmatter\nname: x'), []);
});

test('install rejects a missing namespace argument with usage text', async () => {
  const result = await install([], (async () => new Response('')) as typeof fetch);
  assert.equal(result.code, 1);
  assert.match(result.text, /Usage: install_skill/);
});

test('install writes the skill into <home>/skills/<name>/SKILL.md via exact namespace match', async () => {
  const home = tempHome();
  const entries = [{ namespace: '@wshobson/agents/auth-implementation-patterns', name: 'auth-implementation-patterns', author: 'wshobson', description: 'Auth patterns', metadata: { rawFileUrl: 'https://example.test/raw/auth.md' } }];
  const fetcher = stubFetch(searchBody(entries), { 'https://example.test/raw/auth.md': '---\nname: auth-implementation-patterns\ndescription: Auth patterns\n---\n\nBody text.' });
  const result = await install(['@wshobson/agents/auth-implementation-patterns'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 0);
  const target = path.join(home, 'skills', 'auth-implementation-patterns', 'SKILL.md');
  assert.equal(result.targetPath, target);
  assert.match(fs.readFileSync(target, 'utf8'), /Body text\./);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install falls back to a name match when no namespace matches exactly', async () => {
  const home = tempHome();
  const entries = [{ namespace: '@someone/else/other-skill', name: 'requested-skill', author: 'someone', description: '', metadata: { rawFileUrl: 'https://example.test/raw/req.md' } }];
  const fetcher = stubFetch(searchBody(entries), { 'https://example.test/raw/req.md': 'plain body, no frontmatter' });
  const result = await install(['requested-skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 0);
  const written = fs.readFileSync(path.join(home, 'skills', 'requested-skill', 'SKILL.md'), 'utf8');
  assert.match(written, /^---\nname: requested-skill\n/);
  assert.match(written, /plain body, no frontmatter$/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install re-run with identical content is idempotent', async () => {
  const home = tempHome();
  const entries = [{ namespace: 'ns/dup-skill', name: 'dup-skill', author: 'a', description: 'first', metadata: { rawFileUrl: 'https://example.test/raw/dup.md' } }];
  const fetcher = stubFetch(searchBody(entries), { 'https://example.test/raw/dup.md': '---\nname: dup-skill\ndescription: first\n---\n\nversion one' });
  assert.equal((await install(['ns/dup-skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv)).code, 0);
  const again = await install(['ns/dup-skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(again.code, 0);
  assert.match(again.text, /content unchanged/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install refuses to overwrite a same-named skill with different content unless --force', async () => {
  const home = tempHome(), target = path.join(home, 'skills', 'dup-skill', 'SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '---\nname: dup-skill\ndescription: hand-written\n---\n\nmine');
  const entries = [{ namespace: 'ns/dup-skill', name: 'dup-skill', author: 'a', description: 'first', metadata: { rawFileUrl: 'https://example.test/raw/dup.md' } }];
  const fetcher = stubFetch(searchBody(entries), { 'https://example.test/raw/dup.md': '---\nname: dup-skill\ndescription: first\n---\n\nversion two' });
  const refused = await install(['ns/dup-skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(refused.code, 1);
  assert.match(refused.text, /already exists with different content/);
  assert.match(refused.text, /--force/);
  assert.match(fs.readFileSync(target, 'utf8'), /mine/);
  const forced = await install(['ns/dup-skill', '--force'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(forced.code, 0);
  assert.match(fs.readFileSync(target, 'utf8'), /version two/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install refuses malformed JSON from the search API', async () => {
  const home = tempHome();
  const result = await install(['ns/skill'], stubFetch('not-json'), { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 1);
  assert.match(result.text, /Malformed JSON/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install reports an HTTP failure from the search API', async () => {
  const home = tempHome();
  const fetcher = (async () => new Response('', { status: 503 })) as typeof fetch;
  const result = await install(['ns/skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 1);
  assert.match(result.text, /503/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install reports no match found', async () => {
  const home = tempHome();
  const fetcher = stubFetch(searchBody([{ namespace: 'other/thing', name: 'other', metadata: { rawFileUrl: 'https://example.test/raw/other.md' } }]));
  const result = await install(['ns/nowhere'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 1);
  assert.match(result.text, /Skill not found/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install reports a missing download URL', async () => {
  const home = tempHome();
  const fetcher = stubFetch(searchBody([{ namespace: 'ns/skill', name: 'skill', metadata: {} }]));
  const result = await install(['ns/skill'], fetcher, { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(result.code, 1);
  assert.match(result.text, /No download URL/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('install reports a failed or empty SKILL.md download', async () => {
  const home = tempHome();
  const entries = [{ namespace: 'ns/skill', name: 'skill', metadata: { rawFileUrl: 'https://example.test/raw/skill.md' } }];
  const emptyBody = await install(['ns/skill'], stubFetch(searchBody(entries), { 'https://example.test/raw/skill.md': '' }), { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(emptyBody.code, 1);
  assert.match(emptyBody.text, /empty/);
  const missingRaw = await install(['ns/skill'], stubFetch(searchBody(entries)), { CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
  assert.equal(missingRaw.code, 1);
  assert.match(missingRaw.text, /404/);
  fs.rmSync(home, { recursive: true, force: true });
});

const skillEntry = (namespace: string, rawFileUrl = 'https://example.test/raw/skill.md') => ({ namespace, name: namespace.split('/').pop(), author: 'a', description: 'd', metadata: { rawFileUrl } });
const homeEnv = (home: string) => ({ CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv);
const quietly = (lines: string[] = []) => mock.method(console, 'log', (...args: unknown[]) => { lines.push(args.join(' ')); });

test('install refuses a qualified namespace that matches only by name and writes nothing', async t => {
  const home = tempHome(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const fetcher = stubFetch(searchBody([skillEntry('@mallory/evil/foo')]), { 'https://example.test/raw/skill.md': 'evil body' });
  const result = await install(['@alice/tools/foo'], fetcher, homeEnv(home));
  assert.equal(result.code, 1);
  assert.match(result.text, /Skill not found: @alice\/tools\/foo/);
  assert.equal(fs.existsSync(path.join(home, 'skills')), false);
});

test('install rejects extra positional arguments and unknown options before any request', async () => {
  const fetcher = (async () => { throw new Error('no request expected'); }) as typeof fetch;
  const words = await install(['auth', 'implementation', 'patterns'], fetcher);
  assert.equal(words.code, 1);
  assert.match(words.text, /expected one namespace, got 3: auth implementation patterns/);
  assert.match(words.text, /Usage: install_skill/);
  const forced = await install(['one', 'two', '--force'], fetcher);
  assert.equal(forced.code, 1);
  const option = await install(['--bogus', 'ns/skill'], fetcher);
  assert.equal(option.code, 1);
  assert.match(option.text, /unknown option --bogus/);
});

test('install shows the resolved namespace and the frontmatter keys, and warns about allowed-tools', async t => {
  const home = tempHome(); t.after(() => { mock.restoreAll(); fs.rmSync(home, { recursive: true, force: true }); });
  const lines: string[] = []; quietly(lines);
  const fetcher = stubFetch(searchBody([skillEntry('ns/privileged')]), { 'https://example.test/raw/skill.md': '---\nname: privileged\nallowed-tools: Bash\n---\nbody' });
  assert.equal((await install(['ns/privileged'], fetcher, homeEnv(home))).code, 0);
  const output = lines.join('\n');
  assert.match(output, /Found: privileged\n {2}Namespace: ns\/privileged\n {2}Author: a/);
  assert.match(output, /Frontmatter keys: name, allowed-tools/);
  assert.match(output, /Warning: this skill declares allowed-tools/);
  lines.length = 0;
  const plain = stubFetch(searchBody([skillEntry('ns/plain')]), { 'https://example.test/raw/skill.md': '---\nname: plain\ndescription: d\n---\nbody' });
  assert.equal((await install(['ns/plain'], plain, homeEnv(home))).code, 0);
  assert.match(lines.join('\n'), /Frontmatter keys: name, description/);
  assert.doesNotMatch(lines.join('\n'), /Warning:/);
});

test('install refuses a download that is not https or points at a local, IP-literal or credentialed host', async t => {
  const home = tempHome(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const [url, reason] of [['http://insecure.test/p.md', /only https/], ['https://127.0.0.1/p.md', /IP-literal/], ['https://169.254.169.254/p.md', /IP-literal/], ['https://[::1]/p.md', /IP-literal/], ['https://localhost/p.md', /local/], ['https://localhost./p.md', /local/], ['https://localhost%2e/p.md', /local/], ['https://dev.localhost../p.md', /local/], ['https://user:pw@example.test/p.md', /credentials/], ['not a url', /not a URL/]] as [string, RegExp][]) {
    const fetcher = stubFetch(searchBody([skillEntry('ns/skill', url)]), { [url]: 'body' });
    const result = await install(['ns/skill'], fetcher, homeEnv(home));
    assert.equal(result.code, 1, url);
    assert.match(result.text, reason, url);
  }
  assert.equal(fs.existsSync(path.join(home, 'skills')), false);
});

test('install checks every redirect hop of the download', async t => {
  const home = tempHome(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const route = (location: string): typeof fetch => (async (url: any, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/skills/search')) return new Response(searchBody([skillEntry('ns/skill', 'https://example.test/raw/start.md')]), { status: 200 });
    assert.equal(init?.redirect, 'manual', 'downloads must handle redirects by hand');
    if (href === 'https://example.test/raw/start.md') return new Response('', { status: 302, headers: { location } });
    if (href === 'https://example.test/raw/final.md') return new Response('final body', { status: 200 });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const downgraded = await install(['ns/skill'], route('http://example.test/raw/final.md'), homeEnv(home));
  assert.equal(downgraded.code, 1);
  assert.match(downgraded.text, /only https/);
  const internal = await install(['ns/skill'], route('https://10.0.0.5/raw/final.md'), homeEnv(home));
  assert.equal(internal.code, 1);
  assert.match(internal.text, /IP-literal/);
  assert.equal(fs.existsSync(path.join(home, 'skills')), false);
  const relative = await install(['ns/skill'], route('/raw/final.md'), homeEnv(home));
  assert.equal(relative.code, 0);
  assert.match(fs.readFileSync(path.join(home, 'skills', 'skill', 'SKILL.md'), 'utf8'), /final body$/);
});

test('install follows at most three redirects', async t => {
  const home = tempHome(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const chain = (hops: number): typeof fetch => (async (url: any, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/skills/search')) return new Response(searchBody([skillEntry('ns/skill', 'https://example.test/raw/r0.md')]), { status: 200 });
    assert.equal(init?.redirect, 'manual', 'downloads must handle redirects by hand');
    const step = Number(/r(\d+)\.md$/.exec(href)?.[1]);
    return step < hops ? new Response('', { status: 302, headers: { location: '/raw/r' + (step + 1) + '.md' } }) : new Response('arrived', { status: 200 });
  }) as typeof fetch;
  const tooMany = await install(['ns/skill'], chain(4), homeEnv(home));
  assert.equal(tooMany.code, 1);
  assert.match(tooMany.text, /Too many redirects/);
  assert.equal(fs.existsSync(path.join(home, 'skills')), false);
  assert.equal((await install(['ns/skill'], chain(3), homeEnv(home))).code, 0);
});

test('privilegedKeys finds allowed-tools and hooks in block, quoted and flow forms and ignores the body', () => {
  const found: [string, string[]][] = [
    ['---\nname: x\nallowed-tools: Bash\n---\nbody', ['allowed-tools']],
    ['---\nname: x\n"allowed-tools": Bash\n---\nbody', ['allowed-tools']],
    ['---\n{name: x, allowed-tools: Bash}\n---\nbody', ['allowed-tools']],
    ['---\nname: x\nallowed_tools: Bash\n---\nbody', ['allowed-tools']],
    ['---\nname: x\nhooks:\n  PreToolUse: []\n---\nbody', ['hooks']],
    ["---\n{name: x, 'hooks': {}}\n---\nbody", ['hooks']],
    ['---\nname: x\nallowed-tools: Bash\nhooks: {}\n---\nbody', ['allowed-tools', 'hooks']],
    ['---\nname: x\nallowed-tools: Bash\nno closing marker', ['allowed-tools']],
  ];
  for (const [text, keys] of found) assert.deepEqual(privilegedKeys(text), keys, text);
  for (const text of ['---\nname: x\ndescription: runs hooks and tools\n---\nbody', '---\nname: x\n---\nallowed-tools: in the body\nhooks: too', 'allowed-tools: no frontmatter']) assert.deepEqual(privilegedKeys(text), [], text);
  assert.deepEqual(frontmatterKeys('---\n"allowed-tools": Bash\nname: x\n---\n'), ['allowed-tools', 'name']);
});

test('install refuses to write through a linked skills folder and leaves nothing behind', { skip: process.platform === 'win32' && 'needs symlinks' }, async t => {
  const home = tempHome(), elsewhere = tempHome();
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(elsewhere, { recursive: true, force: true }); });
  fs.symlinkSync(elsewhere, path.join(home, 'skills'), 'dir');
  const fetcher = stubFetch(searchBody([skillEntry('ns/skill')]), { 'https://example.test/raw/skill.md': 'body' });
  const result = await install(['ns/skill'], fetcher, homeEnv(home));
  assert.equal(result.code, 1);
  assert.match(result.text, /link/);
  assert.match(result.text, /CLAUDE_CONFIG_DIR/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('install refuses a skill folder that differs only in case from an existing one', async t => {
  const home = tempHome(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'skills', 'Dup-Skill'), { recursive: true });
  const fetcher = stubFetch(searchBody([skillEntry('ns/dup-skill')]), { 'https://example.test/raw/skill.md': 'body' });
  const result = await install(['ns/dup-skill'], fetcher, homeEnv(home));
  assert.equal(result.code, 1);
  assert.match(result.text, /differs only in case/);
  assert.deepEqual(fs.readdirSync(path.join(home, 'skills')), ['Dup-Skill']);
});
