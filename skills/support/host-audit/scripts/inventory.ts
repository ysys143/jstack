/** Read-only inventory of one Claude Code or Codex profile. Reports names, origins and character counts of what the host would describe to the model; never descriptions, environments, headers, arguments or URL paths. */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { defaultRunner } from '../../../../cli/hosts.js';
import type { Host, HookEntry, HostInventory, ListedEntry, McpServer, Origin, Override, PluginInfo } from './types.js';
import { displayWidth } from './width.js';

type Json = Record<string, any>;
type Run = (command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) => { status: number; stdout: string; stderr: string };
export interface InventoryOptions {
  /** Replaces the user's home: the profile is `<home>/.claude` or `<home>/.codex`, and `HOME` for everything beneath it. */
  home?: string;
  /** The project directory whose `.claude`, `.agents` and `.codex` layers apply. */
  project?: string;
  env?: NodeJS.ProcessEnv;
  /** Runs `claude` or `codex` with exactly the argument lists this module needs, in `cwd` when one is given; the default is the host CLI runner of `jst install`, which also resolves Windows `.cmd` wrappers. */
  runner?: Run;
  /** Codex admin skills directory; defaults to `/etc/codex/skills`. */
  adminSkills?: string;
  /** Claude managed settings directory, only checked for existence; defaults to the platform location. */
  managed?: string;
}

export const defaultRun: Run = (command, args, env, cwd) => defaultRunner(command as Host, args, env, cwd);
/** A runner that throws counts as a failed command. */
const attempt = (run: Run, command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): ReturnType<Run> => { try { return run(command, args, env, cwd); } catch { return { status: 1, stdout: '', stderr: '' }; } };
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDir = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };
const names = (dir: string): string[] => { try { return readdirSync(dir).sort(); } catch { return []; } };
const real = (path: string): string => { try { return realpathSync(path); } catch { return resolve(path); } };
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
const list = (value: unknown): unknown[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const positive = (value: unknown): number | undefined => { const number = typeof value === 'string' && value.trim() ? Number(value) : value; return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined; };
/** Claude accepts true/false, yes/no, on/off and 1/0 in any case. */
function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  const word = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['true', 'yes', 'on', '1'].includes(word) ? true : ['false', 'no', 'off', '0'].includes(word) ? false : undefined;
}
/** Drops undefined members so results compare and serialize without empty keys. */
function clean<T extends object>(value: T): T { for (const key of Object.keys(value)) if ((value as Json)[key] === undefined) delete (value as Json)[key]; return value; }
const version = (stdout: string): string | undefined => /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(stdout)?.[0];

/** File readers that never throw: an unreadable or invalid file becomes a warning that names the file, never its content. */
function reader(warnings: Set<string>) {
  const text = (file: string): string | undefined => {
    try { return readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') warnings.add(`${file} could not be read (${code ?? 'error'})`);
      return undefined;
    }
  };
  const parsed = (file: string, kind: string, parse: (raw: string) => unknown): Json | undefined => {
    const raw = text(file); if (raw === undefined) return undefined;
    try { const data = parse(raw); if (isObject(data)) return data; } catch { /* the message can quote file content */ }
    warnings.add(`${file} is not valid ${kind}`); return undefined;
  };
  return { warn: (message: string) => warnings.add(message), text, json: (file: string) => parsed(file, 'JSON (an object is required)', JSON.parse), toml: (file: string) => parsed(file, 'TOML', raw => parseToml(raw)) };
}
type Reader = ReturnType<typeof reader>;

