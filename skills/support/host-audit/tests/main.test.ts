import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { configuredModel, HELP, main, measuredPluginTokens } from '../scripts/main.js';
import { loadRules, rulesFile, verifyDocs, type Fetcher } from '../scripts/rules.js';
import type { HostInventory } from '../scripts/types.js';

const NOW = Date.parse('2026-10-06T00:00:00Z'), SECRETS = ['tok-SECRET-123', 'env-SECRET-456', 'hdr-SECRET-789', 'query-SECRET-0'];
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-host-audit-'))); t.after(() => rmSync(base, { recursive: true, force: true }));
  const h = join(base, 'home'), pkg = join(base, 'pkg'), project = join(base, 'work', 'app');
  mkdirSync(project, { recursive: true });
  const put = (path: string, content: string | object) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content)); };
  put(join(h, '.claude', 'settings.json'), { skillOverrides: { 'jstack:plan': 'name-only', 'frontend:component': 'name-only' } });
  put(join(h, '.claude', 'commands', 'commit.md'), '---\ndescription: My own commit command\n---\nCommit.\n');
  // Six skills at the 1,536-char description cap overflow the 8,000-char budget of a 200K window.
  for (const n of [1, 2, 3, 4, 5, 6]) put(join(h, '.claude', 'skills', `big-${n}`, 'SKILL.md'), `---\nname: big-${n}\ndescription: "${'Large description. '.repeat(100)}"\n---\nBody.\n`);
  put(join(h, '.claude.json'), { mcpServers: { svc: { type: 'stdio', command: '/usr/local/bin/svc', args: [`--token=${SECRETS[0]}`], env: { API_KEY: SECRETS[1] } }, web: { type: 'http', url: `https://mcp.example.test/path?key=${SECRETS[3]}`, headers: { Authorization: SECRETS[2] } } } });
  put(join(h, '.codex', 'config.toml'), '# fixture\n');
  put(join(pkg, '.claude-plugin', 'plugin.json'), { name: 'jstack', version: '1.0.0', skills: ['./entries/claude/workflow/plan'], commands: ['./hosts/claude/commands'] });
  put(join(pkg, '.codex-plugin', 'plugin.json'), { name: 'jstack', version: '1.0.0', skills: './entries/codex' });
  put(join(pkg, 'entries', 'claude', 'workflow', 'plan', 'SKILL.md'), '---\nname: plan\ndescription: "Plan the work."\n---\n');
  put(join(pkg, 'entries', 'codex', 'workflow', 'plan', 'SKILL.md'), '---\nname: plan\ndescription: "Plan the work."\n---\n');
  put(join(pkg, 'hosts', 'claude', 'commands', 'commit.md'), '---\ndescription: Commit with the conventions\n---\n');
  put(join(pkg, 'payload', 'contracts', 'skill-catalog.json'), { entries: [{ owner: 'plan', name: 'plan', visibility: 'public', aliases: [] }] });
  return { h, pkg, project, extra: { managed: join(base, 'no-managed'), adminSkills: join(base, 'no-admin'), now: NOW } };
}
type Run = { status: number; stdout: string; stderr: string };
function runner(plugins: object[] = [], codexPlugins: object[] = []) {
  const calls: string[][] = [], seen: { call: string; env: NodeJS.ProcessEnv; cwd?: string }[] = [];
  const fn = (command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Run => {
    calls.push([command, ...args]); seen.push({ call: [command, ...args].join(' '), env, cwd }); const key = `${command} ${args.join(' ')}`;
    if (key === 'claude plugin list --json') return { status: 0, stdout: JSON.stringify(plugins), stderr: '' };
    if (key === 'claude --version') return { status: 0, stdout: '2.1.300 (Claude Code)\n', stderr: '' };
    if (key === 'codex plugin list --json') return { status: 0, stdout: JSON.stringify({ installed: codexPlugins, available: [] }), stderr: '' };
    if (key === 'codex --version') return { status: 0, stdout: 'codex-cli 0.160.1\n', stderr: '' };
    if (command === 'claude' && args.slice(-3).join(' ') === 'plugin details jstack') return { status: 0, stdout: 'jstack 1.0.0\n\nProjected token cost\n  Always-on:   ~1.2k tok   added to every session\n', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { fn, calls, seen };
}
/** Serves every cited quote except the one for `missing`, so exactly that rule drifts. */
function fetcher(missing: string): Fetcher {
  const { rules } = loadRules();
  return async url => ({ ok: true, text: rules.filter(rule => url.endsWith(rule.source) && rule.id !== missing).map(rule => rule.quote).join('\n') });
}
async function run(argv: string[], options: { extra: object; plugins?: object[]; codexPlugins?: object[]; fetch?: Fetcher }) {
  let stdout = '', stderr = ''; const r = runner(options.plugins, options.codexPlugins);
  const code = await main(argv, { stdout: { write: (text: string) => { stdout += text; return true; } }, stderr: { write: (text: string) => { stderr += text; return true; } } }, { HOME: '/nonexistent' }, { ...options.extra, runner: r.fn, fetcher: options.fetch });
  return { code, stdout, stderr, calls: r.calls, seen: r.seen };
}

test('audits both hosts against a package: drift first, measured cost, collisions, ineffective overrides, no secrets', async t => {
  const { h, pkg, extra } = fixture(t);
  const result = await run(['--home', h, '--package', pkg, '--verify-docs', '--measure'], { extra, fetch: fetcher('claude.listing.desc-cap') });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.match(lines[0]!, /^Documentation drift: https:\/\/code\.claude\.com\/docs\/en\/skills \(claude\.listing\.desc-cap\)/);
  assert.match(result.stdout, /\[warn\] claude: Claude listing is \d+ chars over budget at 200000 tokens \(unverified: documentation changed\)/);
  assert.match(result.stdout, /jstack always-on measured by claude --plugin-dir <package> plugin details jstack: 1,200 tokens/);
  assert.ok(result.calls.some(call => call.join(' ') === `claude --plugin-dir ${pkg} plugin details jstack`), 'the package is measured before it is installed');
  assert.match(result.stdout, /1 Claude command shares a name with jstack/);
  assert.match(result.stdout, /1 skillOverrides entry names a plugin skill, which overrides do not affect/);
  assert.match(result.stdout, /Rules were checked on claude 2\.1\.292; 2\.1\.300 is installed/);
  const json = await run(['--home', h, '--package', pkg, '--json'], { extra });
  const report = JSON.parse(json.stdout);
  assert.equal(report.schemaVersion, 1); assert.equal(report.docs, undefined, 'documentation is fetched only with --verify-docs');
  assert.ok(report.findings.some((f: { code: string }) => f.code === 'ineffective-override'));
  assert.deepEqual(report.hosts.map((row: { host: string }) => row.host), ['claude', 'codex']);
  for (const secret of SECRETS) { assert.ok(!result.stdout.includes(secret), secret); assert.ok(!json.stdout.includes(secret), secret); }
});

test('a second enabled jstack blocks with exit 1; bad usage exits 2 without auditing', async t => {
  const { h, extra } = fixture(t);
  const plugins = ['jstack-dev@local', 'jstack@jstack'].map(id => ({ id, version: '1.0.0', scope: 'user', enabled: true }));
  const blocked = await run(['--home', h, '--host', 'claude'], { extra, plugins });
  assert.equal(blocked.code, 1); assert.match(blocked.stdout, /\[block\] claude: 2 enabled Claude plugins are jstack/);
  assert.equal((await run(['--host', 'both'], { extra })).code, 2);
  const missing = await run(['--package', join(h, 'nowhere')], { extra });
  assert.equal(missing.code, 2); assert.match(missing.stderr, /--package not found/); assert.deepEqual(missing.calls, []);
});

test('the measured figure is read from the host report and absent when the host cannot say', () => {
  const report = (stdout: string, status = 0) => () => ({ status, stdout, stderr: '' });
  assert.equal(measuredPluginTokens(report('Projected token cost\n  Always-on:   ~5,734 tok   added to every session\n'), {}, 'jstack'), 5734);
  assert.equal(measuredPluginTokens(report('Projected token cost\n  Always-on: ~2.5k tok\n'), {}, 'jstack'), 2500);
  assert.equal(measuredPluginTokens(report('Plugin "jstack" not found.', 1), {}, 'jstack'), undefined);
  assert.equal(measuredPluginTokens(report('no cost section'), {}, 'jstack'), undefined);
});

test('--measure and the plugin list run with the profile of --home, in the project', async t => {
  const { h, pkg, project, extra } = fixture(t);
  const result = await run(['--home', h, '--project', project, '--package', pkg, '--measure', '--host', 'claude'], { extra });
  assert.equal(result.code, 0, result.stderr);
  const details = result.seen.find(row => row.call.endsWith('plugin details jstack'))!, list = result.seen.find(row => row.call === 'claude plugin list --json')!;
  for (const row of [details, list]) assert.deepEqual([row.env.HOME, row.env.CLAUDE_CONFIG_DIR, row.cwd], [h, join(h, '.claude'), project], row.call);
  assert.ok(result.seen.every(row => row.env.HOME === h), 'the process environment never reaches a host command');
  const bare = await run(['--home', h, '--package', pkg, '--measure', '--host', 'claude'], { extra });
  assert.equal(bare.seen.find(row => row.call.endsWith('plugin details jstack'))!.cwd, undefined, 'without --project the commands keep the process directory');
});

test('without --package each host reads the jstack plugin enabled on that host', async t => {
  const { h, pkg, extra } = fixture(t);
  const claudePlugin = { id: 'jstack@jstack', version: '1.0.0', scope: 'user', enabled: true, installPath: pkg };
  const codexPlugin = { pluginId: 'jstack@jstack', name: 'jstack', marketplaceName: 'jstack', version: '1.0.0', enabled: true, source: { source: 'local', path: pkg } };
  const installed = await run(['--home', h], { extra, plugins: [claudePlugin], codexPlugins: [codexPlugin] });
  assert.match(installed.stdout, new RegExp(`^jstack 1\\.0\\.0 installed at ${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(claude\\)`, 'm'));
  assert.match(installed.stdout, /1 Claude command shares a name with jstack/, 'a collision is found against the installed jstack');
  const fromCodex = await run(['--home', h], { extra, codexPlugins: [codexPlugin] });
  assert.match(fromCodex.stdout, /installed at .* \(codex\)/);
  assert.match(installed.stdout, /installed at .* \(codex\)/, 'both hosts have their own installed jstack named');
  const asPackage = JSON.parse((await run(['--home', h, '--package', pkg, '--json'], { extra })).stdout), asInstalled = JSON.parse((await run(['--home', h, '--json'], { extra, plugins: [claudePlugin] })).stdout);
  assert.deepEqual(asInstalled.jstack, [{ source: 'installed', path: pkg, version: '1.0.0', hosts: ['claude'] }]); assert.deepEqual(asPackage.jstack, [{ source: 'package', path: pkg, version: '1.0.0', hosts: ['claude', 'codex'] }]);
  const figures = (report: { listing: { host: string; totalChars: number; jstackChars: number }[] }, host: string) => report.listing.filter(row => row.host === host).map(row => [row.totalChars, row.jstackChars]);
  assert.deepEqual(figures(asInstalled, 'claude'), figures(asPackage, 'claude'), 'an installed jstack is counted once');
  assert.ok(figures(asPackage, 'codex').every(([, jstack]) => jstack! > 0) && figures(asInstalled, 'codex').every(([, jstack]) => jstack === 0), 'a package adds jstack to both hosts; a Claude-only install adds none to Codex');
  // Nothing installed, disabled, or not a jstack package: collisions are not checked, and the output says so.
  const notPackage = join(h, 'not-jstack'); mkdirSync(notPackage, { recursive: true });
  for (const plugins of [[], [{ ...claudePlugin, enabled: false }], [{ ...claudePlugin, installPath: notPackage }]]) {
    const none = await run(['--home', h, '--host', 'claude'], { extra, plugins });
    assert.match(none.stdout, /No --package and no enabled jstack plugin: collisions with jstack are not checked\./); assert.doesNotMatch(none.stdout, /shares a name with jstack/);
  }
  const unreadable = JSON.parse((await run(['--home', h, '--host', 'claude', '--json'], { extra, plugins: [{ ...claudePlugin, installPath: notPackage }] })).stdout);
  assert.equal(unreadable.jstack, undefined); assert.ok(unreadable.hosts[0].warnings.some((warning: string) => warning.includes('could not be read as a jstack package')));
});

test('the configured model is the option, then ANTHROPIC_MODEL, then the model setting', () => {
  const inventory = (model?: string) => [{ host: 'claude', settings: { skillOverrides: {}, usage: {}, model } }, { host: 'codex', settings: { skillOverrides: {}, usage: {} } }] as HostInventory[];
  assert.equal(configuredModel('opus', { ANTHROPIC_MODEL: 'sonnet' }, inventory('haiku')), 'opus');
  assert.equal(configuredModel(undefined, { ANTHROPIC_MODEL: 'sonnet' }, inventory('haiku')), 'sonnet');
  assert.equal(configuredModel(undefined, { ANTHROPIC_MODEL: '  ' }, inventory('haiku')), 'haiku');
  assert.equal(configuredModel(undefined, {}, inventory()), undefined);
  assert.equal(configuredModel(undefined, {}, inventory('haiku').slice(1)), undefined, 'only a Claude inventory carries the setting');
});

test('--model is accepted, and the help names the homes --home reads', async t => {
  const { h, extra } = fixture(t);
  assert.equal((await run(['--home', h, '--host', 'claude', '--model', 'opus[1m]'], { extra })).code, 0);
  assert.equal((await run(['--model'], { extra })).code, 2);
  assert.match(HELP, /--model ID/); assert.match(HELP, /DIRECTORY\/\.claude and DIRECTORY\/\.codex/); assert.match(HELP, /DIRECTORY\/\.agents, which is reported as a second home/);
  assert.match(HELP, /--model ID names the Claude model whose\s+characters per token \(3 or 4\) the listing budget uses/); assert.match(HELP, /the context windows stay 200K and 1M/);
  assert.doesNotMatch(HELP, /whose context\s+window/, '--model does not change the windows');
  assert.match(HELP, /each host is checked against the jstack plugin\s+enabled on that host/);
  const alias = JSON.parse((await run(['--home', h, '--host', 'claude', '--model', 'opus', '--json'], { extra })).stdout);
  assert.match(alias.listing[0].basis, /model alias "opus" cannot be resolved here, so 3 as for current models; an alias that resolves to an older model counts 4/);
  const over = alias.findings.find((f: { code: string }) => f.code === 'listing-over-budget');
  assert.match(over.detail, /If the alias "opus" resolves to an older model that counts 4 characters per token, the budget is 8000 chars and \d+ of \d+ entries would be listed by name only\./);
});

test('a Claude-only jstack leaves the Codex listing and the Codex name collisions as they are, and the output says which host has none', async t => {
  const { h, pkg, extra } = fixture(t);
  mkdirSync(join(h, '.agents', 'skills', 'plan'), { recursive: true }); writeFileSync(join(h, '.agents', 'skills', 'plan', 'SKILL.md'), '---\nname: plan\ndescription: My own planning skill\n---\nBody.\n');
  const claudePlugin = { id: 'jstack@jstack', version: '1.0.0', scope: 'user', enabled: true, installPath: pkg };
  const report = async (argv: string[], plugins: object[]) => JSON.parse((await run(['--home', h, ...argv, '--json'], { extra, plugins })).stdout);
  const without = await report([], []), claudeOnly = await report([], [claudePlugin]), packaged = await report(['--package', pkg], []);
  const codex = (r: typeof without) => ({ listing: r.listing.filter((row: { host: string }) => row.host === 'codex'), collisions: r.findings.filter((f: { code: string; host: string }) => f.code === 'name-collision' && f.host === 'codex') });
  assert.deepEqual(codex(claudeOnly), codex(without), 'the Codex listing and collisions are what they are without any jstack');
  assert.equal(codex(without).listing.every((row: { jstackChars: number }) => row.jstackChars === 0), true); assert.deepEqual(codex(without).collisions, []);
  assert.equal(claudeOnly.findings.filter((f: { code: string; host: string }) => f.code === 'name-collision' && f.host === 'claude').length, 1, 'Claude is still checked against its own jstack');
  assert.equal(codex(packaged).collisions.length, 1, 'a package applies to both hosts');
  assert.ok(codex(packaged).listing.every((row: { jstackChars: number }) => row.jstackChars > 0));
  const text = (await run(['--home', h], { extra, plugins: [claudePlugin] })).stdout;
  assert.match(text, /^jstack 1\.0\.0 installed at .* \(claude\): collisions, hooks and listing weight are checked against it\.$/m);
  assert.match(text, /^No enabled jstack plugin on codex: collisions with jstack are not checked there\.$/m);
  assert.match((await run(['--home', h, '--package', pkg], { extra })).stdout, /^jstack 1\.0\.0 package at .* \(claude, codex\): /m);
});

test('a settings copy of a jstack hook is a duplicate of the installed one, with and without --package, wherever the plugin is installed', async t => {
  const { h, pkg, extra } = fixture(t);
  const installPath = join(h, '.claude', 'plugins', 'cache', 'jstack', 'jstack', '1.0.0'), release = join(dirname(pkg), 'release');
  const jstackFiles = (dir: string) => {
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true }); mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'jstack', version: '1.0.0' }));
    writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/payload/hooks/commit-session.js"' }] }] } }));
  };
  jstackFiles(installPath); jstackFiles(release);
  const settingsCopy = (path: string) => writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${path}/payload/hooks/commit-session.js"` }] }] } }));
  const plugins = [{ id: 'jstack@jstack', version: '1.0.0', scope: 'user', enabled: true, installPath }];
  const duplicates = async (argv: string[], plugins: object[]) => (JSON.parse((await run(['--home', h, '--host', 'claude', ...argv, '--json'], { extra, plugins })).stdout).findings as { code: string; title: string; evidence: string[] }[]).filter(f => f.code === 'duplicate-hook');
  settingsCopy(installPath);
  for (const argv of [[], ['--package', release]]) {
    const found = await duplicates(argv, plugins);
    assert.equal(found.length, 1, argv.join(' ') || 'installed surface');
    assert.match(found[0]!.title, /^Hook node ~\/\.claude\/plugins\/cache\/jstack\/jstack\/1\.0\.0\/payload\/hooks\/commit-session\.js on Stop is registered by 2 sources$/);
    assert.deepEqual(found[0]!.evidence.sort(), ['plugin:jstack (all)', `user:${join(h, '.claude', 'settings.json')} (all)`].sort());
  }
  // Nothing installed: the package folder is where its hooks would run from, so a copy of that command is the same handler.
  settingsCopy(release);
  assert.equal((await duplicates(['--package', release], [])).length, 1);
  assert.equal((await duplicates([], [])).length, 0, 'without jstack there is nothing to duplicate');
});

