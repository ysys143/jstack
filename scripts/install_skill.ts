import { isMain } from '../runtime/entry.js';
/** Install a marketplace skill as a personal skill under the Claude home; no plugin registry involved. */
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertCaseUnique, assertNoLinks, atomicWrite, expand } from '../runtime/os.js';
import { extractItems, parseJson, searchUrl } from './search_api.js';

export interface ResolvedSkill { name: string; description: string; author: string; sourceUrl: string; rawFileUrl: string; namespace: string }
export interface InstallResult { code: number; text: string; targetPath?: string }

const USAGE = 'Usage: install_skill <namespace> [--force]\nExample: install_skill "@wshobson/agents/auth-implementation-patterns"';
/** Frontmatter keys that widen what an installed skill may do without asking; the install output warns about them. */
const PRIVILEGED_KEYS: [name: string, pattern: RegExp][] = [['allowed-tools', /allowed[-_]tools/i], ['hooks', /(?:^|[\s{,"'])hooks["']?\s*:/im]];

/** `CLAUDE_CONFIG_DIR` when set, else `~/.claude`; matches Claude Code's own resolution. */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? expand(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
}

/** The destination directory name: the namespace's last path segment, normalized to kebab-case.
 * Refuses rather than silently mangling an input that cannot become a safe path component. */
export function safeSkillName(namespace: string): string {
  const last = namespace.split('/').filter(Boolean).pop() ?? '';
  const name = last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`cannot derive a safe skill name from: ${namespace}`);
  return name;
}

/** A download address is accepted only as https to a named host: no credentials, no IP literal, no localhost.
 * The check is by name. A name that DNS resolves to a private or loopback address is not caught; https certificate
 * validation is what stands between such a name and a download. */
export function assertDownloadUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Refusing a download URL that is not a URL: ${value}`); }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (url.protocol !== 'https:') throw new Error(`Refusing to download over ${url.protocol.replace(/:$/, '')}: only https is accepted (${url.href})`);
  if (url.username || url.password) throw new Error(`Refusing a download URL with credentials: ${url.origin}`);
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') || /^[0-9.]+$/.test(host)) throw new Error(`Refusing a download from a local or IP-literal host: ${host}`);
  return url;
}

/** Find the marketplace entry for a namespace: exact namespace match. A bare name, with no `/`, may match an entry by name.
 * A qualified namespace never falls back to the name: that would install another author's skill of the same name.
 * Five results are enough for an exact namespace: the API answers a full namespace with that entry first and few others
 * (checked against the live API), while a bare name is matched only among the five it returns. */
export async function resolveSkill(namespace: string, fetcher: typeof fetch = fetch): Promise<ResolvedSkill> {
  const url = searchUrl(['skills', namespace, '5']);
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) throw new Error('No response from API');
  const value = parseJson(text); if (value === undefined) throw new Error('Malformed JSON from search API');
  const items = extractItems(value); if (!items) throw new Error('Unexpected response format from search API');
  const entry = items.find((item: any) => item?.namespace === namespace) ?? (namespace.includes('/') ? undefined : items.find((item: any) => item?.name === namespace));
  if (!entry) throw new Error(`Skill not found: ${namespace}`);
  const rawFileUrl = entry.metadata?.rawFileUrl;
  if (!rawFileUrl) throw new Error('No download URL available for this skill');
  return { name: safeSkillName(namespace), description: String(entry.description ?? ''), author: String(entry.author ?? 'unknown'), sourceUrl: String(entry.sourceUrl ?? ''), rawFileUrl: String(rawFileUrl), namespace: String(entry.namespace ?? namespace) };
}

/** Download over https only. A redirect is followed by hand so every hop passes the same address check. */
export async function downloadSkillBody(rawFileUrl: string, fetcher: typeof fetch = fetch): Promise<string> {
  let url = assertDownloadUrl(rawFileUrl);
  for (let hops = 0; ; hops++) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (location) {
      await response.body?.cancel().catch(() => undefined);
      if (hops >= 3) throw new Error('Too many redirects while downloading SKILL.md');
      url = assertDownloadUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Failed to download SKILL.md (HTTP ${response.status})`); }
    const text = await response.text();
    if (!text.trim()) throw new Error('Downloaded SKILL.md is empty');
    return text;
  }
}

/** Marketplace bodies do not always ship frontmatter; synthesize it from resolved metadata when absent.
 * The description is untrusted text: it is folded onto one line and quoted so it cannot add keys. */