interface Meta { fields: Json; body: string; invalid: boolean }
/** Claude Code still loads a frontmatter that is not strict YAML when quoting its plain values makes it parse (`description: Use for x: y`); Codex does not. */
const quoted = (yaml: string): string => yaml.replace(/^([A-Za-z_][\w-]*):[ \t]+(?![|>"'\[{&*!])(\S.*?)[ \t]*$/gm, (_, key: string, value: string) => `${key}: ${JSON.stringify(value)}`);
/** Frontmatter counts only when the opening `---` is the file's first line. A YAML error leaves the fields empty. `lenient` is the Claude Code behavior. */
function markdown(text: string, lenient = true): Meta {
  const match = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { fields: {}, body: text, invalid: false };
  const body = text.slice(match[0].length), raw = match[1] ?? '';
  for (const yaml of lenient ? [raw, quoted(raw)] : [raw]) {
    try { const fields = parseYaml(yaml); if (fields === null || fields === undefined) return { fields: {}, body, invalid: false }; if (isObject(fields)) return { fields, body, invalid: false }; } catch { /* the message can quote file content */ }
  }
  return { fields: {}, body, invalid: true };
}
/** Character counts of the parsed description and `when_to_use`. Without a description Claude uses the first non-empty body line. */
function measure(meta: Meta, fallback: boolean) {
  // The host shows the first non-empty body line without its heading marks, cut at 100 characters.
  const first = fallback ? (meta.body.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '').replace(/^#+\s*/, '').slice(0, 100) : '';
  const stated = str(meta.fields.description), description = stated || first, when = str(meta.fields.when_to_use);
  return clean({ hasDescription: stated ? undefined : false, descriptionChars: description.length, whenToUseChars: when.length, descriptionWidth: displayWidth(description), whenToUseWidth: displayWidth(when),
    disableModelInvocation: toBool(meta.fields['disable-model-invocation']), userInvocable: toBool(meta.fields['user-invocable']) });
}
const warnInvalid = (ctx: Reader, file: string, meta: Meta) => { if (meta.invalid) ctx.warn(`${file} has frontmatter that is not valid YAML`); };

/** The directories from `project` up to the repository root, nearest first; only `project` when no repository is found. */
function chain(project: string): string[] {
  const dirs: string[] = [];
  for (let dir = project; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (existsSync(join(dir, '.git'))) return dirs;
    if (dirname(dir) === dir) return [project];
  }
}
/** Skill folders in `dir`: `dir` itself when it holds SKILL.md and `direct` is set, else each child folder that does. Symlinks are followed. */
function skillFolders(dir: string, direct = false): string[] {
  if (direct && isFile(join(dir, 'SKILL.md'))) return [dir];
  return names(dir).filter(name => !name.startsWith('.') && isFile(join(dir, name, 'SKILL.md'))).map(name => join(dir, name));
}
/** Every folder under `dir` that holds SKILL.md, without descending into a skill. */
function findSkills(dir: string, depth = 0): string[] {
  if (isFile(join(dir, 'SKILL.md'))) return [dir];
  if (depth >= 6) return [];
  return names(dir).filter(name => !name.startsWith('.') && name !== 'node_modules' && isDir(join(dir, name))).flatMap(name => findSkills(join(dir, name), depth + 1));
}
/** Markdown files under `dir` with the folder names between `dir` and the file. */
function markdownFiles(dir: string, rel: string[] = [], depth = 0): { file: string; rel: string[] }[] {
  if (depth > 8) return [];
  return names(dir).filter(name => !name.startsWith('.') && name !== 'node_modules').flatMap(name => {
    const path = join(dir, name);
    if (isDir(path)) return markdownFiles(path, [...rel, name], depth + 1);
    return name.toLowerCase().endsWith('.md') && isFile(path) ? [{ file: path, rel }] : [];
  });
}
const stem = (file: string): string => basename(file).replace(/\.md$/i, '');
const within = (root: string, value: unknown, label: string, ctx: Reader): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const path = resolve(root, value), rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) { ctx.warn(`${label} path escapes the plugin directory`); return undefined; }
  if (!existsSync(path)) { ctx.warn(`${label} path not found`); return undefined; }
  return path;
};

const SCRIPT = /\.(?:sh|bash|zsh|js|mjs|cjs|ts|mts|py|rb|pl|php|ps1|bat|cmd|lua)$/i;
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'env', 'node', 'nodejs', 'python', 'python3', 'uv', 'uvx', 'npx', 'pnpm', 'bun', 'bunx', 'tsx', 'deno', 'ruby', 'perl', 'php', 'pwsh', 'powershell', 'cmd', 'exec', 'sudo', 'command', 'nohup', 'time', 'test']);
const tokenize = (command: string): string[] => [...command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(match => (match[1] ?? match[2] ?? match[3]!).replace(/^[;(&|]+|[;)&|]+$/g, ''));
const PLUGIN_ROOT = /\$(?:\{(?:CLAUDE_)?PLUGIN_ROOT\}|(?:CLAUDE_)?PLUGIN_ROOT\b)/g;
const HOME_VARIABLE = /^(?:\$\{HOME\}|\$HOME|%USERPROFILE%)(?=[\\/]|$)/;
const PATH_LIKE = /^(?:[/~$.]|[A-Za-z]:[\\/])/;
/** A plain variable reference, `$NAME` or `${NAME}`, that ends the token or is followed by a path; `${NAME:-default}` and every other expansion is not one. */
const VARIABLE = /^\$\{?[A-Za-z_]\w*\}?(?=[\\/]|$)/;
/** Where a handler's command line is read: the plugin directory that `${CLAUDE_PLUGIN_ROOT}` and `${PLUGIN_ROOT}` mean, and the user's home. */
interface Scope { root?: string; home?: string }
/** One token of a command line as it appears in a handler identity. Paths and flags survive with the plugin root and home spelled out; plain words (`start`, `PreToolUse`, `dry-run`) survive; every other token can carry a credential (a URL, `key=value`, an opaque run, a quoted shell string, a command substitution or an expansion with a default) and becomes `<arg>`. */
function identityToken(raw: string, scope: Scope, command: boolean): string {
  if (/[\s`]/.test(raw) || [...raw.matchAll(/\$/g)].some(match => !VARIABLE.test(raw.slice(match.index)))) return '<arg>';
  let token = raw;
  if (scope.root !== undefined) token = token.replace(PLUGIN_ROOT, () => scope.root!);
  token = token.replace(HOME_VARIABLE, '~');
  if (scope.home && token.startsWith(scope.home) && /^(?:[\\/]|$)/.test(token.slice(scope.home.length))) token = `~${token.slice(scope.home.length)}`;
  if (PATH_LIKE.test(token) || SCRIPT.test(token)) return /[=?]/.test(token) ? '<arg>' : token;
  if (/[/\\=@?]/.test(token) || /[A-Za-z0-9_-]{20,}/.test(token)) return '<arg>';
  return command || /^--?[A-Za-z][\w-]*$/.test(token) || INTERPRETERS.has(token) || /^[A-Z]?[a-z]+(?:[A-Z][a-z]+|-[a-z]+)*$/.test(token) ? token : '<arg>';
}
const hostOf = (url: unknown): string => { try { return new URL(String(url)).host; } catch { return 'unknown'; } };
/** A stable identity of one hook handler: the command line it runs, so different scripts never share one (two plugins' `hooks-handlers/session-start.sh` stay apart once `root` is the plugin's own directory). `args` joins the command in exec form. Only the host of a URL and the server of an MCP tool are kept. */
export function handlerId(handler: Json, root?: string, home?: string): string {
  const type = typeof handler.type === 'string' ? handler.type : 'command';
  if (type === 'http') return `http:${hostOf(handler.url)}`;
  if (type === 'mcp_tool') return `mcp_tool:${str(handler.server) || 'unknown'}`;
  if (type !== 'command') return type;
  const command = str(handler.command), scope: Scope = { root, home };
  const tokens = Array.isArray(handler.args) ? [command, ...handler.args.filter((arg: unknown) => typeof arg === 'string')] : tokenize(command);
  let started = false;
  const parts = tokens.filter(token => token && !/^\d*[<>&|;]/.test(token)).map(token => {
    if (!started && /^[A-Za-z_]\w*=/.test(token)) return '<arg>';
    const part = identityToken(token, scope, !started); started = true; return part;
  });
  return parts.join(' ') || 'unknown';
}
/** One entry per handler of an event map (`{ Event: [{ matcher?, hooks: [handler] }] }`). Members that are not event lists, such as Codex's `hooks.state`, are ignored. */
function hookEntries(map: unknown, base: Omit<HookEntry, 'event' | 'matcher' | 'handler'>, scope: Scope): HookEntry[] {
  const out: HookEntry[] = [];
  if (!isObject(map)) return out;
  for (const [event, groups] of Object.entries(map)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) continue;
      for (const handler of group.hooks) if (isObject(handler)) out.push({ ...base, event, matcher: typeof group.matcher === 'string' ? group.matcher : '', handler: handlerId(handler, scope.root, scope.home) });
    }
  }
  return out;
}

/** An MCP server reduced to its shape: the command's basename and an endpoint's scheme and host. Nothing else of the entry is read. */
function mcpServer(host: Host, name: string, config: unknown, base: { origin: Origin; source: string; plugin?: string; enabled?: boolean }, ctx: Reader): McpServer {
  const entry = isObject(config) ? config : {};
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  let transport: McpServer['transport'] = 'unknown';
  if (type === 'stdio' || (!type && typeof entry.command === 'string')) transport = 'stdio';
  else if (['http', 'streamable-http', 'streamable_http'].includes(type)) transport = 'http';
  else if (type === 'sse') transport = 'sse';
  else if (!type && typeof entry.url === 'string') {
    if (host === 'codex') transport = 'http'; else ctx.warn(`MCP server ${name} (${base.source}) has a url but no type; Claude Code skips it`);
  }
  let endpoint: string | undefined;
  if (transport !== 'stdio' && typeof entry.url === 'string') { try { const url = new URL(entry.url); endpoint = `${url.protocol}//${url.host}`; } catch { /* leave it out */ } }
  return clean({ host, name, origin: base.origin, source: base.source, plugin: base.plugin, transport,
    command: transport === 'stdio' && typeof entry.command === 'string' ? basename(entry.command.trim().split(/\s+/)[0] ?? '') || undefined : undefined,
    endpoint, alwaysLoad: typeof entry.alwaysLoad === 'boolean' ? entry.alwaysLoad : undefined, enabled: base.enabled });
}
/** Server configs a plugin declares: `.mcp.json` first, then each manifest shape; a later name replaces an earlier one. A file may omit the `mcpServers` wrapper. */
function pluginServers(root: string, manifest: Json, label: string, ctx: Reader): Map<string, unknown> {
  const servers = new Map<string, unknown>();
  const add = (map: unknown) => { if (isObject(map)) for (const [key, value] of Object.entries(map)) servers.set(key, value); };
  const file = (path: string) => { const data = ctx.json(path); if (data) add(isObject(data.mcpServers) ? data.mcpServers : data); };
  file(join(root, '.mcp.json'));
  for (const value of list(manifest.mcpServers)) {
    if (typeof value !== 'string') { add(value); continue; }
    if (/^https?:/i.test(value) || /\.(?:mcpb|dxt)$/i.test(value)) { ctx.warn(`${label}: an MCP bundle is declared and not inspected`); continue; }
    const path = within(root, value, `${label}: mcpServers`, ctx); if (path) file(path);
  }
  return servers;
}

interface Sink { entries: ListedEntry[]; mcp: McpServer[]; hooks: HookEntry[] }

/** What a plugin skill or command keeps from a synced claude.ai skill: its frontmatter `name`, which the host turns into an alias, unless it contains a colon. Its folder or file name alone holds nothing. */
export const pluginHolds = (name: unknown): Pick<ListedEntry, 'holds'> => { const held = str(name); return held && !held.includes(':') ? { holds: [held] } : {}; };
const fold = (name: string): string => name.normalize('NFKC').toLowerCase();
/** Whether this entry keeps a synced claude.ai skill from answering to the bare name: the name is one of the entry's `holds`, compared without regard to case or Unicode normalization. A user or project skill holds its folder name and its frontmatter name, a user or project command the name it is listed under (`ns:name` in a subfolder), a plugin skill or command its frontmatter name without a colon; agents and other synced skills hold nothing (observed, claude.listing.synced-override-key). */
export const holdsBareName = (entry: ListedEntry, name: string): boolean => !!entry.holds?.some(held => fold(held) === fold(name));
/** The override the host applies to the skill synced as `anthropic-skills:<name>`: the full-name key always, the bare-name key (matched by its exact spelling) only while no entry holds the bare name. */
export const syncedOverride = (overrides: Record<string, Override>, entries: ListedEntry[], name: string): Override | undefined =>
  overrides[`anthropic-skills:${name}`] ?? (Object.hasOwn(overrides, name) && !entries.some(entry => holdsBareName(entry, name)) ? overrides[name] : undefined);

// ---------------------------------------------------------------- Claude Code

const OVERRIDES: Override[] = ['on', 'name-only', 'user-invocable-only', 'off'];
const claudeManaged = (): string => process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : '/etc/claude-code';

/** Entries a Claude plugin contributes: skills add to `skills/`, commands and agents replace their default folders, hooks and MCP servers merge with their default files. */
function claudePlugin(info: PluginInfo, root: string, home: string, sink: Sink, disabledServers: Set<string>, ctx: Reader): void {
  const manifestFile = join(root, '.claude-plugin', 'plugin.json');
  const manifest = ctx.json(manifestFile) ?? {};
  const plugin = str(manifest.name) || info.id.split('@')[0]!;
  const label = `plugin ${plugin}`;
  const qualify = (...parts: string[]) => [plugin, ...parts].join(':');
  const seen = new Set<string>();
  const roots = isDir(join(root, 'skills')) ? [join(root, 'skills')] : [];
  for (const value of list(manifest.skills)) { const dir = within(root, value, `${label}: skills`, ctx); if (dir) roots.push(dir); }
  if (!roots.length && manifest.skills === undefined && isFile(join(root, 'SKILL.md'))) roots.push(root);
  for (const dir of roots) for (const folder of skillFolders(dir, true)) {
    if (seen.has(real(folder))) continue;
    seen.add(real(folder));
    const file = join(folder, 'SKILL.md'), meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta);
    const name = str(meta.fields.name) || basename(folder);
    sink.entries.push({ host: 'claude', kind: 'skill', name, qualified: name.startsWith(`${plugin}:`) ? name : qualify(name), origin: 'plugin', source: file, plugin: info.id, ...measure(meta, true), ...pluginHolds(meta.fields.name) });
  }
  const command = (file: string, parts: string[], meta: Meta, description?: string) => sink.entries.push({ host: 'claude', kind: 'command', name: parts[parts.length - 1]!, qualified: qualify(...parts), origin: 'plugin', source: file, plugin: info.id,
    ...measure(meta, true), ...(description !== undefined ? { descriptionChars: description.length } : {}), ...pluginHolds(meta.fields.name) });
  const commandFile = (file: string, rel: string[]) => { const meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta); command(file, [...rel, stem(file)], meta); };
  if (manifest.commands === undefined) { for (const { file, rel } of markdownFiles(join(root, 'commands'))) commandFile(file, rel); }
  else if (isObject(manifest.commands)) {
    for (const [key, value] of Object.entries(manifest.commands)) {
      if (!isObject(value)) continue;
      const source = typeof value.source === 'string' ? within(root, value.source, `${label}: commands.${key}`, ctx) : undefined;
      const content = source ? ctx.text(source) ?? '' : str(value.content);
      command(source ?? manifestFile, key.split(':'), markdown(content), typeof value.description === 'string' ? value.description.trim() : undefined);
    }
  } else for (const value of list(manifest.commands)) {
    const path = within(root, value, `${label}: commands`, ctx); if (!path) continue;
    if (isDir(path)) for (const { file, rel } of markdownFiles(path)) commandFile(file, rel); else commandFile(path, []);
  }
  const agent = (file: string, rel: string[]) => {
    const meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta);
    const name = str(meta.fields.name) || stem(file);
    sink.entries.push({ host: 'claude', kind: 'agent', name, qualified: qualify(...rel, name), origin: 'plugin', source: file, plugin: info.id, ...measure(meta, false), ...(meta.invalid ? { descriptionChars: `Agent from ${plugin} plugin`.length } : {}) });
  };
  if (manifest.agents === undefined) { for (const { file, rel } of markdownFiles(join(root, 'agents'))) agent(file, rel); }
  else for (const value of list(manifest.agents)) {
    const path = within(root, value, `${label}: agents`, ctx); if (!path) continue;
    if (isDir(path)) ctx.warn(`${label}: agents path is a directory; Claude Code accepts only .md files there`); else agent(path, []);
  }
  const base = { host: 'claude' as const, origin: 'plugin' as const, plugin: info.id };
  const hookFile = (file: string) => {
    const data = ctx.json(file); if (!data) return;
    if (isObject(data.hooks)) sink.hooks.push(...hookEntries(data.hooks, { ...base, source: file }, { root, home })); else ctx.warn(`${file} has no top-level "hooks" key; Claude Code does not load it`);
  };
  hookFile(join(root, 'hooks', 'hooks.json'));
  for (const value of list(manifest.hooks)) {
    if (typeof value === 'string') { const path = within(root, value, `${label}: hooks`, ctx); if (path) hookFile(path); }
    else sink.hooks.push(...hookEntries(value, { ...base, source: manifestFile }, { root, home }));
  }
  for (const [server, config] of pluginServers(root, manifest, label, ctx)) {
    const name = `plugin:${plugin}:${server}`;
    sink.mcp.push(mcpServer('claude', name, config, { origin: 'plugin', source: root, plugin: info.id, enabled: disabledServers.has(name) ? false : undefined }, ctx));
  }
}

