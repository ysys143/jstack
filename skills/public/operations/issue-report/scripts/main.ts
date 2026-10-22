import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';
import { roots, readConfig, saveConfig, readQueue, saveCandidate, findCandidate, known, redactor, signature, idFor, cap, clip, headline, DEFAULT_REPO, REPO_PATTERN, type Candidate, type Config } from './state.js';
import { scanSources } from './scan.js';
import { writeDraft, resolveDraft, submit } from './draft.js';

export const HELP = `jst report status|list|scan|note|dismiss|draft|submit|finish
  status [--json]                      Last retrospective and queue counts
  note --surface NAME --text TEXT [--excerpt-file PATH]  Record one accepted candidate
  scan [--since ISO|--hours N] [--json]  Read Claude and Codex transcripts; queue jstack failures
  list [--all] [--json]                Show queued and drafted candidates
  dismiss ID...                        Mark candidates as not worth reporting
  draft ID... [--expected TEXT] [--actual TEXT] [--steps TEXT]
  submit DRAFT --confirm [--new] [--repo OWNER/NAME] [--json]
                                       Create a GitHub issue through gh; --repo targets
                                       this submission only and is never saved
  finish                               Record the end of a retrospective without submission
Options: --home DIRECTORY (alternate user home; ignores CLAUDE_CONFIG_DIR and CODEX_HOME)
Repository: ${DEFAULT_REPO} unless the report config sets repo
says otherwise; status and submit print a WARNING for any other repository.
State: ~/.jstack/reports. Only submit --confirm contacts the network. Exit 3: gh is
missing, unauthenticated or lacks repository access; the draft path is printed.
Exit 4: an open issue already carries the signature; nothing was submitted.
`;
class UsageError extends Error {}
const VALUE = ['--home', '--surface', '--text', '--excerpt-file', '--since', '--hours', '--expected', '--actual', '--steps', '--repo'];
const BOOLEAN = ['--json', '--confirm', '--new', '--all', '--help'];
function parse(argv: string[]) {
  const flags = new Map<string, string>(), positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (flags.has(arg)) throw new UsageError(`Repeated option: ${arg}`);
    if (BOOLEAN.includes(arg)) { flags.set(arg, 'true'); continue; }
    if (!VALUE.includes(arg) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new UsageError(`Invalid option: ${arg}`);
    flags.set(arg, argv[++i]);
  }
  return { flags, positional };
}
const HOUR = 3_600_000;
function counts(queue: Candidate[]) { const out: Record<string, number> = { queued: 0, drafted: 0, submitted: 0, dismissed: 0 }; for (const c of queue) out[c.status] = (out[c.status] ?? 0) + 1; return out; }
/** A report sent anywhere but the default repository is named before it leaves the machine. */
function repoWarning(repo: string, source: string): string[] {
  return repo === DEFAULT_REPO ? [] : [`WARNING: the target repository is ${repo}, not the default ${DEFAULT_REPO}; ${source}.`];
}
const line = (c: Candidate) => `${c.id}  ${c.status.padEnd(9)} ${c.skillOrCommand.padEnd(22)} ${c.observedAt || '-'}  ${clip(headline(c.excerpt), 80)}`;