test('a documentation page is fetched again once before it counts as unreachable, with a 60 second timeout', async () => {
  const { rules } = loadRules(), first = rules.filter(rule => rule.source !== 'observed').slice(0, 1), page = first.map(rule => rule.quote).join('\n');
  const flaky = (failures: number, how: 'fail' | 'throw') => {
    const timeouts: number[] = []; let calls = 0;
    const fetcher: Fetcher = async (_url, timeoutMs) => { timeouts.push(timeoutMs); if (++calls <= failures) { if (how === 'throw') throw new Error('network is down'); return { ok: false, text: '' }; } return { ok: true, text: page }; };
    return { fetcher, timeouts };
  };
  for (const how of ['fail', 'throw'] as const) {
    const once = flaky(1, how);
    assert.equal((await verifyDocs(first, once.fetcher))[0]!.status, 'ok', how); assert.deepEqual(once.timeouts, [60000, 60000]);
    const never = flaky(9, how);
    assert.equal((await verifyDocs(first, never.fetcher))[0]!.status, 'unreachable', how); assert.equal(never.timeouts.length, 2, 'exactly one retry');
  }
  const fine = flaky(0, 'fail');
  await verifyDocs(first, fine.fetcher); assert.equal(fine.timeouts.length, 1, 'a page that answers is fetched once');
});