/** The profile directory an option, the environment or the default selects for one host, and the environment its CLI runs with: `--home` becomes `HOME` and the profile variable, so the CLI reads the same profile this module does. */
function locate(host: Host, options: InventoryOptions) {
  const env = options.env ?? process.env, variable = host === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
  const user = resolve(options.home ?? (env.HOME || env.USERPROFILE || homedir()));
  const homeSource: HostInventory['homeSource'] = options.home ? 'option' : env[variable] ? 'env' : 'default';
  const home = homeSource === 'env' ? resolve(env[variable]!) : join(user, host === 'claude' ? '.claude' : '.codex');
  const hostEnv: NodeJS.ProcessEnv = homeSource === 'option' ? { ...env, HOME: user, USERPROFILE: user, [variable]: home } : env;
  return { env, user, home, homeSource, hostEnv };
}
/** The environment `claude` or `codex` runs with for these options. */
export const hostEnvironment = (host: Host, options: InventoryOptions = {}): NodeJS.ProcessEnv => locate(host, options).hostEnv;
/** The directory host commands run in: the project, so `plugin list` reflects its enabled plugins. */
export const commandDirectory = (project: string | undefined): string | undefined => project && isDir(project) ? project : undefined;
/** A synced claude.ai skill or plugin sits under a folder named after the account and organization UUIDs; those never reach a report. */
const anonymous = (text: string): string => text.replace(/([\\/](?:skills|plugins)[\\/]synced[\\/])[^\\/\s]+/g, '$1<account>');
/** `anonymous` applied to every path, source, handler identity and warning a result reports. */
function hideAccounts(inventory: HostInventory): HostInventory {
  return { ...inventory, plugins: inventory.plugins.map(plugin => clean({ ...plugin, path: plugin.path === undefined ? undefined : anonymous(plugin.path) })),
    entries: inventory.entries.map(entry => ({ ...entry, source: anonymous(entry.source) })), mcp: inventory.mcp.map(server => ({ ...server, source: anonymous(server.source) })),
    hooks: inventory.hooks.map(hook => ({ ...hook, source: anonymous(hook.source), handler: anonymous(hook.handler) })), warnings: inventory.warnings.map(anonymous) };
}