export function withFrontmatter(body: string, name: string, description: string): string {
  if (/^---\r?\n/.test(body)) return body;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.replace(/\s+/g, ' ').trim() || name)}\n---\n\n${body}`;
}

/** The frontmatter block; an opening marker without a closing one makes the whole text count as frontmatter. */
function frontmatterBlock(body: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? (/^---\r?\n/.test(body) ? body : '');
}

/** Top-level keys of the frontmatter block, in order; a quoted key is listed without its quotes. */
export function frontmatterKeys(body: string): string[] {
  return [...frontmatterBlock(body).matchAll(/^["']?([A-Za-z][\w-]*)["']?[ \t]*:/gm)].map(match => match[1]!);
}

/** Privileged keys declared anywhere in the frontmatter, by a deliberately loose match: a quoted key or a flow mapping
 * such as `{name: x, allowed-tools: Bash}` is valid YAML that a line-by-line key listing would miss. */
export function privilegedKeys(body: string): string[] {
  const block = frontmatterBlock(body);
  return PRIVILEGED_KEYS.filter(([, pattern]) => pattern.test(block)).map(([name]) => name);
}

/** Say why a link or a name collision blocked the write and what to do about it. */
function refusal(targetDir: string, error: unknown): InstallResult {
  const reason = (error as Error).message;
  const advice = /symlink/.test(reason)
    ? 'A link sits on the way to this folder, for example a linked skills folder. jstack does not write through links. Point CLAUDE_CONFIG_DIR at a home whose skills folder is a real directory, or place the file there yourself.'
    : /collision/.test(reason) ? 'A skill folder whose name differs only in case or Unicode form already exists beside it. Rename or remove that folder first.' : 'Choose a home that stays inside its own directory.';
  return { code: 1, text: `Error: cannot install into ${targetDir}: ${reason}.\n${advice}` };
}

export async function install(argv: string[], fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<InstallResult> {
  const force = argv.includes('--force'), positional = argv.filter(arg => arg !== '--force');
  const option = positional.find(arg => arg.startsWith('-'));
  if (option) return { code: 1, text: `Error: unknown option ${option}\n${USAGE}` };
  if (positional.length !== 1) return { code: 1, text: `Error: ${positional.length ? `expected one namespace, got ${positional.length}: ${positional.join(' ')}` : 'namespace required'}\n${USAGE}` };
  const namespace = positional[0]!;
  try {
    const resolved = await resolveSkill(namespace, fetcher);
    console.log(`Found: ${resolved.name}\n  Namespace: ${resolved.namespace}\n  Author: ${resolved.author}\n  Description: ${resolved.description}`);
    const body = withFrontmatter(await downloadSkillBody(resolved.rawFileUrl, fetcher), resolved.name, resolved.description);
    const keys = frontmatterKeys(body);
    console.log(`Frontmatter keys: ${keys.join(', ') || '(none)'}`);
    const privileged = privilegedKeys(body);
    if (privileged.length) console.log(`Warning: this skill declares ${privileged.join(', ')}. Those keys widen what the skill may do once it is active; read the file before using it.`);
    // Personal skills (<home>/skills/<name>/SKILL.md) are directory-discovered by Claude Code;
    // no plugin/marketplace registration is involved, so none is written here.
    const rawHome = claudeHome(env);
    mkdirSync(rawHome, { recursive: true });
    const home = realpathSync(rawHome);
    console.log(`Target home: ${home}`);
    const targetDir = join(home, 'skills', resolved.name), targetPath = join(targetDir, 'SKILL.md');
    // Check links and name collisions before creating anything, so a refusal leaves no directory behind.
    try { assertNoLinks(targetDir, home); assertCaseUnique(targetDir); } catch (error) { return refusal(targetDir, error); }
    mkdirSync(targetDir, { recursive: true });
    try { assertCaseUnique(targetPath); } catch (error) { return refusal(targetDir, error); }
    // A same-named skill with different content may have come from somewhere else;
    // identical content is a re-run and stays idempotent.
    if (existsSync(targetPath)) {
      if (readFileSync(targetPath, 'utf8') === body) return { code: 0, text: `Already installed: ${resolved.name}\n  Path: ${targetPath}\n  (content unchanged)`, targetPath };
      if (!force) return { code: 1, text: `Error: ${targetPath} already exists with different content.\nRefusing to overwrite a skill that may have come from elsewhere. Re-run with --force to replace it.`, targetPath };
    }
    atomicWrite(targetPath, Buffer.from(body, 'utf8'), false);
    return { code: 0, text: `Installed: ${resolved.name}\n  Path: ${targetPath}\n\nRestart Claude Code to activate the skill.`, targetPath };
  } catch (error) { return { code: 1, text: `Error: ${(error as Error).message}` }; }
}

if (isMain(import.meta.url)) { const result = await install(process.argv.slice(2)); console.log(result.text); process.exitCode = result.code; }