/** The repository (or unpacked npm package) root above these tests; a payload copy of the skill has none. */
function packageRoot(): string | undefined {
  for (let dir = dirname(rulesFile()); ; dir = dirname(dir)) {
    try { if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === '@ysys143/jstack') return dir; } catch { /* keep walking up */ }
    if (dirname(dir) === dir) return undefined;
  }
}
test('the npm package carries the rules file that jst host-audit loads', () => {
  const root = packageRoot();
  if (!root) return; // The skill runs from a payload copy: there is no npm package to describe.
  const { files } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
  assert.equal(relative(root, rulesFile()).split(sep).join('/'), 'skills/support/host-audit/references/host-rules.json');
  for (const file of ['skills/support/host-audit/references/host-rules.json']) {
    assert.ok(files.includes(file), `package.json files lists ${file}`); assert.ok(existsSync(join(root, file)), `${file} exists`);
  }
});

test('a jstack entry file the audit cannot read is named in the report instead of being dropped silently', async t => {
  const { h, pkg, extra } = fixture(t);
  mkdirSync(join(pkg, 'agents'), { recursive: true });
  writeFileSync(join(pkg, 'agents', 'bad.md'), '---\nname: bad\ndescription: Propose changes: only some\n---\n');
  const result = await run(['--home', h, '--package', pkg, '--host', 'claude'], { extra });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /1 jstack entry file has frontmatter that is not valid YAML and is not counted: agents\/bad\.md/);
});