export function inventoryClaude(options: InventoryOptions = {}): HostInventory {
  const warnings = new Set<string>(), ctx = reader(warnings);
  const run = options.runner ?? defaultRun, { env, user, home, homeSource, hostEnv } = locate('claude', options);
  // The docs place ~/.claude.json at the user's home and are silent about CLAUDE_CONFIG_DIR; profiles in practice keep it inside that directory.
  const globalFile = homeSource === 'env' ? join(home, '.claude.json') : join(user, '.claude.json');
  const project = options.project ? resolve(options.project) : undefined;
  const dirs = project ? chain(project) : [];
  const managed = options.managed ?? claudeManaged();
  if (['managed-settings.json', 'managed-settings.d', 'managed-mcp.json', '.claude'].some(name => existsSync(join(managed, name)))) warnings.add(`managed settings exist in ${managed} and are not inventoried`);

  // Settings: user, project, local; later wins. Hooks are read per file because they add up.
  const homeReal = real(home);
  const projectClaude = project && real(join(project, '.claude')) !== homeReal ? join(project, '.claude') : undefined;
  const settingsFiles: [string, Origin][] = [[join(home, 'settings.json'), 'user'], ...(projectClaude ? [[join(projectClaude, 'settings.json'), 'project'], [join(projectClaude, 'settings.local.json'), 'local']] as [string, Origin][] : [])];
  const settings: Json = { skillOverrides: {}, enabledPlugins: {}, env: {}, disabledMcpjsonServers: [] };
  const hooks: HookEntry[] = [];
  let syncOff = false;
  for (const [file, origin] of settingsFiles) {
    const data = ctx.json(file); if (!data) continue;
    for (const key of ['skillOverrides', 'enabledPlugins', 'env']) if (isObject(data[key])) Object.assign(settings[key], data[key]);
    for (const key of ['skillListingBudgetFraction', 'skillListingMaxDescChars', 'disableAllHooks', 'model']) if (data[key] !== undefined) settings[key] = data[key];
    if (Array.isArray(data.disabledMcpjsonServers)) settings.disabledMcpjsonServers.push(...data.disabledMcpjsonServers);
    if (origin !== 'project' && data.syncClaudeAiSkills === false) syncOff = true;
    hooks.push(...hookEntries(data.hooks, { host: 'claude', origin, source: file }, { home: user }));
  }
  const skillOverrides: Record<string, Override> = {};
  for (const [name, value] of Object.entries(settings.skillOverrides)) { if (OVERRIDES.includes(value as Override)) skillOverrides[name] = value as Override; else warnings.add(`skillOverrides.${name} has an unknown value and is ignored`); }
  const claudeJson = ctx.json(globalFile) ?? {};
  const usage: Record<string, { count: number; lastUsedAt?: number }> = {};
  if (isObject(claudeJson.skillUsage)) for (const [name, value] of Object.entries(claudeJson.skillUsage)) if (isObject(value) && typeof value.usageCount === 'number') usage[name] = clean({ count: value.usageCount, lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : undefined });
  const budget = positive(env.SLASH_COMMAND_TOOL_CHAR_BUDGET) ?? positive(settings.env.SLASH_COMMAND_TOOL_CHAR_BUDGET);
  let fraction = positive(settings.skillListingBudgetFraction);
  if (settings.skillListingBudgetFraction !== undefined && (fraction === undefined || fraction > 1)) { warnings.add('skillListingBudgetFraction is not a number in (0, 1] and is ignored'); fraction = undefined; }
  const maxDesc = positive(settings.skillListingMaxDescChars), model = str(settings.env.ANTHROPIC_MODEL) || str(settings.model) || undefined;

  const sink: Sink = { entries: [], mcp: [], hooks };
  // User and project skills, commands and agents. A skill folder reached twice through links loads once.
  const seen = new Set<string>();
  const override = (qualified: string) => skillOverrides[qualified];
  const skills = (dir: string, origin: Origin) => {
    for (const name of names(dir)) {
      const folder = join(dir, name), file = join(folder, 'SKILL.md');
      if (name.startsWith('.') || name.toLowerCase() === 'synced' || /^anthropic-skills(?::|$)/.test(name) || !isFile(file) || seen.has(real(folder))) continue;
      seen.add(real(folder));
      const meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta);
      // The folder name is the command name, the one a settings key reaches; the frontmatter name is the display name. Both hold the bare name.
      const skill = str(meta.fields.name) || name;
      sink.entries.push(clean({ host: 'claude' as const, kind: 'skill' as const, name: skill, qualified: skill, origin, source: file, ...measure(meta, true), override: override(name), holds: [...new Set([name, skill])] }));
    }
  };
  const commands = (dir: string, origin: Origin) => {
    for (const { file, rel } of markdownFiles(dir)) {
      const meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta);
      const qualified = [...rel, stem(file)].join(':');
      sink.entries.push(clean({ host: 'claude' as const, kind: 'command' as const, name: stem(file), qualified, origin, source: file, ...measure(meta, true), override: override(qualified), holds: [qualified] }));
    }
  };
  const agents = (dir: string, origin: Origin) => {
    for (const { file } of markdownFiles(dir)) {
      const meta = markdown(ctx.text(file) ?? '');
      const name = str(meta.fields.name), description = str(meta.fields.description);
      if (meta.invalid) { ctx.warn(`${file} has frontmatter that is not valid YAML; Claude Code skips the agent`); continue; }
      if (!name) continue;
      if (name.startsWith('-') || name.includes(':') || !description) { ctx.warn(`${file} is skipped by Claude Code: the name or description is not usable`); continue; }
      sink.entries.push({ host: 'claude', kind: 'agent', name, qualified: name, origin, source: file, ...measure(meta, false) });
    }
  };
  skills(join(home, 'skills'), 'user'); commands(join(home, 'commands'), 'user'); agents(join(home, 'agents'), 'user');
  // Skills synced from claude.ai: ~/.claude/skills/synced/<account folder>/<skill>/SKILL.md. The docs name only the synced folder; the account level is what is found on disk,
  // a folder named after the signed-in account and its organization. Only that account's skills load.
  const synced = join(home, 'skills', 'synced');
  if (!syncOff) {
    const accounts = names(synced).filter(name => isDir(join(synced, name)) && !name.startsWith('.'));
    const login = isObject(claudeJson.oauthAccount) ? claudeJson.oauthAccount : {};
    const mine = accounts.filter(name => typeof login.accountUuid === 'string' && typeof login.organizationUuid === 'string' && name.includes(login.accountUuid) && name.includes(login.organizationUuid));
    const loaded = mine.length === 1 ? mine : accounts;
    if (mine.length !== 1 && accounts.filter(account => skillFolders(join(synced, account), true).length).length > 1) warnings.add(`${synced} holds skills from more than one account and the signed-in one cannot be identified; all are counted`);
    for (const account of loaded) for (const folder of skillFolders(join(synced, account), true)) {
      const file = join(folder, 'SKILL.md'), meta = markdown(ctx.text(file) ?? ''); warnInvalid(ctx, file, meta);
      const name = str(meta.fields.name) || basename(folder);
      sink.entries.push(clean({ host: 'claude' as const, kind: 'skill' as const, name, qualified: `anthropic-skills:${name}`, origin: 'connector' as const, source: file, ...measure(meta, true) }));
    }
  }
  // Project skills, commands and agents come from every .claude folder between the project and the repository root.
  for (const dir of dirs) {
    const claude = join(dir, '.claude');
    if (real(claude) === homeReal) continue;
    skills(join(claude, 'skills'), 'project'); commands(join(claude, 'commands'), 'project'); agents(join(claude, 'agents'), 'project');
  }

  // Plugins from the CLI; installed_plugins.json and the enabledPlugins setting when it cannot run.
  const row = (data: Json): PluginInfo | undefined => typeof data.id === 'string' ? clean({ host: 'claude' as const, id: data.id, enabled: data.enabled !== false, scope: typeof data.scope === 'string' ? data.scope : undefined,
    version: typeof data.version === 'string' ? data.version : undefined, path: typeof data.readFromFolder === 'string' ? data.readFromFolder : typeof data.installPath === 'string' ? data.installPath : undefined }) : undefined;
  let plugins: PluginInfo[] | undefined;
  const listed = attempt(run, 'claude', ['plugin', 'list', '--json'], hostEnv, commandDirectory(project));
  if (listed.status === 0) {
    try { const data = JSON.parse(listed.stdout); const rows = Array.isArray(data) ? data : data?.installed; if (Array.isArray(rows)) plugins = rows.filter(isObject).map(row).filter((info): info is PluginInfo => !!info); } catch { /* fall back below */ }
  }
  if (!plugins) {
    warnings.add('claude plugin list --json failed; plugins come from installed_plugins.json and the enabledPlugins setting');
    plugins = [];
    const installed = ctx.json(join(home, 'plugins', 'installed_plugins.json'));
    if (installed && isObject(installed.plugins)) for (const [id, installs] of Object.entries(installed.plugins)) for (const install of list(installs)) {
      if (!isObject(install)) continue;
      if ((install.scope === 'project' || install.scope === 'local') && !(project && typeof install.projectPath === 'string' && install.projectPath && [project, ...dirs].map(real).includes(real(install.projectPath)))) continue;
      const path = typeof install.installPath === 'string' ? install.installPath : undefined;
      const defaultEnabled = path ? ctx.json(join(path, '.claude-plugin', 'plugin.json'))?.defaultEnabled !== false : true;
      plugins.push(clean({ host: 'claude' as const, id, enabled: settings.enabledPlugins[id] ?? defaultEnabled, scope: typeof install.scope === 'string' ? install.scope : undefined, version: typeof install.version === 'string' ? install.version : undefined, path }));
    }
  }
  const localKeys = project ? [...new Set([project, real(project), ...dirs.slice(-1)])] : [];
  const projectEntries = isObject(claudeJson.projects) ? localKeys.map(key => claudeJson.projects[key]).filter(isObject) : [];
  const disabledServers = new Set<string>(projectEntries.flatMap(entry => Array.isArray(entry.disabledMcpServers) ? entry.disabledMcpServers.filter((name: unknown) => typeof name === 'string') : []));
  const scanned = new Set<string>();
  for (const info of plugins) {
    if (!info.enabled) continue;
    if (!info.path || !isDir(info.path)) { warnings.add(`plugin ${info.id} is enabled but its path was not found`); continue; }
    if (scanned.has(real(info.path))) continue;
    scanned.add(real(info.path));
    claudePlugin(info, info.path, user, sink, disabledServers, ctx);
  }
  // A synced skill's bare-name key depends on every other entry, so it is resolved once the plugin entries are in.
  for (const entry of sink.entries) if (entry.origin === 'connector') { const value = syncedOverride(skillOverrides, sink.entries, entry.name); if (value) entry.override = value; }

  // MCP servers: user, local (this project's entry in .claude.json), project (.mcp.json). Plugin servers were added above.
  const servers = (map: unknown, origin: Origin, source: string, disabled: Set<string>, taken = new Set<string>()) => {
    if (!isObject(map)) return;
    for (const [name, config] of Object.entries(map)) { if (taken.has(name)) continue; taken.add(name); sink.mcp.push(mcpServer('claude', name, config, { origin, source, enabled: disabled.has(name) ? false : undefined }, ctx)); }
  };
  servers(claudeJson.mcpServers, 'user', globalFile, disabledServers);
  const taken = new Set<string>();
  for (const entry of projectEntries) servers(entry.mcpServers, 'local', globalFile, disabledServers, taken);
  if (project) {
    const file = join(project, '.mcp.json'), data = ctx.json(file);
    const disabledJson = new Set<string>([...settings.disabledMcpjsonServers, ...projectEntries.flatMap(entry => Array.isArray(entry.disabledMcpjsonServers) ? entry.disabledMcpjsonServers : [])].filter(name => typeof name === 'string'));
    if (data) servers(data.mcpServers, 'project', file, disabledJson);
  }

  return hideAccounts({ host: 'claude', home, homeSource, version: claudeVersion(run, hostEnv, warnings), plugins, entries: sink.entries, mcp: sink.mcp, hooks: sink.hooks,
    settings: clean({ skillOverrides, skillListingBudgetFraction: fraction, skillListingMaxDescChars: maxDesc, listingCharBudget: budget, disableAllHooks: typeof settings.disableAllHooks === 'boolean' ? settings.disableAllHooks : undefined, model, usage }), warnings: [...warnings] });
}
function claudeVersion(run: Run, env: NodeJS.ProcessEnv, warnings: Set<string>): string | undefined {
  const result = attempt(run, 'claude', ['--version'], env), found = result.status === 0 ? version(result.stdout) : undefined;
  if (!found) warnings.add('claude --version did not report a version');
  return found;
}

