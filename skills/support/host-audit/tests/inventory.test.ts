import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { handlerId, hostEnvironment, inventoryClaude, inventoryCodex, type InventoryOptions } from '../scripts/inventory.js';
import type { HostInventory } from '../scripts/types.js';
import { displayWidth } from '../scripts/width.js';

type Runner = NonNullable<InventoryOptions['runner']>;
/** A temporary directory standing in for the user's home; the real profiles are never read. */
function temp(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-host-audit-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root: string, file: string, content: string | object): string {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}
const skill = (name: string, description: string, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\nBody text.\n`;
/** Answers only the listed command lines; everything else fails. Every call is recorded. */
function runner(answers: Record<string, string>, calls: string[][] = [], envs: NodeJS.ProcessEnv[] = [], dirs: (string | undefined)[] = []): Runner {
  return (command, args, env, cwd) => {
    calls.push([command, ...args]); envs.push(env); dirs.push(cwd);
    const out = answers[[command, ...args].join(' ')];
    return out === undefined ? { status: 127, stdout: '', stderr: 'unavailable' } : { status: 0, stdout: out, stderr: '' };
  };
}
const failing: Runner = () => ({ status: 1, stdout: '', stderr: 'failed' });
const claude = (root: string, options: InventoryOptions = {}) => inventoryClaude({ home: root, managed: join(root, 'no-managed'), ...options });
const find = (inventory: HostInventory, qualified: string) => inventory.entries.find(entry => entry.qualified === qualified);
const SECRETS = ['EMAILSECRET', 'ENVSECRET', 'HEADERSECRET', 'ARGSECRET', 'QUERYSECRET', 'URLSECRET', 'PATHSECRET', 'HOOKSECRET', 'COMMANDSECRET', 'QUOTEDSECRET', 'SHELLSECRET', 'DEFAULTSECRET'];

/** A Claude profile with user, project, synced and plugin content; returns the project directory. */
function claudeFixture(root: string): string {
  const folded = 'description: >\n  First folded line\n  second folded line\nwhen_to_use: |\n  Use when asked\n  about blocks.\n';
  put(root, '.claude/skills/block-skill/SKILL.md', `---\nname: block-skill\n${folded}---\nBody\n`);
  put(root, '.claude/skills/quiet-skill/SKILL.md', skill('quiet-skill', 'Quiet one', 'disable-model-invocation: true\nuser-invocable: no\n'));
  put(root, '.claude/skills/plain-skill/SKILL.md', '# Plain heading\nSecond line\n');
  put(root, '.claude/skills/quoted-skill/SKILL.md', skill('quoted-skill', '"A quoted: description"'));
  put(root, '.claude/skills/default-skill/SKILL.md', skill('default-skill', 'User skill sharing a name with a plugin skill'));
  put(root, '.claude/skills/broken-skill/SKILL.md', '---\ndescription: [unclosed\n---\nFallback line\n');
  put(root, '.claude/skills/.trash/old/SKILL.md', skill('old', 'Trashed'));
  put(root, '.claude/skills/colon-skill/SKILL.md', '---\nname: colon-skill\ndescription: Manage things: search, create\n---\n');
  put(root, '.claude/skills/synced/ORG1_ACC1/pdf/SKILL.md', skill('pdf', 'Synced from claude.ai'));
  put(root, '.claude/skills/synced/ORG2_ACC2/other/SKILL.md', skill('other', 'Another account'));
  put(root, '.claude/commands/ns/cmd.md', '---\ndescription: Run it\n---\nDo it\n');
  put(root, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews code\n---\nPrompt\n');
  put(root, '.claude/agents/notes.md', '# Notes kept beside the agents\n');
  put(root, '.claude/agents/no-desc.md', '---\nname: no-desc\n---\nPrompt\n');
  put(root, '.claude/settings.json', {
    skillOverrides: { 'quiet-skill': 'name-only', 'block-skill': 'bogus', 'default-skill': 'off' },
    skillListingBudgetFraction: 0.02, env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: '12000' }, enabledPlugins: { 'demo@mkt': true },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
      { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs" go' },
      { type: 'command', command: 'node', args: ['$HOME/.claude/hooks/guard.js', '--flag'] },
      { type: 'command', command: 'echo hello COMMANDSECRET' },
      { type: 'command', command: "/bin/sh '/opt/tools/bin/check.sh' HOOKSECRET" },
      { type: 'command', command: 'FOO=HOOKSECRET python3 ~/x/y/z.py' },
      { type: 'command', command: `bash -c 'curl -H "X-Key: HOOKSECRET" https://x.example.com/a/PATHSECRET'` },
      { type: 'command', command: 'bash -c "$HOME/bin/notify --token QUOTEDSECRET"' },
      { type: 'command', command: 'sh -c "/usr/local/bin/push SHELLSECRET now"' },
      { type: 'command', command: '/usr/local/bin/push "${API_TOKEN:-DEFAULTSECRET}"' },
      { type: 'http', url: 'https://hooks.example.com/PATHSECRET?token=QUERYSECRET', headers: { Authorization: 'Bearer HEADERSECRET' } },
    ] }], Stop: [{ hooks: [{ type: 'command', command: 'curl -H "Authorization: Bearer HOOKSECRET" https://api.example.com/PATHSECRET?k=QUERYSECRET' }] }] },
  });
  const work = join(root, 'work'), app = join(work, 'app');
  mkdirSync(join(work, '.git'), { recursive: true });
  put(work, '.claude/skills/root-skill/SKILL.md', skill('root-skill', 'Repository root skill'));
  put(app, '.claude/skills/app-skill/SKILL.md', skill('app-skill', 'Project skill'));
  put(work, '.claude/agents/proj-agent.md', '---\nname: proj-agent\ndescription: Project agent\n---\n');
  put(app, '.claude/commands/ship.md', 'Ship the change\n');
  put(work, '.claude/commands/root-cmd.md', 'Repository root command\n');
  put(app, '.claude/settings.json', { skillListingMaxDescChars: 2048, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash ./scripts/stop.sh' }] }] } });
  put(app, '.claude/settings.local.json', { skillOverrides: { 'quiet-skill': 'off' }, disableAllHooks: true });
  put(app, '.mcp.json', { mcpServers: { shared: { type: 'http', url: 'https://mcp.example.com:8443/v1/PATHSECRET?key=URLSECRET', headers: { Authorization: 'Bearer HEADERSECRET' }, alwaysLoad: true } } });
  put(root, '.claude.json', {
    skillUsage: { 'block-skill': { usageCount: 3, lastUsedAt: 1700000000000 }, bad: 'x' }, oauthAccount: { accountUuid: 'ACC1', organizationUuid: 'ORG1', emailAddress: 'EMAILSECRET@example.com' },
    mcpServers: { tools: { type: 'stdio', command: '/opt/tools/bin/npx', args: ['-y', 'pkg', '--token=ARGSECRET'], env: { API_KEY: 'ENVSECRET' } },
      inline: { command: 'bash -c "TOKEN=COMMANDSECRET run"' } },
    projects: { [app]: { mcpServers: { scratch: { type: 'sse', url: 'https://sse.example.com/events/PATHSECRET?auth=QUERYSECRET', headers: { 'X-Key': 'HEADERSECRET' } } }, disabledMcpServers: ['tools'] } },
  });
  // Plugins: `demo` uses every default folder plus manifest additions; `rep` replaces commands and agents; `off` is disabled.
  const demo = join(root, '.claude/plugins/cache/mkt/demo/1.0.0');
  put(demo, '.claude-plugin/plugin.json', { name: 'demo', skills: ['./extra', './single'],
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/start.sh' }] }] },
    mcpServers: { inline: { type: 'http', url: 'https://inline.example.com/x?k=QUERYSECRET' } } });
  put(demo, 'skills/default-skill/SKILL.md', skill('default-skill', 'Plugin default skill'));
  put(demo, 'extra/a-skill/SKILL.md', skill('a-skill', 'Extra skill'));
  put(demo, 'single/SKILL.md', skill('single-skill', 'Folder that holds SKILL.md directly'));
  put(demo, 'commands/deploy/run.md', '---\ndescription: Deploy\n---\n');
  put(demo, 'agents/sub/helper.md', '---\nname: helper\ndescription: Helps\n---\n');
  put(demo, 'hooks/hooks.json', { hooks: { PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/scripts/fmt.sh"' }] }] } });
  put(demo, '.mcp.json', { mcpServers: { db: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js', '--token=ARGSECRET'], env: { TOKEN: 'ENVSECRET' } } } });
  const rep = join(root, '.claude/plugins/cache/mkt/rep/2.0.0');
  put(rep, '.claude-plugin/plugin.json', { name: 'rep', commands: ['./cmds/one.md'], agents: ['./custom/review/sec.md'] });
  put(rep, 'commands/ignored.md', 'Ignored: the manifest replaces commands/\n');
  put(rep, 'cmds/one.md', 'First line of one\n');
  put(rep, 'agents/ignored-agent.md', '---\nname: ignored-agent\ndescription: Ignored\n---\n');
  put(rep, 'custom/review/sec.md', '---\nname: security\ndescription: Security review\n---\n');
  const off = join(root, '.claude/plugins/cache/mkt/off/1.0.0');
  put(off, '.claude-plugin/plugin.json', { name: 'off' });
  put(off, 'skills/hidden/SKILL.md', skill('hidden', 'Never listed'));
  return app;
}
const pluginList = (root: string) => JSON.stringify([
  { id: 'demo@mkt', version: '1.0.0', scope: 'user', enabled: true, installPath: join(root, '.claude/plugins/cache/mkt/demo/1.0.0') },
  { id: 'rep@mkt', version: '2.0.0', scope: 'user', enabled: true, installPath: join(root, 'moved'), readFromFolder: join(root, '.claude/plugins/cache/mkt/rep/2.0.0') },
  { id: 'off@mkt', version: '1.0.0', scope: 'user', enabled: false, installPath: join(root, '.claude/plugins/cache/mkt/off/1.0.0') },
]);

test('a Claude profile is inventoried from user, project, synced and plugin sources', t => {
  const root = temp(t), project = claudeFixture(root), calls: string[][] = [], envs: NodeJS.ProcessEnv[] = [], dirs: (string | undefined)[] = [];
  const inventory = claude(root, { project, runner: runner({ 'claude plugin list --json': pluginList(root), 'claude --version': '2.1.291 (Claude Code)\n' }, calls, envs, dirs) });
  assert.deepEqual(calls, [['claude', 'plugin', 'list', '--json'], ['claude', '--version']]);
  assert.equal(envs[0]!.CLAUDE_CONFIG_DIR, join(root, '.claude')); assert.equal(envs[0]!.HOME, root);
  assert.deepEqual(dirs, [project, undefined], 'the plugin list runs in the project so it reflects that project\'s plugins');
  assert.deepEqual([inventory.host, inventory.home, inventory.homeSource, inventory.version], ['claude', join(root, '.claude'), 'option', '2.1.291']);
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.id, plugin.enabled, plugin.scope, plugin.version]), [['demo@mkt', true, 'user', '1.0.0'], ['rep@mkt', true, 'user', '2.0.0'], ['off@mkt', false, 'user', '1.0.0']]);
  assert.equal(inventory.plugins[1]!.path, join(root, '.claude/plugins/cache/mkt/rep/2.0.0'), 'readFromFolder wins over installPath');

  // Descriptions are measured after YAML parsing: block scalars, quotes, and the first-line fallback.
  const block = find(inventory, 'block-skill')!;
  assert.deepEqual([block.origin, block.descriptionChars, block.whenToUseChars], ['user', 'First folded line second folded line'.length, 'Use when asked\nabout blocks.'.length]);
  assert.equal(block.override, undefined, 'an unknown override value is ignored'); assert.ok(inventory.warnings.some(warning => warning.includes('skillOverrides.block-skill')));
  assert.equal(find(inventory, 'quoted-skill')!.descriptionChars, 'A quoted: description'.length);
  assert.equal(find(inventory, 'plain-skill')!.descriptionChars, 'Plain heading'.length, 'the fallback is the first body line without its heading marks');
  const quiet = find(inventory, 'quiet-skill')!;
  assert.deepEqual([quiet.disableModelInvocation, quiet.userInvocable, quiet.override], [true, false, 'off']);
  assert.ok(inventory.warnings.some(warning => warning.includes('broken-skill') && warning.includes('not valid YAML')));
  assert.equal(inventory.entries.some(entry => entry.name === 'old' || entry.name === 'synced'), false);
  const synced = find(inventory, 'anthropic-skills:pdf')!;
  assert.deepEqual([synced.origin, synced.name], ['connector', 'pdf']);
  assert.equal(find(inventory, 'anthropic-skills:other'), undefined, 'only the signed-in account folder loads');
  assert.equal(find(inventory, 'colon-skill')!.descriptionChars, 'Manage things: search, create'.length, 'Claude Code quotes plain values that are not strict YAML');

  // Commands, agents, and the project chain: skills, commands and agents from every .claude folder up to the repository root.
  assert.deepEqual([find(inventory, 'ns:cmd')!.kind, find(inventory, 'ns:cmd')!.name, find(inventory, 'ns:cmd')!.descriptionChars], ['command', 'cmd', 'Run it'.length]);
  assert.equal(find(inventory, 'reviewer')!.kind, 'agent');
  assert.equal(find(inventory, 'notes'), undefined); assert.equal(find(inventory, 'no-desc'), undefined);
  assert.ok(inventory.warnings.some(warning => warning.includes('no-desc.md')));
  for (const name of ['app-skill', 'root-skill', 'proj-agent', 'ship', 'root-cmd']) assert.equal(find(inventory, name)!.origin, 'project', name);

  // Plugins: skills add to skills/, commands and agents replace their defaults, names are qualified, overrides never reach plugin entries.
  const names = inventory.entries.filter(entry => entry.origin === 'plugin').map(entry => entry.qualified).sort();
  assert.deepEqual(names, ['demo:a-skill', 'demo:default-skill', 'demo:deploy:run', 'demo:single-skill', 'demo:sub:helper', 'rep:one', 'rep:security']);
  assert.equal(find(inventory, 'demo:default-skill')!.override, undefined); assert.equal(find(inventory, 'default-skill')!.override, 'off');
  assert.equal(find(inventory, 'demo:default-skill')!.plugin, 'demo@mkt');
  // What each entry keeps a synced skill from answering to: the user's skill its name, a command its listed name, a plugin skill its frontmatter name; an agent, a synced skill and a nameless plugin command nothing.
  assert.deepEqual(['default-skill', 'ns:cmd', 'demo:default-skill', 'demo:deploy:run', 'reviewer', 'anthropic-skills:pdf'].map(name => find(inventory, name)!.holds), [['default-skill'], ['ns:cmd'], ['default-skill'], undefined, undefined, undefined]);
  assert.equal(find(inventory, 'rep:one')!.descriptionChars, 'First line of one'.length);

  // Settings: later files win; the budget comes from the settings env block; usage keeps counts and times.
  assert.deepEqual(inventory.settings, { skillOverrides: { 'quiet-skill': 'off', 'default-skill': 'off' }, skillListingBudgetFraction: 0.02, skillListingMaxDescChars: 2048, listingCharBudget: 12000, disableAllHooks: true,
    usage: { 'block-skill': { count: 3, lastUsedAt: 1700000000000 } } });

  // Hooks: one entry per handler, identified by its command line; tokens that could carry a secret are `<arg>`.
  const hook = (event: string, origin: string) => inventory.hooks.filter(entry => entry.event === event && entry.origin === origin).map(entry => [entry.matcher, entry.handler]);
  assert.deepEqual(hook('PreToolUse', 'user'), [['Bash', 'node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs go'], ['Bash', 'node ~/.claude/hooks/guard.js --flag'], ['Bash', 'echo hello <arg>'], ['Bash', '/bin/sh /opt/tools/bin/check.sh <arg>'],
    ['Bash', '<arg> python3 ~/x/y/z.py'], ['Bash', 'bash -c <arg>'], ['Bash', 'bash -c <arg>'], ['Bash', 'sh -c <arg>'], ['Bash', '/usr/local/bin/push <arg>'], ['Bash', 'http:hooks.example.com']]);
  assert.deepEqual(hook('Stop', 'user'), [['', 'curl -H <arg> <arg>']]); assert.deepEqual(hook('Stop', 'project'), [['', 'bash ./scripts/stop.sh']]);
  const demoRoot = '~/.claude/plugins/cache/mkt/demo/1.0.0';
  assert.deepEqual(hook('SessionStart', 'plugin'), [['startup', `${demoRoot}/scripts/start.sh`]]); assert.deepEqual(hook('PostToolUse', 'plugin'), [['Write|Edit', `${demoRoot}/scripts/fmt.sh`]]);

  // MCP: shape only.
  const mcp = (name: string) => inventory.mcp.find(server => server.name === name)!;
  assert.deepEqual([mcp('tools').origin, mcp('tools').transport, mcp('tools').command, mcp('tools').enabled], ['user', 'stdio', 'npx', false]);
  assert.deepEqual([mcp('inline').command, mcp('inline').enabled], ['bash', undefined]);
  assert.deepEqual([mcp('scratch').origin, mcp('scratch').transport, mcp('scratch').endpoint], ['local', 'sse', 'https://sse.example.com']);
  assert.deepEqual([mcp('shared').origin, mcp('shared').transport, mcp('shared').endpoint, mcp('shared').alwaysLoad], ['project', 'http', 'https://mcp.example.com:8443', true]);
  assert.deepEqual([mcp('plugin:demo:db').origin, mcp('plugin:demo:db').plugin, mcp('plugin:demo:db').command], ['plugin', 'demo@mkt', 'node']);
  assert.deepEqual([mcp('plugin:demo:inline').transport, mcp('plugin:demo:inline').endpoint], ['http', 'https://inline.example.com']);
  const text = JSON.stringify(inventory);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `${secret} must not appear in the inventory`);
});

test('the process environment overrides the settings budget and homes follow option, env and default', t => {
  const root = temp(t);
  put(root, '.claude/settings.json', { env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: 12000 } });
  const quiet = runner({});
  assert.equal(claude(root, { runner: quiet }).settings.listingCharBudget, 12000);
  assert.equal(claude(root, { runner: quiet, env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: '9000' } }).settings.listingCharBudget, 9000);
  // CLAUDE_CONFIG_DIR: the profile and its .claude.json both live in that directory.
  const alt = join(root, 'alt');
  put(alt, '.claude.json', { skillUsage: { x: { usageCount: 1 } } }); put(root, '.claude.json', { skillUsage: { y: { usageCount: 2 } } });
  const viaEnv = inventoryClaude({ env: { CLAUDE_CONFIG_DIR: alt, HOME: root }, runner: quiet, managed: join(root, 'no-managed') });
  assert.deepEqual([viaEnv.homeSource, viaEnv.home, Object.keys(viaEnv.settings.usage)], ['env', alt, ['x']]);
  const byDefault = inventoryClaude({ env: { HOME: root }, runner: quiet, managed: join(root, 'no-managed') });
  assert.deepEqual([byDefault.homeSource, byDefault.home, Object.keys(byDefault.settings.usage)], ['default', join(root, '.claude'), ['y']]);
  // Synced skills of two accounts when the signed-in one is unknown: all are counted, with a warning.
  put(root, '.claude/skills/synced/A_B/one/SKILL.md', skill('one', 'First')); put(root, '.claude/skills/synced/C_D/two/SKILL.md', skill('two', 'Second'));
  const ambiguous = claude(root, { runner: quiet });
  assert.deepEqual(ambiguous.entries.map(entry => entry.qualified), ['anthropic-skills:one', 'anthropic-skills:two']);
  assert.ok(ambiguous.warnings.some(warning => warning.includes('signed-in one cannot be identified')));
  put(root, '.claude/settings.json', { syncClaudeAiSkills: false });
  assert.deepEqual(claude(root, { runner: quiet }).entries, [], 'syncClaudeAiSkills false stops the synced skills from loading');
});

test('a synced skill takes its full-name override, and its bare-name override only while no other command holds the name', t => {
  const root = temp(t), project = join(root, 'proj'), plugin = join(root, '.claude/plugins/cache/mkt/plug/1.0.0'), declared = join(root, '.claude/plugins/cache/mkt/declared/1.0.0');
  const synced = ['full', 'bare', 'byuser', 'bycmd', 'byplugin', 'byplugincmd', 'byaliascmd', 'bynoname', 'bycolon', 'byagent', 'both', 'heldboth', 'casey', 'plain', 'constructor', 'bynested', 'viamanifest', 'nameless'];
  for (const name of synced) put(root, `.claude/skills/synced/ORG_ACC/${name}/SKILL.md`, skill(name, 'Synced from claude.ai'));
  put(root, '.claude/skills/byuser/SKILL.md', skill('byuser', 'User skill'));
  put(root, '.claude/skills/Casey/SKILL.md', skill('Casey', 'User skill of another case'));
  put(root, '.claude/skills/heldboth/SKILL.md', skill('heldboth', 'User skill'));
  put(root, '.claude/agents/byagent.md', '---\nname: byagent\ndescription: An agent never holds a skill name\n---\n');
  put(project, '.claude/commands/bycmd.md', 'Project command\n');
  put(project, '.claude/commands/ns/bynested.md', 'Project command in a subfolder\n');
  put(plugin, '.claude-plugin/plugin.json', { name: 'plug' });
  put(plugin, 'skills/byplugin/SKILL.md', skill('byplugin', 'Plugin skill that names itself'));
  put(plugin, 'skills/bynoname/SKILL.md', '---\ndescription: Plugin skill without a frontmatter name\n---\n');
  put(plugin, 'skills/bycolon/SKILL.md', skill('plug:bycolon', 'Plugin skill whose name has a colon'));
  put(plugin, 'commands/byplugincmd.md', '---\ndescription: Plugin command without a frontmatter name\n---\n');
  put(plugin, 'commands/byaliascmd.md', '---\nname: byaliascmd\ndescription: Plugin command that names itself\n---\n');
  put(declared, '.claude-plugin/plugin.json', { name: 'declared', commands: { viamanifest: { content: '---\nname: viamanifest\ndescription: Command declared in the manifest\n---\n' }, nameless: { content: 'Command declared in the manifest without a name\n' } } });
  put(root, '.claude/settings.json', { skillOverrides: { 'anthropic-skills:full': 'off', bare: 'off', byuser: 'name-only', bycmd: 'name-only', byplugin: 'off', byplugincmd: 'off', byaliascmd: 'off', bynoname: 'off', bycolon: 'off', byagent: 'off',
    'anthropic-skills:both': 'name-only', both: 'off', 'anthropic-skills:heldboth': 'off', heldboth: 'name-only', casey: 'off', bynested: 'off', viamanifest: 'off', nameless: 'off' } });
  const list = JSON.stringify([{ id: 'plug@mkt', enabled: true, scope: 'user', installPath: plugin }, { id: 'declared@mkt', enabled: true, scope: 'user', installPath: declared }]);
  const inventory = claude(root, { project, runner: runner({ 'claude plugin list --json': list }) });
  const overrideOf = (qualified: string) => find(inventory, qualified)?.override;
  assert.deepEqual(synced.map(name => overrideOf(`anthropic-skills:${name}`)), ['off', 'off', undefined, undefined, undefined, 'off', undefined, 'off', 'off', 'off', 'name-only', 'off', undefined, undefined, undefined, 'off', undefined, 'off'],
    'the full name always applies; the bare name applies unless a user or project skill or command holds it, or a plugin skill or command (a manifest-declared one too) whose frontmatter names it; a plugin entry without that name, a command in a subfolder and an agent do not hold it');
  assert.equal(overrideOf('ns:bynested'), undefined, 'the subfolder command is listed as ns:bynested, so the bare key is not its own either');
  // The bare entry applies to the command that holds the name; overrides never reach a plugin entry.
  assert.deepEqual(['byuser', 'bycmd', 'byplugin', 'plug:byplugin', 'plug:byplugincmd', 'plug:byaliascmd', 'heldboth'].map(overrideOf), ['name-only', 'name-only', undefined, undefined, undefined, undefined, 'name-only']);
  assert.equal(overrideOf('Casey'), undefined, 'a key is matched by its exact spelling, but a namesake of another case still holds the bare name');
  // What each entry holds: a skill its name, a command the name it is listed under, a plugin entry its frontmatter name without a colon; never an agent or a synced skill.
  assert.deepEqual(['byuser', 'bycmd', 'ns:bynested', 'plug:byplugin', 'plug:bynoname', 'plug:bycolon', 'plug:byplugincmd', 'plug:byaliascmd', 'declared:viamanifest', 'declared:nameless', 'byagent', 'anthropic-skills:bare'].map(name => find(inventory, name)?.holds),
    [['byuser'], ['bycmd'], ['ns:bynested'], ['byplugin'], undefined, undefined, undefined, ['byaliascmd'], ['viamanifest'], undefined, undefined, undefined]);
  // The plugin entries are listed after the synced ones, so the bare name is resolved once every entry is known.
  const origins = inventory.entries.map(entry => entry.origin);
  assert.ok(origins.lastIndexOf('connector') < origins.indexOf('plugin'));
});

test('a user or project skill holds its folder name and its frontmatter name, and a settings key reaches it under the folder name only', t => {
  const root = temp(t);
  put(root, '.claude/skills/pptx/SKILL.md', skill('renamed-deck', 'Folder pptx, name renamed-deck'));
  put(root, '.claude/skills/sheet-folder/SKILL.md', skill('xlsx', 'Folder sheet-folder, name xlsx'));
  const synced = ['pptx', 'renamed-deck', 'sheet-folder', 'xlsx', 'free'];
  for (const name of synced) put(root, `.claude/skills/synced/ORG_ACC/${name}/SKILL.md`, skill(name, 'Synced from claude.ai'));
  put(root, '.claude/settings.json', { skillOverrides: { pptx: 'off', 'renamed-deck': 'name-only', 'sheet-folder': 'name-only', xlsx: 'off', free: 'off' } });
  const inventory = claude(root, { runner: runner({}) }), deck = find(inventory, 'renamed-deck')!, sheet = find(inventory, 'xlsx')!;
  assert.deepEqual([deck.name, deck.qualified, deck.holds, deck.override], ['renamed-deck', 'renamed-deck', ['pptx', 'renamed-deck'], 'off'], 'the key under the folder name reaches the skill; the one under its frontmatter name does not');
  assert.deepEqual([sheet.name, sheet.qualified, sheet.holds, sheet.override], ['xlsx', 'xlsx', ['sheet-folder', 'xlsx'], 'name-only'], 'the key xlsx does not reach the skill whose frontmatter name it is');
  assert.deepEqual(synced.map(name => find(inventory, `anthropic-skills:${name}`)!.override), [undefined, undefined, undefined, undefined, 'off'], 'both names keep a synced skill from the bare key');
});

test('a command holds the name it is listed under, from every .claude/commands folder up to the repository root, and not its frontmatter name', t => {
  const root = temp(t), repo = join(root, 'outer/repo'), mid = join(repo, 'mid'), project = join(mid, 'app');
  mkdirSync(join(repo, '.git'), { recursive: true });
  put(root, 'outer/.claude/commands/above.md', 'Above the repository root\n');
  put(repo, '.claude/commands/rootcmd.md', 'Repository root command\n');
  put(mid, '.claude/commands/midcmd.md', 'Command between the root and the project\n');
  put(project, '.claude/commands/appcmd.md', 'Project command\n');
  put(project, '.claude/commands/zz-cmd.md', '---\nname: xlsx\ndescription: The frontmatter name of a command holds nothing\n---\n');
  put(root, '.claude/commands/usercmd.md', '---\nname: docx\ndescription: Nor does the one of a user command\n---\n');
  put(root, '.claude/skills/deck/SKILL.md', skill('cafe\u0301', 'User skill whose name is decomposed'));
  const synced = ['rootcmd', 'midcmd', 'appcmd', 'above', 'xlsx', 'docx', 'usercmd'];
  for (const name of synced) put(root, `.claude/skills/synced/ORG_ACC/${name}/SKILL.md`, skill(name, 'Synced from claude.ai'));
  put(root, '.claude/skills/synced/ORG_ACC/cafe/SKILL.md', skill('caf\u00e9', 'Synced skill whose name is composed'));
  put(root, '.claude/settings.json', { skillOverrides: Object.fromEntries([...synced, 'caf\u00e9'].map(name => [name, 'off'])) });
  const inventory = claude(root, { project, runner: runner({}) });
  assert.deepEqual(['rootcmd', 'midcmd', 'appcmd', 'zz-cmd'].map(name => [find(inventory, name)?.origin, find(inventory, name)?.holds]), [['project', ['rootcmd']], ['project', ['midcmd']], ['project', ['appcmd']], ['project', ['zz-cmd']]]);
  assert.equal(find(inventory, 'above'), undefined, 'a folder above the repository root is not read');
  assert.deepEqual([find(inventory, 'usercmd')!.origin, find(inventory, 'usercmd')!.holds], ['user', ['usercmd']]);
  assert.deepEqual([...synced, 'caf\u00e9'].map(name => find(inventory, `anthropic-skills:${name}`)?.override), [undefined, undefined, undefined, 'off', 'off', 'off', undefined, undefined],
    'a command of a parent folder and a user command hold their names; the frontmatter name of a command and a folder above the root do not; a name that differs only in Unicode form still holds');
});

test('a Claude plugin list that fails falls back to installed_plugins.json and enabledPlugins', t => {
  const root = temp(t), project = claudeFixture(root);
  const base = join(root, '.claude/plugins/cache/mkt');
  put(root, '.claude/plugins/installed_plugins.json', { version: 2, plugins: {
    'demo@mkt': [{ scope: 'user', installPath: join(base, 'demo/1.0.0'), version: '1.0.0' }],
    'off@mkt': [{ scope: 'user', installPath: join(base, 'off/1.0.0'), version: '1.0.0' }],
    'elsewhere@mkt': [{ scope: 'project', projectPath: join(root, 'other'), installPath: join(base, 'demo/1.0.0') }],
    'rep@mkt': [{ scope: 'user', installPath: join(base, 'rep/2.0.0'), version: '2.0.0' }] } });
  put(root, '.claude/settings.json', { enabledPlugins: { 'demo@mkt': true, 'off@mkt': false } });
  for (const broken of [failing, () => { throw new Error('boom'); }]) {
    const inventory = claude(root, { project, runner: broken });
    assert.deepEqual(inventory.plugins.map(plugin => [plugin.id, plugin.enabled]), [['demo@mkt', true], ['off@mkt', false], ['rep@mkt', true]]);
    assert.ok(inventory.warnings.some(warning => warning.includes('claude plugin list --json failed')));
    assert.equal(inventory.version, undefined); assert.ok(inventory.warnings.some(warning => warning.includes('claude --version')));
    assert.equal(find(inventory, 'demo:a-skill')!.origin, 'plugin'); assert.equal(find(inventory, 'hidden'), undefined);
  }
});

test('unreadable or invalid Claude files become warnings without their content', t => {
  const root = temp(t);
  put(root, '.claude/settings.json', '{"token": "BROKENSECRET",');
  put(root, '.claude.json', 'not json BROKENSECRET');
  put(root, '.claude/skills/bad/SKILL.md', '---\ndescription: [unclosed BROKENSECRET\n---\n');
  put(root, 'work/app/.mcp.json', '[BROKENSECRET');
  mkdirSync(join(root, 'work/app/.git'), { recursive: true });
  mkdirSync(join(root, 'work/app/.claude/settings.local.json'), { recursive: true });
  const inventory = claude(root, { project: join(root, 'work/app'), runner: runner({ 'claude plugin list --json': 'BROKENSECRET' }) });
  const warnings = inventory.warnings.join('\n');
  for (const piece of ['settings.json is not valid JSON', '.claude.json is not valid JSON', 'bad/SKILL.md has frontmatter', '.mcp.json is not valid JSON', 'settings.local.json could not be read (EISDIR)', 'claude plugin list --json failed']) assert.ok(warnings.includes(piece), piece);
  assert.equal(warnings.includes('BROKENSECRET'), false);
  assert.equal(find(inventory, 'bad')!.descriptionChars, 0, 'unparsable frontmatter leaves the metadata empty');
});

/** A Codex home with config.toml, agents, hooks, skills, plugins and a second home; returns the project directory. */
function codexFixture(root: string): string {
  const skills = join(root, '.agents/skills');
  put(root, '.codex/config.toml', `[features]\nunified_exec = true\n\n[skills]\nmax_context_tokens = 4000\n\n[[skills.config]]\npath = ${JSON.stringify(join(skills, 'alpha/SKILL.md'))}\nenabled = false\n\n`
    + '[mcp_servers.docs]\nurl = "https://docs.example.com/mcp/PATHSECRET?key=QUERYSECRET"\nbearer_token_env_var = "DOCS_TOKEN"\nhttp_headers = { Authorization = "Bearer HEADERSECRET" }\n\n'
    + '[mcp_servers.local]\ncommand = "/usr/local/bin/uvx"\nargs = ["pkg", "--token=ARGSECRET"]\nenv = { API_KEY = "ENVSECRET" }\nenabled = false\n\n'
    + '[plugins."demo@mkt"]\nenabled = true\n\n[plugins."demo@mkt".mcp_servers.srv]\nenabled = false\n\n[agents.planner]\ndescription = "Plans work"\n\n'
    + '[[hooks.Stop]]\nmatcher = "done"\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "python3 ~/.codex/hooks/stop.py"\n\n[hooks.state."/x/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:abc"\n');
  put(root, '.codex/agents/reviewer.toml', 'name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = "Be strict"\n');
  put(root, '.codex/agents/bad.toml', 'name = "bad"\n');
  put(root, '.codex/hooks.json', { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh /x/bin/guard.sh' }, { type: 'mcp_tool', server: 'docs', tool: 'scan' }] }] } });
  put(root, '.codex/skills/.system/imagegen/SKILL.md', skill('imagegen', 'Bundled'));
  put(root, '.agents/config.toml', '# second home\n');
  put(skills, 'alpha/SKILL.md', skill('alpha', 'Disabled in config'));
  put(skills, 'cat/beta/SKILL.md', skill('beta', 'Nested skill', ''));
  put(skills, 'cat/beta/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
  put(skills, 'gamma/SKILL.md', '---\nname: gamma\ndescription: >\n  Folded\n  text\n---\n');
  put(skills, 'colon/SKILL.md', '---\nname: colon\ndescription: Not strict YAML: Codex skips it\n---\n');
  put(root, 'admin/delta/SKILL.md', skill('delta', 'Admin skill'));
  const work = join(root, 'work'), app = join(work, 'app');
  mkdirSync(join(work, '.git'), { recursive: true }); mkdirSync(app, { recursive: true });
  put(work, '.agents/skills/proj/SKILL.md', skill('proj', 'Project skill'));
  put(work, '.codex/config.toml', '[mcp_servers.proj]\ncommand = "node"\n\n[agents.pr]\ndescription = "Project role"\n');
  put(work, '.codex/agents/p.toml', 'name = "p"\ndescription = "Project agent"\ndeveloper_instructions = "x"\n');
  put(work, '.codex/hooks.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash $CODEX_PROJECT/hooks/start.sh HOOKSECRET' }] }] } });
  const demo = join(root, '.codex/plugins/cache/mkt/demo/1.2.3');
  put(demo, '.codex-plugin/plugin.json', { name: 'demo', skills: './skills', hooks: ['./hooks/hooks.json'] });
  put(demo, 'skills/grp/s1/SKILL.md', skill('s1', 'Plugin skill'));
  put(demo, 'hooks/hooks.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ${PLUGIN_ROOT}/dist/start.js' }] }] } });
  put(demo, 'hooks/ignored.json', { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'ignored.sh' }] }] } });
  put(demo, '.mcp.json', { mcpServers: { srv: { url: 'https://plugin.example.com/PATHSECRET?k=QUERYSECRET', http_headers: { A: 'HEADERSECRET' } } } });
  put(root, '.codex/plugins/cache/mkt/extra/0.1.0/.codex-plugin/plugin.json', { name: 'extra' });
  return app;
}
const codexList = JSON.stringify({ installed: [
  { pluginId: 'demo@mkt', name: 'demo', marketplaceName: 'mkt', version: '1.2.3', installed: true, enabled: true, source: { source: 'local', path: '/nonexistent' } },
  { pluginId: 'off@mkt', name: 'off', marketplaceName: 'mkt', version: '1.0.0', installed: true, enabled: false, source: { source: 'remote', id: 'x' } }], available: [] });
const codex = (root: string, options: InventoryOptions = {}) => inventoryCodex({ home: root, adminSkills: join(root, 'admin'), ...options });

test('a Codex home is inventoried from config.toml, agents, hooks, skills and plugins', t => {
  const root = temp(t), project = codexFixture(root), calls: string[][] = [], envs: NodeJS.ProcessEnv[] = [], dirs: (string | undefined)[] = [];
  const inventory = codex(root, { project, runner: runner({ 'codex plugin list --json': codexList, 'codex --version': 'codex-cli 0.160.1\n' }, calls, envs, dirs) });
  assert.deepEqual(calls, [['codex', 'plugin', 'list', '--json'], ['codex', '--version']]);
  assert.equal(envs[0]!.CODEX_HOME, join(root, '.codex')); assert.deepEqual(dirs, [project, undefined]);
  assert.deepEqual([inventory.host, inventory.home, inventory.homeSource, inventory.version], ['codex', join(root, '.codex'), 'option', '0.160.1']);
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.id, plugin.enabled, plugin.version]), [['demo@mkt', true, '1.2.3'], ['off@mkt', false, '1.0.0']]);
  assert.equal(inventory.plugins[0]!.path, join(root, '.codex/plugins/cache/mkt/demo/1.2.3'));
  assert.equal(inventory.settings.skillsMaxContextTokens, 4000);

  const origins = (origin: string) => inventory.entries.filter(entry => entry.origin === origin && entry.kind === 'skill').map(entry => entry.qualified).sort();
  assert.deepEqual(origins('user'), ['alpha', 'beta', 'gamma']); assert.deepEqual(origins('project'), ['proj']); assert.deepEqual(origins('admin'), ['delta']);
  assert.deepEqual(origins('plugin'), ['demo:s1']); assert.deepEqual(origins('bundled'), ['imagegen']);
  assert.equal(find(inventory, 'alpha')!.disabled, true); assert.equal(find(inventory, 'beta')!.disabled, undefined);
  assert.equal(find(inventory, 'beta')!.disableModelInvocation, true);
  assert.equal(find(inventory, 'gamma')!.descriptionChars, 'Folded text'.length);
  assert.equal(find(inventory, 'demo:s1')!.plugin, 'demo@mkt');
  const agents = inventory.entries.filter(entry => entry.kind === 'agent').map(entry => [entry.qualified, entry.origin]).sort();
  assert.deepEqual(agents, [['p', 'project'], ['planner', 'user'], ['pr', 'project'], ['reviewer', 'user']]);
  assert.equal(find(inventory, 'reviewer')!.descriptionChars, 'Reviews code'.length);

  const mcp = (name: string) => inventory.mcp.find(server => server.name === name)!;
  assert.deepEqual([mcp('docs').origin, mcp('docs').transport, mcp('docs').endpoint, mcp('docs').command], ['user', 'http', 'https://docs.example.com', undefined]);
  assert.deepEqual([mcp('local').transport, mcp('local').command, mcp('local').enabled], ['stdio', 'uvx', false]);
  assert.deepEqual([mcp('proj').origin, mcp('srv').origin, mcp('srv').plugin, mcp('srv').enabled, mcp('srv').endpoint], ['project', 'plugin', 'demo@mkt', false, 'https://plugin.example.com']);
  const hooks = inventory.hooks.map(entry => [entry.origin, entry.event, entry.matcher, entry.handler]);
  assert.deepEqual(hooks.sort(), [['plugin', 'SessionStart', '', 'node ~/.codex/plugins/cache/mkt/demo/1.2.3/dist/start.js'], ['project', 'SessionStart', '', 'bash $CODEX_PROJECT/hooks/start.sh <arg>'], ['user', 'PreToolUse', 'Bash', 'mcp_tool:docs'],
    ['user', 'PreToolUse', 'Bash', 'sh /x/bin/guard.sh'], ['user', 'Stop', 'done', 'python3 ~/.codex/hooks/stop.py']]);

  const warnings = inventory.warnings.join('\n');
  assert.ok(warnings.includes(`a second Codex home exists at ${join(root, '.agents')}`));
  assert.ok(warnings.includes('trust cannot be known')); assert.ok(warnings.includes('does not say how Codex namespaces plugin skills'));
  assert.ok(warnings.includes('bad.toml lacks a name or description')); assert.ok(warnings.includes(join(root, '.codex/skills/.system')));
  assert.equal(find(inventory, 'colon'), undefined); assert.ok(warnings.includes('colon/SKILL.md is skipped: its frontmatter is not valid YAML'));
  for (const secret of SECRETS) assert.equal(JSON.stringify(inventory).includes(secret), false, `${secret} must not appear in the inventory`);
});

test('Codex project layers follow the recorded trust, and a home chosen by env or default is read', t => {
  const root = temp(t), project = codexFixture(root), quiet = runner({});
  const config = join(root, '.codex/config.toml');
  writeFileSync(config, `[projects.${JSON.stringify(join(root, 'work'))}]\ntrust_level = "untrusted"\n`);
  const untrusted = codex(root, { project, runner: quiet });
  assert.equal(untrusted.mcp.some(server => server.name === 'proj'), false); assert.ok(untrusted.warnings.some(warning => warning.includes('marks the project untrusted')));
  writeFileSync(config, `[projects.${JSON.stringify(join(root, 'work'))}]\ntrust_level = "trusted"\n\n[features]\nhooks = false\n`);
  const trusted = codex(root, { project, runner: quiet });
  assert.equal(trusted.mcp.some(server => server.name === 'proj'), true); assert.ok(trusted.warnings.some(warning => warning.includes('records the project as trusted')));
  assert.equal(trusted.settings.disableAllHooks, true);
  // CODEX_HOME names a home directly; with the jstack route (~/.agents) there is no second home to warn about.
  const viaEnv = inventoryCodex({ env: { CODEX_HOME: join(root, '.agents'), HOME: root }, runner: quiet, adminSkills: join(root, 'none') });
  assert.deepEqual([viaEnv.homeSource, viaEnv.home], ['env', join(root, '.agents')]); assert.equal(viaEnv.warnings.some(warning => warning.includes('second Codex home')), false);
  const byDefault = inventoryCodex({ env: { HOME: root }, runner: quiet, adminSkills: join(root, 'none') });
  assert.deepEqual([byDefault.homeSource, byDefault.home], ['default', join(root, '.codex')]); assert.ok(byDefault.warnings.some(warning => warning.includes('second Codex home')));
});

test('a Codex plugin list that fails falls back to config.toml and the cache; invalid files only warn', t => {
  const root = temp(t);
  put(root, '.codex/config.toml', '[plugins."demo@mkt"]\nenabled = true\n\n[plugins."gone@mkt"]\nenabled = false\n');
  put(root, '.codex/plugins/cache/mkt/demo/1.2.3/.codex-plugin/plugin.json', { name: 'demo' });
  put(root, '.codex/plugins/cache/mkt/demo/1.2.3/skills/one/SKILL.md', skill('one', 'Plugin skill'));
  put(root, '.codex/plugins/cache/mkt/extra/0.1.0/.codex-plugin/plugin.json', { name: 'extra' });
  const inventory = codex(root, { runner: failing });
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.id, plugin.enabled, plugin.version]), [['demo@mkt', true, '1.2.3'], ['extra@mkt', true, '0.1.0'], ['gone@mkt', false, undefined]]);
  assert.ok(inventory.warnings.some(warning => warning.includes('codex plugin list --json failed'))); assert.equal(find(inventory, 'demo:one')!.origin, 'plugin');

  put(root, '.codex/config.toml', '[broken BROKENSECRET');
  put(root, '.codex/hooks.json', '{"BROKENSECRET":');
  put(root, '.codex/agents/a.toml', 'name = "BROKENSECRET');
  put(root, '.agents/skills/bad/SKILL.md', '---\ndescription: [unclosed BROKENSECRET\n---\n');
  const broken = codex(root, { runner: () => { throw new Error('boom'); } });
  const warnings = broken.warnings.join('\n');
  for (const piece of ['config.toml is not valid TOML', 'hooks.json is not valid JSON', 'a.toml is not valid TOML', 'bad/SKILL.md is skipped', 'codex plugin list --json failed']) assert.ok(warnings.includes(piece), piece);
  assert.equal(warnings.includes('BROKENSECRET'), false);
});

test('hook handlers are the command line with the plugin root and home spelled out, so different scripts never share an identity', t => {
  const root = temp(t), base = join(root, '.claude/plugins/cache/mkt');
  for (const name of ['alpha', 'beta']) {
    put(join(base, name, '1.0.0'), '.claude-plugin/plugin.json', { name });
    put(join(base, name, '1.0.0'), 'hooks/hooks.json', { hooks: { SessionStart: [{ hooks: [
      { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks-handlers/session-start.sh' },
      { type: 'command', command: 'bash "$CLAUDE_PLUGIN_ROOT/bin/run.sh"   --mode  fast' },
      { type: 'command', command: 'node', args: ['${PLUGIN_ROOT}/dist/a.js', 'go'] },
      { type: 'command', command: 'echo one' }, { type: 'command', command: 'echo two' }] }] } });
  }
  put(root, '.claude/settings.json', { hooks: { Stop: [{ hooks: [{ type: 'command', command: `${root}/.claude/hooks/x.sh` }, { type: 'command', command: '"$HOME/.claude/hooks/x.sh"' }, { type: 'command', command: '${HOME}/.claude/hooks/x.sh' }, { type: 'command', command: '~/.claude/hooks/x.sh' }] }] } });
  const list = JSON.stringify(['alpha', 'beta'].map(name => ({ id: `${name}@mkt`, version: '1.0.0', scope: 'user', enabled: true, installPath: join(base, name, '1.0.0') })));
  const inventory = claude(root, { runner: runner({ 'claude plugin list --json': list }) });
  const handlers = (plugin?: string) => inventory.hooks.filter(entry => entry.plugin === plugin && entry.event === (plugin ? 'SessionStart' : 'Stop')).map(entry => entry.handler);
  const alpha = '~/.claude/plugins/cache/mkt/alpha/1.0.0', beta = '~/.claude/plugins/cache/mkt/beta/1.0.0';
  assert.deepEqual(handlers('alpha@mkt'), [`${alpha}/hooks-handlers/session-start.sh`, `bash ${alpha}/bin/run.sh --mode fast`, `node ${alpha}/dist/a.js go`, 'echo one', 'echo two']);
  assert.deepEqual(handlers('beta@mkt')[0], `${beta}/hooks-handlers/session-start.sh`);
  assert.notEqual(handlers('alpha@mkt')[0], handlers('beta@mkt')[0], 'the same relative script of two plugins is two handlers');
  assert.deepEqual(handlers(), Array(4).fill('~/.claude/hooks/x.sh'), 'an absolute home, $HOME, ${HOME} and ~ name the same script');
  // Outside a plugin the placeholder stays as written, and a handler of another type keeps only its host or server.
  assert.equal(handlerId({ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/a.sh' }), '${CLAUDE_PLUGIN_ROOT}/a.sh');
  assert.equal(handlerId({ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/a.sh' }, '/opt/p'), '/opt/p/a.sh');
  assert.equal(handlerId({ type: 'command', command: 'node', args: ['/opt/p/a.js', 7, 'go'] }), 'node /opt/p/a.js go');
  assert.equal(handlerId({ type: 'command' }), 'unknown'); assert.equal(handlerId({ type: 'prompt', prompt: 'SECRET' }), 'prompt');
});

test('a command line never puts a URL, key, address or opaque token into a handler identity', t => {
  const root = temp(t), secrets = ['URLSECRET', 'WEBHOOKSECRET', 'MAILSECRET', 'PASSSECRET', 'QUERYSECRET', 'ENVSECRET', 'OPAQUESECRET', 'SLACKSECRET', 'KEYSECRET'];
  const commands = ['notify hooks.slack.com/services/T000/B000/URLSECRET', 'notify --webhook=https://hooks.example.com/WEBHOOKSECRET', 'mailer MAILSECRET@example.com', 'curl -u user:PASSSECRET https://x.test/a?k=QUERYSECRET',
    'TOKEN=ENVSECRET ./scripts/go.sh', 'deploy --token OPAQUESECRETabcdefghijklmnopqrst', 'notify T000/B000/SLACKSECRET', 'api-client KEYSECRET', './run.sh?token=KEYSECRET'];
  put(root, '.claude/settings.json', { hooks: { Notification: [{ hooks: commands.map(command => ({ type: 'command', command })) }] } });
  const inventory = claude(root, { runner: failing });
  assert.deepEqual(inventory.hooks.map(entry => entry.handler), ['notify <arg>', 'notify <arg>', 'mailer <arg>', 'curl -u <arg> <arg>', '<arg> ./scripts/go.sh', 'deploy --token <arg>', 'notify <arg>', 'api-client <arg>', '<arg>']);
  const text = JSON.stringify(inventory);
  for (const secret of secrets) assert.equal(text.includes(secret), false, `${secret} must not appear in the inventory`);
});

test('a quoted shell string or an expansion with a default never reaches a handler identity, a plain variable reference does', () => {
  const id = (command: string) => handlerId({ type: 'command', command }, '/plugin/root', '/Users/me');
  assert.equal(id('bash -c "$HOME/bin/notify --token SECRETVALUE"'), 'bash -c <arg>', 'a token with whitespace is a quoted string, never a path');
  assert.equal(id('sh -c "/usr/local/bin/push SECRETVALUE now"'), 'sh -c <arg>');
  assert.equal(id('/usr/local/bin/push "${API_TOKEN:-SECRETVALUE}"'), '/usr/local/bin/push <arg>');
  for (const expansion of ['${API_TOKEN:=SECRETVALUE}', '${API_TOKEN:+SECRETVALUE}', '${API_TOKEN:?SECRETVALUE}', '${API_TOKEN-SECRETVALUE}', '/opt/${API_TOKEN:-SECRETVALUE}/run.sh', '${HOME:-SECRETVALUE}/x.sh'])
    assert.equal(id(`/usr/local/bin/push ${expansion}`), '/usr/local/bin/push <arg>', expansion);
  for (const substitution of ['$(cat SECRETVALUE)', '`cat SECRETVALUE`']) assert.equal(id(`/usr/local/bin/push ${substitution}`).includes('SECRETVALUE'), false, substitution);
  assert.equal(id('/usr/local/bin/push $API_TOKEN ${API_TOKEN} ${API_TOKEN}/x.sh $API_TOKEN/x.sh'), '/usr/local/bin/push $API_TOKEN ${API_TOKEN} ${API_TOKEN}/x.sh $API_TOKEN/x.sh');
  assert.equal(id('"$HOME/bin/notify" "${CLAUDE_PLUGIN_ROOT}/a.sh" ${PLUGIN_ROOT}/b.sh'), '~/bin/notify /plugin/root/a.sh /plugin/root/b.sh', 'home and plugin root still expand');
  assert.equal(handlerId({ type: 'command', command: 'node', args: ['${HOME}/a.js', 'two words'] }, undefined, '/Users/me'), 'node ~/a.js <arg>');
});

test('host commands run in the project, with the environment of --home', t => {
  const root = temp(t), project = join(root, 'work/app');
  mkdirSync(join(project, '.git'), { recursive: true });
  const seen = (host: 'claude' | 'codex', options: InventoryOptions) => {
    const calls: string[][] = [], envs: NodeJS.ProcessEnv[] = [], dirs: (string | undefined)[] = [], quiet = runner({}, calls, envs, dirs);
    const inventory = host === 'claude' ? claude(root, { ...options, runner: quiet }) : codex(root, { ...options, runner: quiet });
    return { inventory, envs, dirs };
  };
  for (const host of ['claude', 'codex'] as const) {
    const run = seen(host, { project });
    assert.deepEqual(run.dirs, [project, undefined], host); assert.equal(run.envs[0]!.HOME, root);
    assert.equal(run.inventory.warnings.some(warning => warning.includes('ran in')), false, 'no warning about the directory a command ran in');
    assert.deepEqual(seen(host, { project: join(root, 'missing') }).dirs, [undefined, undefined], 'a project that is not a directory is not a working directory');
    assert.deepEqual(seen(host, {}).dirs, [undefined, undefined]);
  }
  assert.deepEqual([hostEnvironment('claude', { home: root }).HOME, hostEnvironment('claude', { home: root }).CLAUDE_CONFIG_DIR, hostEnvironment('codex', { home: root }).CODEX_HOME], [root, join(root, '.claude'), join(root, '.codex')]);
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'alt') };
  assert.equal(hostEnvironment('claude', { env }), env, 'without --home the process environment is used as it is');
});

test('a synced claude.ai skill never reveals the account or organization folder', t => {
  const root = temp(t);
  put(root, '.claude.json', { oauthAccount: { accountUuid: 'ACCOUNT-UUID-1', organizationUuid: 'ORG-UUID-2' } });
  put(root, '.claude/skills/synced/ORG-UUID-2_ACCOUNT-UUID-1/pdf/SKILL.md', skill('pdf', 'Synced from claude.ai'));
  put(root, '.claude/skills/synced/ORG-UUID-2_ACCOUNT-UUID-1/broken/SKILL.md', '---\ndescription: [unclosed\n---\n');
  put(root, '.claude/skills/synced/OTHER-ORG_OTHER-ACCOUNT/two/SKILL.md', skill('two', 'Another account'));
  const inventory = claude(root, { runner: failing });
  const synced = inventory.entries.filter(entry => entry.origin === 'connector');
  assert.deepEqual(synced.map(entry => [entry.qualified, entry.source]).sort(), [['anthropic-skills:broken', join(root, '.claude/skills/synced/<account>/broken/SKILL.md')], ['anthropic-skills:pdf', join(root, '.claude/skills/synced/<account>/pdf/SKILL.md')]]);
  assert.ok(inventory.warnings.some(warning => warning.includes('<account>/broken/SKILL.md has frontmatter that is not valid YAML')));
  // With no way to tell the signed-in account, every account's skills count and still none is named.
  put(root, '.claude.json', {});
  const all = claude(root, { runner: failing }), text = JSON.stringify(all);
  assert.equal(all.entries.filter(entry => entry.origin === 'connector').length, 3);
  for (const uuid of ['ACCOUNT-UUID-1', 'ORG-UUID-2', 'OTHER-ORG', 'OTHER-ACCOUNT']) assert.equal(text.includes(uuid), false, `${uuid} must not appear in the inventory`);
});

test('a synced claude.ai plugin never reveals the account or organization folder', t => {
  const root = temp(t), folder = join(root, '.claude/plugins/synced/ACCOUNT-UUID-1_ORG-UUID-2/cowork'), shown = join(root, '.claude/plugins/synced/<account>/cowork');
  put(folder, '.claude-plugin/plugin.json', { name: 'cowork' });
  put(folder, 'skills/good/SKILL.md', skill('good', 'Fine'));
  put(folder, 'skills/broken/SKILL.md', '---\ndescription: [unclosed\n---\n');
  put(folder, 'hooks/hooks.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/start.sh' }] }] } });
  put(folder, '.mcp.json', { mcpServers: { db: { command: 'node' } } });
  const check = (inventory: HostInventory) => {
    assert.deepEqual(inventory.plugins.map(plugin => [plugin.id, plugin.path]), [['cowork@synced', shown]]);
    assert.deepEqual(inventory.entries.map(entry => [entry.qualified, entry.source]).sort(), [['cowork:broken', join(shown, 'skills/broken/SKILL.md')], ['cowork:good', join(shown, 'skills/good/SKILL.md')]]);
    assert.deepEqual(inventory.hooks.map(entry => [entry.source, entry.handler]), [[join(shown, 'hooks/hooks.json'), '~/.claude/plugins/synced/<account>/cowork/hooks/start.sh']]);
    assert.deepEqual(inventory.mcp.map(server => [server.name, server.source]), [['plugin:cowork:db', shown]]);
    assert.ok(inventory.warnings.includes(`${join(shown, 'skills/broken/SKILL.md')} has frontmatter that is not valid YAML`));
    const text = JSON.stringify(inventory);
    for (const uuid of ['ACCOUNT-UUID-1', 'ORG-UUID-2']) assert.equal(text.includes(uuid), false, `${uuid} must not appear in the inventory`);
  };
  check(claude(root, { runner: runner({ 'claude plugin list --json': JSON.stringify([{ id: 'cowork@synced', version: '1', scope: 'user', enabled: true, installPath: folder }]) }) }));
  put(root, '.claude/plugins/installed_plugins.json', { plugins: { 'cowork@synced': [{ scope: 'user', version: '1', installPath: folder }] } });
  check(claude(root, { runner: failing }));
});

test('a listing budget fraction outside (0, 1] is ignored with a warning, and the configured model is read', t => {
  const root = temp(t), fraction = (value: unknown) => { put(root, '.claude/settings.json', { skillListingBudgetFraction: value }); return claude(root, { runner: failing }); };
  const ok = fraction(0.5);
  assert.equal(ok.settings.skillListingBudgetFraction, 0.5); assert.equal(ok.warnings.some(warning => warning.includes('skillListingBudgetFraction')), false);
  assert.equal(fraction(1).settings.skillListingBudgetFraction, 1);
  for (const bad of [1.5, 0, -0.1, 'abc']) {
    const inventory = fraction(bad);
    assert.equal(inventory.settings.skillListingBudgetFraction, undefined, String(bad)); assert.ok(inventory.warnings.some(warning => warning.includes('skillListingBudgetFraction is not a number in (0, 1] and is ignored')), String(bad));
  }
  put(root, '.claude/settings.json', { model: 'opus[1m]' });
  assert.equal(claude(root, { runner: failing }).settings.model, 'opus[1m]');
  put(root, '.claude/settings.json', { model: 'opus', env: { ANTHROPIC_MODEL: 'sonnet[1m]' } });
  assert.equal(claude(root, { runner: failing }).settings.model, 'sonnet[1m]', 'ANTHROPIC_MODEL from a settings env block beats the model setting');
  put(root, '.claude/settings.json', {});
  assert.equal(claude(root, { runner: failing }).settings.model, undefined);
});

/** Code points in hex, so the file holds no literal symbols. */
const symbols = (hex: string): string => hex.split(' ').map(code => String.fromCodePoint(parseInt(code, 16))).join('');
test('display width counts by grapheme cluster as Bun.stringWidth does with ambiguous characters narrow', () => {
  const cases: [string, string, number][] = [
    ['ASCII letter', '61', 1], ['tab', '9', 0], ['newline', 'A', 0], ['DEL', '7F', 0], ['no-break space', 'A0', 1], ['bullet', '2022', 1], ['right arrow', '2192', 1],
    ['Hangul syllable', 'AC00', 2], ['Hangul jamo L V T', '1100 1161 11A8', 2], ['Hangul syllable with final jamo', 'AC00 11A8', 2], ['lone medial jamo', '1161', 0], ['compatibility jamo', '3131', 2], ['halfwidth Hangul', 'FFA1', 1],
    ['CJK ideograph', '4E2D', 2], ['CJK extension B', '20000', 2], ['hiragana', '3042', 2], ['ideographic space', '3000', 2], ['fullwidth letter', 'FF21', 2], ['halfwidth katakana', 'FF76', 1], ['half fill space', '303F', 1],
    ['e with combining acute', '65 301', 1], ['precomposed e acute', 'E9', 1], ['lone combining mark', '301', 0], ['zero-width space', '200B', 0], ['zero-width joiner', '200D', 0], ['byte order mark', 'FEFF', 0], ['soft hyphen', 'AD', 0], ['lone VS16', 'FE0F', 0],
    ['smiling face', '1F642', 2], ['rocket', '1F680', 2], ['check mark button', '2705', 2], ['cross mark', '274C', 2], ['hourglass', '231B', 2], ['sparkles', '2728', 2], ['high voltage', '26A1', 2],
    ['heavy check mark', '2714', 1], ['heavy check mark and VS16', '2714 FE0F', 2], ['ballot box with check', '2611', 1], ['warning sign', '26A0', 1], ['warning sign and VS16', '26A0 FE0F', 2], ['heavy heart', '2764', 1], ['heavy heart and VS16', '2764 FE0F', 2],
    ['trade mark', '2122', 1], ['play button', '25B6', 1], ['play button and VS16', '25B6 FE0F', 2], ['stopwatch', '23F1', 1], ['left right arrow', '2194', 1], ['left right arrow and VS16', '2194 FE0F', 2], ['sun', '2600', 1], ['telephone', '260E', 1], ['pencil', '270F', 1], ['pencil and VS16', '270F FE0F', 2],
    ['copyright sign', 'A9', 1], ['copyright sign and VS16', 'A9 FE0F', 2], ['digit and VS16', '31 FE0F', 1], ['keycap digit', '31 FE0F 20E3', 2],
    ['thumbs up with skin tone', '1F44D 1F3FD', 2], ['family joined by ZWJ', '1F468 200D 1F469 200D 1F467 200D 1F466', 2], ['woman technologist', '1F469 200D 1F4BB', 2], ['rainbow flag', '1F3F3 FE0F 200D 1F308', 2], ['England flag', '1F3F4 E0067 E0062 E0065 E006E E0067 E007F', 2],
    ['flag', '1F1FA 1F1F8', 2], ['lone regional indicator', '1F1FA', 1], ['two flags', '1F1FA 1F1F8 1F1F0 1F1F7', 4], ['flag and one more indicator', '1F1FA 1F1F8 1F1E9', 3],
  ];
  for (const [name, hex, width] of cases) assert.equal(displayWidth(symbols(hex)), width, `${name} (${hex})`);
  // Text is the sum of its clusters, whatever the mix.
  assert.equal(displayWidth(`${symbols('2714')} done ${symbols('2705')}`), 1 + 6 + 2);
  assert.equal(displayWidth(`${symbols('AC00 D55C')} ok ${symbols('1F44D 1F3FD')}${symbols('65 301')}`), 4 + 4 + 2 + 1);
  assert.equal(displayWidth(''), 0);
});