/** Where main writes and which environment its child processes (gh, doctor) see; tests pass their own. */
export interface Streams { stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } }
export async function main(argv = process.argv.slice(2), io: Streams = process, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const { flags, positional } = parse(argv), [action = 'help', ...ids] = positional;
    if (action === 'help' || flags.has('--help')) { io.stdout.write(HELP); return 0; }
    if (flags.has('--repo') && action !== 'submit') throw new UsageError('--repo applies only to submit');
    if (flags.has('--repo') && !REPO_PATTERN.test(flags.get('--repo')!)) throw new UsageError('--repo must be OWNER/NAME');
    const r = roots(flags.get('--home')), json = flags.has('--json'), redact = redactor(r);
    const out = (value: unknown, text: string) => io.stdout.write(json ? JSON.stringify(value, null, 2) + '\n' : text.endsWith('\n') ? text : text + '\n');
    const noArgs = () => { if (ids.length) throw new UsageError(`${action} takes no positional arguments`); };
    const configFile = redact(join(r.reports, 'config.json'));
    const configured = (repo: string) => repoWarning(repo, `repo in ${configFile} applies to every submission until it is removed there`);
    /** A configured repo that failed validation is named, never silently replaced by the default. */
    const rejected = (config: Config, effect: string) => config.rejectedRepo === undefined ? [] : [`WARNING: repo ${JSON.stringify(clip(redact(config.rejectedRepo), 80))} in ${configFile} is not a valid OWNER/NAME; ${effect}.`];
    const REFUSES = 'submit refuses until it is fixed there or --repo OWNER/NAME is given';
    if (action === 'status') {
      noArgs(); const config = readConfig(r), queue = readQueue(r);
      const hours = config.lastRetro ? (Date.now() - Date.parse(config.lastRetro)) / HOUR : null;
      const status = { ...config, defaultRepo: DEFAULT_REPO, warnings: [...configured(config.repo), ...rejected(config, REFUSES)], hoursSinceLastRetro: hours === null ? null : Math.round(hours * 10) / 10, counts: counts(queue), state: redact(r.reports) };
      out(status, `Repository: ${config.repo}\n${status.warnings.map(w => `${w}\n`).join('')}Last retrospective: ${config.lastRetro ?? 'never'}${hours !== null && hours < 20 ? ` (${status.hoursSinceLastRetro} hours ago, under 20 hours)` : ''}\nCandidates: ${Object.entries(status.counts).map(([k, v]) => `${k} ${v}`).join(', ')}\nState: ${status.state}`);
    } else if (action === 'finish') {
      noArgs(); const config = saveConfig(r, { lastRetro: new Date().toISOString() });
      out(config, `Retrospective recorded at ${config.lastRetro}.`);
    } else if (action === 'note') {
      noArgs();
      const surface = flags.get('--surface')?.trim(), note = flags.get('--text')?.trim();
      if (!surface || !note) throw new UsageError('note requires --surface NAME and --text TEXT');
      const extra = flags.has('--excerpt-file') ? readFileSync(flags.get('--excerpt-file')!, 'utf8') : '';
      const raw = extra ? `${note}\n${extra}` : note, sig = signature(surface, extra || note), seen = known(r);
      if (seen.has(sig)) { out({ recorded: false, duplicateOf: seen.get(sig) }, `Already recorded as ${seen.get(sig)}; nothing added.`); return 0; }
      const candidate: Candidate = { id: idFor(sig), signature: sig, source: 'note', observedAt: new Date().toISOString(), skillOrCommand: clip(redact(surface), 80), excerpt: cap(redact(raw)), status: 'queued' };
      saveCandidate(r, candidate);
      out({ recorded: true, candidate }, `Recorded ${candidate.id} (${candidate.skillOrCommand}). Dismiss with: jst report dismiss ${candidate.id}`);
    } else if (action === 'scan') {
      noArgs();
      const until = Date.now(), config = readConfig(r);
      if (flags.has('--since') && flags.has('--hours')) throw new UsageError('Use either --since or --hours');
      let since: number;
      if (flags.has('--since')) { since = Date.parse(flags.get('--since')!); if (Number.isNaN(since)) throw new UsageError('--since must be an ISO date'); }
      else if (flags.has('--hours')) { const n = Number(flags.get('--hours')); if (!(n > 0 && n <= 24 * 365)) throw new UsageError('Invalid --hours'); since = until - n * HOUR; }
      else since = config.lastRetro && !Number.isNaN(Date.parse(config.lastRetro)) ? Date.parse(config.lastRetro) : until - 24 * HOUR;
      const result = scanSources(r, since, until, known(r), redact);
      for (const candidate of result.added) saveCandidate(r, candidate);
      const text = [
        ...result.warnings.map(w => `WARNING: ${w}`),
        `Window: ${result.since} to ${result.until}`,
        ...result.sources.map(s => `Source ${s.host}: ${s.status}, ${s.files} files read (${s.root})`),
        result.added.length ? `New candidates: ${result.added.length}` : result.complete ? 'No new jstack failures found in the window.' : 'No new jstack failures found in the readable sources. This is not a complete result; see the warnings above.',
        ...result.added.map(line),
        result.duplicates.length ? `Already known: ${result.duplicates.length} (${[...new Set(result.duplicates.map(d => d.existing))].join('; ')})` : '',
      ].filter(Boolean).join('\n');
      out(result, text);
    } else if (action === 'list') {
      noArgs(); const queue = readQueue(r).filter(c => flags.has('--all') || c.status === 'queued' || c.status === 'drafted');
      out(queue, queue.length ? queue.map(line).join('\n') : 'No open candidates.');
    } else if (action === 'dismiss') {
      if (!ids.length) throw new UsageError('dismiss requires at least one ID');
      const changed = ids.map(id => findCandidate(r, id)).map(c => { const next = { ...c, status: c.status === 'submitted' ? c.status : 'dismissed' } as Candidate; saveCandidate(r, next); return next; });
      out(changed, changed.map(c => `${c.id} ${c.status}`).join('\n'));
    } else if (action === 'draft') {
      if (!ids.length) throw new UsageError('draft requires at least one ID');
      const selected = ids.map(id => findCandidate(r, id));
      const files = selected.map(c => ({ id: c.id, draft: writeDraft(r, c, { expected: flags.get('--expected'), actual: flags.get('--actual'), steps: flags.get('--steps') }, redact, env) }));
      out(files, files.map(f => `${f.id} draft: ${f.draft}`).join('\n') + '\nRead the whole draft before approving submission.');
    } else if (action === 'submit') {
      if (ids.length !== 1) throw new UsageError('submit requires exactly one DRAFT path or ID');
      const file = resolveDraft(r, ids[0]), config = readConfig(r), repo = flags.get('--repo') ?? config.repo;
      const warnings = flags.has('--repo') ? [...repoWarning(repo, '--repo applies to this submission only and is not saved'), ...rejected(config, 'it is ignored for this submission')] : [...configured(repo), ...rejected(config, REFUSES)];
      for (const warning of warnings) io.stderr.write(`${warning}\n`);
      if (!flags.has('--repo') && config.rejectedRepo !== undefined) { io.stderr.write(`Refusing to submit while the configured repository is invalid. Nothing was sent. Draft: ${file}\n`); return 2; }
      if (!flags.has('--confirm')) { io.stderr.write(`Refusing to submit without --confirm. Nothing was sent. Target: ${repo}. Draft: ${file}\n`); return 2; }
      const result = submit(r, { ...config, repo }, file, redact, flags.has('--new'), env);
      out({ ...result, repo, warnings }, `${result.message}${result.matches?.length ? '\n' + JSON.stringify(result.matches, null, 2) : ''}`);
      return result.code;
    } else throw new UsageError('Unknown report action; run jst report --help');
    return 0;
  } catch (error) { io.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'); return error instanceof UsageError ? 2 : 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