// ---------------------------------------------------------------- Codex

/** A Codex skill: name, description length and the `agents/openai.yaml` policy that stops implicit invocation. Codex requires strict YAML with a name and description, so a SKILL.md without them is skipped. */
function codexSkill(folder: string, base: { origin: Origin; plugin?: string; qualify: (name: string) => string }, disabled: Map<string, boolean>, ctx: Reader): ListedEntry | undefined {
  const file = join(folder, 'SKILL.md'), meta = markdown(ctx.text(file) ?? '', false);
  const name = str(meta.fields.name), description = str(meta.fields.description);
  if (meta.invalid || !name || !description) { ctx.warn(`${file} is skipped: ${meta.invalid ? 'its frontmatter is not valid YAML' : 'it lacks a name or description, which Codex requires'}`); return undefined; }
  let implicit: boolean | undefined;
  const policyFile = join(folder, 'agents', 'openai.yaml'), policy = ctx.text(policyFile);
  if (policy !== undefined) { try { const data = parseYaml(policy); if (isObject(data) && isObject(data.policy) && typeof data.policy.allow_implicit_invocation === 'boolean') implicit = data.policy.allow_implicit_invocation; } catch { ctx.warn(`${policyFile} is not valid YAML`); } }
  const off = [resolve(file), real(file), resolve(folder), real(folder)].map(path => disabled.get(path)).find(value => value !== undefined) === false;
  return clean({ host: 'codex' as const, kind: 'skill' as const, name, qualified: base.qualify(name), origin: base.origin, source: file, plugin: base.plugin,
    descriptionChars: description.length, whenToUseChars: 0, disableModelInvocation: implicit === false ? true : undefined, disabled: off ? true : undefined });
}

export function inventoryCodex(options: InventoryOptions = {}): HostInventory {
  const warnings = new Set<string>(), ctx = reader(warnings);
  const run = options.runner ?? defaultRun, { user, home, homeSource, hostEnv } = locate('codex', options), own: Scope = { home: user };
  const project = options.project ? resolve(options.project) : undefined;
  const dirs = project ? chain(project) : [];
  const second = join(user, '.agents');
  if (isFile(join(second, 'config.toml')) && real(second) !== real(home)) warnings.add(`a second Codex home exists at ${second} (the jstack-managed route uses it as CODEX_HOME); this inventory read only ${home}`);

  const configFile = join(home, 'config.toml'), config = ctx.toml(configFile) ?? {};
  // Project layers: .codex/config.toml, hooks.json and agents/ from the repository root down to the project. An untrusted project loads none of them.
  const projects = isObject(config.projects) ? config.projects : {};
  const trust = dirs.flatMap(dir => [dir, real(dir)]).map(dir => (isObject(projects[dir]) ? projects[dir].trust_level : undefined)).find(level => typeof level === 'string');
  const layers = dirs.map(dir => join(dir, '.codex')).filter(dir => real(dir) !== real(home) && isDir(dir)).reverse();
  let projectLayers: string[] = [];
  if (layers.length) {
    if (trust === 'untrusted') warnings.add(`the project .codex layers (${layers.length}) are skipped: config.toml marks the project untrusted`);
    else { projectLayers = layers; warnings.add(`project .codex layers are present and are inventoried as if trusted; ${trust === 'trusted' ? 'config.toml records the project as trusted' : 'config.toml records no trust level, so trust cannot be known'}`); }
  }
  const layerConfigs = projectLayers.map(dir => ({ dir, config: ctx.toml(join(dir, 'config.toml')) ?? {} }));

  const settings: HostInventory['settings'] = { skillOverrides: {}, usage: {} };
  const tokens = [config, ...layerConfigs.map(layer => layer.config)].map(data => isObject(data.skills) ? positive(data.skills.max_context_tokens) : undefined).filter((value): value is number => value !== undefined);
  if (tokens.length) settings.skillsMaxContextTokens = tokens[tokens.length - 1];
  if ([config, ...layerConfigs.map(layer => layer.config)].some(data => isObject(data.features) && (data.features.hooks === false || data.features.codex_hooks === false))) settings.disableAllHooks = true;
  // [[skills.config]] path = ... enabled = ...; the path names SKILL.md or its folder. A nearer layer wins.
  const disabled = new Map<string, boolean>();
  for (const data of [config, ...layerConfigs.map(layer => layer.config)]) if (isObject(data.skills)) for (const item of list(data.skills.config)) {
    if (isObject(item) && typeof item.path === 'string' && typeof item.enabled === 'boolean') { disabled.set(resolve(item.path), item.enabled); disabled.set(real(item.path), item.enabled); }
  }

  const sink: Sink = { entries: [], mcp: [], hooks: [] };
  const seen = new Set<string>();
  const skills = (dir: string, origin: Origin) => {
    for (const folder of findSkills(dir).filter(path => path !== dir)) {
      if (seen.has(real(folder))) continue;
      seen.add(real(folder));
      const found = codexSkill(folder, { origin, qualify: name => name }, disabled, ctx); if (found) sink.entries.push(found);
    }
  };
  skills(join(user, '.agents', 'skills'), 'user');
  for (const dir of dirs) skills(join(dir, '.agents', 'skills'), 'project');
  skills(options.adminSkills ?? '/etc/codex/skills', 'admin');
  // System skills ship in <home>/skills/.system. The documentation says only "bundled with Codex", so the folder is what is read.
  const system = join(home, 'skills', '.system');
  for (const folder of skillFolders(system)) { const found = codexSkill(folder, { origin: 'bundled', qualify: name => name }, disabled, ctx); if (found) sink.entries.push(found); }
  if (sink.entries.some(entry => entry.origin === 'bundled')) warnings.add(`bundled Codex skills were read from ${system}; the documentation does not name that folder`);
  const userSkills = real(join(user, '.agents', 'skills')), extra = skillFolders(join(home, 'skills')).filter(folder => real(dirname(folder)) !== userSkills);
  if (extra.length) warnings.add(`${extra.length} skill folders under ${join(home, 'skills')} are not in a documented Codex location and are not counted`);

  // Agents: <home>/agents/*.toml and project .codex/agents/*.toml identify themselves by name; [agents.<role>] tables in config.toml declare roles.
  const agent = (file: string, origin: Origin) => {
    const data = ctx.toml(file); if (!data) return;
    if (!str(data.name) || !str(data.description)) { ctx.warn(`${file} lacks a name or description, which a Codex agent file requires; it is skipped`); return; }
    sink.entries.push({ host: 'codex', kind: 'agent', name: str(data.name), qualified: str(data.name), origin, source: file, descriptionChars: str(data.description).length, whenToUseChars: 0 });
  };
  const agentFiles = (dir: string, origin: Origin) => { for (const name of names(dir)) if (name.endsWith('.toml') && isFile(join(dir, name))) agent(join(dir, name), origin); };
  const roles = (data: Json, origin: Origin, source: string) => {
    if (isObject(data.agents)) for (const [role, value] of Object.entries(data.agents)) if (isObject(value) && typeof value.description === 'string') sink.entries.push({ host: 'codex', kind: 'agent', name: role, qualified: role, origin, source, descriptionChars: value.description.trim().length, whenToUseChars: 0 });
  };
  agentFiles(join(home, 'agents'), 'user'); roles(config, 'user', configFile);
  for (const layer of layerConfigs) { agentFiles(join(layer.dir, 'agents'), 'project'); roles(layer.config, 'project', join(layer.dir, 'config.toml')); }

  // MCP servers and hooks of the user and project layers.
  const servers = (data: Json, origin: Origin, source: string) => {
    if (isObject(data.mcp_servers)) for (const [name, entry] of Object.entries(data.mcp_servers)) sink.mcp.push(mcpServer('codex', name, entry, { origin, source, enabled: isObject(entry) && typeof entry.enabled === 'boolean' ? entry.enabled : undefined }, ctx));
  };
  servers(config, 'user', configFile);
  for (const layer of layerConfigs) servers(layer.config, 'project', join(layer.dir, 'config.toml'));
  const hookFile = (file: string, origin: Origin) => { const data = ctx.json(file); if (data) sink.hooks.push(...hookEntries(data.hooks, { host: 'codex', origin, source: file }, own)); };
  hookFile(join(home, 'hooks.json'), 'user'); sink.hooks.push(...hookEntries(config.hooks, { host: 'codex', origin: 'user', source: configFile }, own));
  for (const layer of layerConfigs) { hookFile(join(layer.dir, 'hooks.json'), 'project'); sink.hooks.push(...hookEntries(layer.config.hooks, { host: 'codex', origin: 'project', source: join(layer.dir, 'config.toml') }, own)); }

  // Plugins from the CLI; config.toml [plugins."name@marketplace"] and the cache when it cannot run.
  const cache = join(home, 'plugins', 'cache');
  const cached = (marketplace: string, name: string, wanted?: string): string | undefined => {
    const base = join(cache, marketplace, name);
    if (wanted && isDir(join(base, wanted))) return join(base, wanted);
    const modified = (entry: string): number => { try { return statSync(join(base, entry)).mtimeMs; } catch { return 0; } };
    const versions = names(base).filter(entry => isDir(join(base, entry))).sort((a, b) => modified(b) - modified(a) || (a < b ? 1 : -1));
    return versions.length ? join(base, versions[0]!) : undefined;
  };
  let plugins: PluginInfo[] | undefined;
  const listed = attempt(run, 'codex', ['plugin', 'list', '--json'], hostEnv, commandDirectory(project));
  if (listed.status === 0) {
    try {
      const data = JSON.parse(listed.stdout), rows = Array.isArray(data) ? data : data?.installed;
      if (Array.isArray(rows)) plugins = rows.filter(isObject).flatMap((item): PluginInfo[] => {
        const id = typeof item.pluginId === 'string' ? item.pluginId : typeof item.name === 'string' && typeof item.marketplaceName === 'string' ? `${item.name}@${item.marketplaceName}` : undefined;
        if (!id) return [];
        const [name, marketplace] = id.split('@') as [string, string | undefined];
        const local = isObject(item.source) && item.source.source === 'local' && typeof item.source.path === 'string' ? item.source.path : undefined;
        const path = (marketplace ? cached(marketplace, name, typeof item.version === 'string' ? item.version : undefined) : undefined) ?? (local && isDir(local) ? local : undefined);
        return [clean({ host: 'codex' as const, id, enabled: item.enabled !== false, version: typeof item.version === 'string' ? item.version : undefined, path })];
      });
    } catch { /* fall back below */ }
  }
  const pluginConfig = isObject(config.plugins) ? config.plugins : {};
  if (!plugins) {
    warnings.add('codex plugin list --json failed; plugins come from config.toml and the plugin cache');
    const ids = new Set<string>(Object.keys(pluginConfig).filter(id => id.includes('@')));
    for (const marketplace of names(cache)) for (const name of names(join(cache, marketplace))) ids.add(`${name}@${marketplace}`);
    plugins = [...ids].sort().map(id => {
      const [name, marketplace] = id.split('@') as [string, string];
      const path = cached(marketplace, name);
      return clean({ host: 'codex' as const, id, enabled: !isObject(pluginConfig[id]) || pluginConfig[id].enabled !== false, version: path ? basename(path) : undefined, path });
    });
  }
  let namespaced = false;
  for (const info of plugins) {
    if (!info.enabled) continue;
    if (!info.path || !isDir(info.path)) { warnings.add(`plugin ${info.id} is enabled but its path was not found`); continue; }
    const root = info.path, manifestFile = isFile(join(root, '.codex-plugin', 'plugin.json')) ? join(root, '.codex-plugin', 'plugin.json') : join(root, 'plugin.json');
    const manifest = ctx.json(manifestFile) ?? {}, name = str(manifest.name) || info.id.split('@')[0]!, label = `plugin ${name}`;
    const roots = manifest.skills === undefined ? [join(root, 'skills')] : list(manifest.skills).map(value => within(root, value, `${label}: skills`, ctx)).filter((dir): dir is string => !!dir);
    for (const dir of roots) for (const folder of findSkills(dir)) {
      if (seen.has(real(folder))) continue;
      seen.add(real(folder));
      const found = codexSkill(folder, { origin: 'plugin', plugin: info.id, qualify: skill => `${name}:${skill}` }, disabled, ctx);
      if (found) { sink.entries.push(found); namespaced = true; }
    }
    const base = { host: 'codex' as const, origin: 'plugin' as const, plugin: info.id };
    const scope: Scope = { root, home: user };
    const pluginHooks = (file: string) => { const data = ctx.json(file); if (data) sink.hooks.push(...hookEntries(data.hooks ?? data, { ...base, source: file }, scope)); };
    if (manifest.hooks === undefined) pluginHooks(join(root, 'hooks', 'hooks.json'));
    else for (const value of list(manifest.hooks)) {
      if (typeof value === 'string') { const path = within(root, value, `${label}: hooks`, ctx); if (path) pluginHooks(path); }
      else if (isObject(value)) sink.hooks.push(...hookEntries(value.hooks ?? value, { ...base, source: manifestFile }, scope));
    }
    const overrides = isObject(pluginConfig[info.id]) && isObject(pluginConfig[info.id].mcp_servers) ? pluginConfig[info.id].mcp_servers : {};
    for (const [server, entry] of pluginServers(root, manifest, label, ctx)) {
      const on = isObject(overrides[server]) && typeof overrides[server].enabled === 'boolean' ? overrides[server].enabled : undefined;
      sink.mcp.push(mcpServer('codex', server, entry, { origin: 'plugin', source: root, plugin: info.id, enabled: on }, ctx));
    }
  }
  if (namespaced) warnings.add('Codex plugin skills are listed as <plugin>:<skill>; the documentation does not say how Codex namespaces plugin skills');

  const result = attempt(run, 'codex', ['--version'], hostEnv), found = result.status === 0 ? version(result.stdout) : undefined;
  if (!found) warnings.add('codex --version did not report a version');
  return { host: 'codex', home, homeSource, version: found, plugins, entries: sink.entries, mcp: sink.mcp, hooks: sink.hooks, settings, warnings: [...warnings] };
}
