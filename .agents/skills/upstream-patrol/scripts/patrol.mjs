#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_FILE = join(SKILL_ROOT, 'upstreams.json');
const MODES = new Set(['snapshot', 'adapted', 'link', 'watch-release']);
const VERDICTS = new Set(['absorb', 'queued', 'no-change', 'defer', 'replace-candidate']);
const HEX40 = /^[0-9a-f]{40}$/i;

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: options.env ?? process.env,
    cwd: options.cwd
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null
  };
}

export function classifyError(message) {
  const text = String(message ?? '');
  if (/401|403|authentication|not logged in|gh auth|bad credentials|token/i.test(text)) return 'authentication';
  if (/404|not found|no commit found/i.test(text)) return 'not-found';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|TLS|connection reset|could not resolve/i.test(text)) return 'network';
  return 'command';
}

function commandOutput(result, command, args) {
  if (result.status !== 0) {
    const message = [result.stderr, result.stdout, result.error].filter(Boolean).join('\n').trim();
    const error = new Error(`${command} ${args.join(' ')} failed: ${message || `exit ${result.status}`}`);
    error.category = classifyError(message);
    error.status = result.status;
    throw error;
  }
  return result.stdout;
}

function ghText(run, args) {
  return commandOutput(run('gh', args), 'gh', args).trim();
}

function ghJson(run, endpoint) {
  const raw = ghText(run, ['api', endpoint]);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${endpoint}: ${error.message}`);
  }
}

function ghPaginatedShas(run, endpoint) {
  const args = ['api', '--paginate', endpoint, '--jq', '.[].sha'];
  const output = ghText(run, args);
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => HEX40.test(line));
}

function repoEndpoint(repo, suffix = '') {
  return `repos/${repo}${suffix}`;
}

function apiPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function readIndex(indexPath = INDEX_FILE) {
  return JSON.parse(readFileSync(indexPath, 'utf8'));
}

function ownerSkills(entry) {
  return new Set((entry.imports ?? []).map(item => item.ownerSkill).filter(Boolean));
}

function latestVerdict(entry) {
  return entry.reviews?.at(-1)?.verdict ?? entry.state;
}

function recordedPinValue(item) {
  if (item.pinRecordedIn?.form === 'short7') return item.pin?.slice(0, 7) ?? '';
  if (item.pinRecordedIn?.form === 'version') return item.recordedVersion ?? item.tag ?? item.version ?? '';
  return item.pin ?? '';
}

function pinMatchesFile(item, body) {
  const form = item.pinRecordedIn?.form;
  if (form === 'full') return Boolean(item.pin && body.includes(item.pin));
  if (form === 'short7') return Boolean(item.pin && body.includes(item.pin.slice(0, 7)));
  if (form === 'version') {
    const value = recordedPinValue(item);
    return Boolean(value && body.includes(value));
  }
  return item.pin === null && item.pinRecordedIn === null;
}

function expectedPending(item) {
  return (item.notes ?? []).some(note => /appears when part a is integrated|pending integration/i.test(note));
}

export function checkIndex(index, { root = process.cwd(), run = runCommand } = {}) {
  const errors = [];
  const warnings = [];
  const checked = { upstreams: 0, imports: 0, localPaths: 0, pinRecords: 0 };
  if (!index || !Array.isArray(index.upstreams)) errors.push('upstreams must be an array');
  if (!Array.isArray(index?.exclusions)) errors.push('exclusions must be an array');
  if (index?.lastRunAt !== null && index?.lastRunAt !== undefined && Number.isNaN(Date.parse(index.lastRunAt))) {
    errors.push('lastRunAt must be an ISO date or null');
  }
  const ids = new Set();
  const changedRecordFiles = new Map();
  for (const entry of index?.upstreams ?? []) {
    checked.upstreams += 1;
    if (!entry.id || ids.has(entry.id)) errors.push(`missing or duplicate id: ${entry.id ?? '(empty)'}`);
    ids.add(entry.id);
    if (entry.repo !== null && !/^[^/]+\/[^/]+$/.test(entry.repo ?? '')) errors.push(`${entry.id}: repo must be owner/name or null`);
    if (entry.repo === null && entry.branch !== null) errors.push(`${entry.id}: repo:null requires branch:null`);
    if (entry.repo === null && entry.state === 'source-location-required') warnings.push(`${entry.id}: source URL is not recorded; identify it before a new adaptation`);
    if (!Array.isArray(entry.imports)) {
      errors.push(`${entry.id}: imports must be an array`);
      continue;
    }
    if (!entry.imports.length) warnings.push(`${entry.id}: no tracked imports`);
    for (const item of entry.imports) {
      checked.imports += 1;
      if (!MODES.has(item.mode)) errors.push(`${entry.id}: invalid import mode ${item.mode}`);
      if (!Array.isArray(item.upstreamPaths) || !Array.isArray(item.localPaths)) errors.push(`${entry.id}: upstreamPaths and localPaths must be arrays`);
      if (!item.ownerSkill) errors.push(`${entry.id}: import is missing ownerSkill`);
      if (item.pin !== null && !HEX40.test(item.pin ?? '')) errors.push(`${entry.id}: pin must be a full 40-character SHA or null`);
      if (item.pin && !item.pinRecordedIn) errors.push(`${entry.id}: pinned import is missing pinRecordedIn`);
      if (item.pinRecordedIn && !['full', 'short7', 'version'].includes(item.pinRecordedIn.form)) errors.push(`${entry.id}: invalid pinRecordedIn.form`);
      for (const localPath of item.localPaths ?? []) {
        checked.localPaths += 1;
        if (!existsSync(resolve(root, localPath))) {
          const message = `${entry.id}: local path does not exist: ${localPath}`;
          (expectedPending(item) ? warnings : errors).push(expectedPending(item) ? `${message} (pending Part A integration)` : message);
        }
      }
      const record = item.pinRecordedIn;
      if (record) {
        checked.pinRecords += 1;
        const file = resolve(root, record.file);
        if (!existsSync(file)) {
          const message = `${entry.id}: pin record file does not exist: ${record.file}`;
          (expectedPending(item) ? warnings : errors).push(expectedPending(item) ? `${message} (pending Part A integration)` : message);
        } else {
          const body = readFileSync(file, 'utf8');
          if (!pinMatchesFile(item, body)) {
            const message = `${entry.id}: recorded ${record.form} value not found in ${record.file}`;
            (expectedPending(item) ? warnings : errors).push(expectedPending(item) ? `${message} (pending Part A integration)` : message);
          }
          if (entry.lastReviewed) {
            const changedAt = changedRecordFiles.has(record.file)
              ? changedRecordFiles.get(record.file)
              : commandOutput(run('git', ['log', '-1', '--format=%cI', '--', record.file], { cwd: root }), 'git', ['log', '-1', '--format=%cI', '--', record.file]).trim();
            changedRecordFiles.set(record.file, changedAt);
            if (changedAt && Date.parse(changedAt) > Date.parse(entry.lastReviewed)) {
              warnings.push(`${entry.id}: ${record.file} changed after its last review; the product skill may have updated it directly`);
            }
          }
        }
      } else if (item.pin === null && entry.state === 'pin-required') {
        warnings.push(`${entry.id}: baseline pin is missing; establish it during the first review`);
      }
    }
  }
  const noticePath = resolve(root, 'NOTICE.md');
  if (existsSync(noticePath)) {
    const notice = readFileSync(noticePath, 'utf8');
    if (/skills\/science\/repos\//.test(notice) && !existsSync(resolve(root, 'skills/science/repos'))) {
      warnings.push('NOTICE.md contains the known legacy skills/science/repos paths; leave repair to a separate documentation change');
    }
  }
  return { errors, warnings, checked };
}

export function compareIsPinLost(compare) {
  return Number(compare?.behind_by ?? 0) > 0 || ['behind', 'diverged'].includes(compare?.status);
}

export function scopedCommitSet(compare, commitsByPath, pin) {
  const compared = new Set((compare?.commits ?? []).map(commit => typeof commit === 'string' ? commit : commit.sha));
  const result = new Set();
  for (const shas of commitsByPath) {
    for (const sha of shas) if (compared.has(sha) && sha !== pin) result.add(sha);
  }
  return [...result].sort();
}

export function pathMatches(path, upstreamPath) {
  const prefix = upstreamPath === '.' ? '' : upstreamPath.replace(/\/$/, '');
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
}

export function classifyFile(path) {
  const lower = path.toLowerCase();
  if (/\.(py|js|mjs|ts|sh)$/.test(lower) || /(^|\/)hooks?(\/|$)/.test(lower) || /(^|\/)(package\.json|package-lock\.json|pyproject\.toml|cargo\.toml)$/.test(lower)) return 'executable';
  if (/(^|\/)(skill\.md|references?|prompts?|commands?)(\/|$)/i.test(path) || /(^|\/)(agents|rules)(\/|$)/i.test(path) || /\.(md|mdx|prompt|yaml|yml)$/i.test(path)) return 'instruction-surface';
  return 'other';
}

export function classifyFiles(files) {
  const result = { executable: [], 'instruction-surface': [], other: [] };
  for (const file of files ?? []) {
    const name = typeof file === 'string' ? file : file.filename;
    if (!name) continue;
    result[classifyFile(name)].push(name);
  }
  return result;
}

function treeMap(treeResponse) {
  return new Map((treeResponse?.tree ?? []).filter(item => item.type === 'blob').map(item => [item.path, item.sha]));
}

function parentDirectories(path) {
  if (path === '.') return [''];
  const parts = path.split('/');
  const dirs = [''];
  for (let i = 1; i <= parts.length; i += 1) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

function isRelevantLicensePath(file, upstreamPath) {
  if (upstreamPath === '.') return true;
  const directory = dirname(file) === '.' ? '' : dirname(file);
  const parents = parentDirectories(upstreamPath);
  return file === upstreamPath || file.startsWith(`${upstreamPath}/`) || parents.includes(directory);
}

function isLicenseFile(path) {
  return /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(\.[^/]*)?$/i.test(path);
}

function isManifest(path) {
  return /(^|\/)(package\.json|package-lock\.json|pyproject\.toml|cargo\.toml|composer\.json)$/i.test(path);
}

function licenseField(text, filename) {
  try {
    if (/\.json$/i.test(filename)) {
      const parsed = JSON.parse(text);
      return parsed.license ?? parsed.packages?.['']?.license ?? null;
    }
  } catch { /* malformed or non-JSON manifests are checked as text below */ }
  const match = text.match(/^\s*license\s*=\s*["']?([^"'\r\n#]+)/im);
  return match?.[1]?.trim() ?? null;
}

function ghContent(run, repo, path, ref) {
  const response = ghJson(run, repoEndpoint(repo, `/contents/${apiPath(path)}?ref=${encodeURIComponent(ref)}`));
  if (response.encoding === 'base64' && response.content) return Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8');
  return response.content ?? '';
}

function licenseTreeChanges(pinTree, headTree, upstreamPaths) {
  const before = treeMap(pinTree);
  const after = treeMap(headTree);
  const changed = [];
  const manifestChanged = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (!upstreamPaths.some(upstreamPath => isRelevantLicensePath(path, upstreamPath))) continue;
    if (before.get(path) === after.get(path)) continue;
    if (isLicenseFile(path)) changed.push({ path, before: before.get(path) ?? null, after: after.get(path) ?? null });
    if (isManifest(path)) manifestChanged.push({ path, before: before.get(path) ?? null, after: after.get(path) ?? null });
  }
  return { changed, manifestChanged };
}

export function compareLicense(expected, observed) {
  const expectedId = expected?.spdx_id ?? null;
  const observedId = observed?.spdx_id ?? null;
  if (expectedId === observedId) return null;
  return { expected: expectedId, observed: observedId };
}

function licenseAudit(run, entry, item, repoInfo, compare) {
  const result = {
    repoLicenseChange: compareLicense(entry.license, repoInfo.license),
    licenseFiles: [],
    manifestLicenseChanges: [],
    spdxHeaderChanges: []
  };
  if (!item.pin || !item.upstreamPaths?.length) return result;
  const pinTree = ghJson(run, repoEndpoint(entry.repo, `/git/trees/${item.pin}?recursive=1`));
  const headRef = compare.head_commit?.sha ?? entry.branch;
  const headTree = ghJson(run, repoEndpoint(entry.repo, `/git/trees/${headRef}?recursive=1`));
  const changes = licenseTreeChanges(pinTree, headTree, item.upstreamPaths);
  result.licenseFiles = changes.changed;
  for (const itemChange of changes.manifestChanged) {
    const oldText = itemChange.before ? ghContent(run, entry.repo, itemChange.path, item.pin) : '';
    const newText = itemChange.after ? ghContent(run, entry.repo, itemChange.path, headRef) : '';
    const before = licenseField(oldText, itemChange.path);
    const after = licenseField(newText, itemChange.path);
    if (before !== after) result.manifestLicenseChanges.push({ path: itemChange.path, before, after });
  }
  const added = (compare.files ?? []).filter(file => file.status === 'added' && item.upstreamPaths.some(path => pathMatches(file.filename, path)));
  for (const file of added) {
    const text = ghContent(run, entry.repo, file.filename, headRef);
    const declared = text.match(/SPDX-License-Identifier:\s*([^\s*]+)/)?.[1] ?? null;
    if (declared && declared !== (entry.license?.spdx_id ?? null)) result.spdxHeaderChanges.push({ path: file.filename, declared });
  }
  return result;
}

function changedPathsInScope(files, item) {
  return (files ?? []).filter(file => item.upstreamPaths?.some(path => pathMatches(file.filename, path)));
}

function compareResult(entry, item, compare, commitsByPath, repoInfo, run) {
  const scopedCommits = scopedCommitSet(compare, commitsByPath, item.pin);
  const scopedFiles = changedPathsInScope(compare.files, item);
  const audit = licenseAudit(run, entry, item, repoInfo, compare);
  return {
    pin: item.pin,
    branch: entry.branch,
    headSha: compare.head_commit?.sha ?? null,
    status: compare.status,
    ahead_by: compare.ahead_by,
    behind_by: compare.behind_by,
    pinLost: compareIsPinLost(compare),
    pathCommitCount: scopedCommits.length,
    pathCommits: scopedCommits,
    changedFiles: scopedFiles.map(file => ({ path: file.filename, status: file.status })),
    fileClassification: classifyFiles(scopedFiles),
    license: audit,
    suggestedVerdict: compareIsPinLost(compare) ? 'defer(pin-lost)' : null
  };
}

export function measureUpstream(entry, { run = runCommand } = {}) {
  if (entry.repo === null) {
    return { id: entry.id, repository: null, category: 'not-found', note: 'Source URL is not recorded; resolve it before GitHub compare.' };
  }
  const repoInfo = ghJson(run, repoEndpoint(entry.repo));
  const branchInfo = ghJson(run, repoEndpoint(entry.repo, `/branches/${encodeURIComponent(entry.branch)}`));
  const branchHeadSha = branchInfo.commit?.sha ?? null;
  const imports = [];
  for (const item of entry.imports ?? []) {
    if (!item.pin) {
      imports.push({ mode: item.mode, state: entry.state, pathCommitCount: null, note: 'No recorded pin; establish a baseline before compare.' });
      continue;
    }
    const rawCompare = ghJson(run, repoEndpoint(entry.repo, `/compare/${item.pin}...${encodeURIComponent(entry.branch)}`));
    const compare = rawCompare.head_commit || !branchHeadSha ? rawCompare : { ...rawCompare, head_commit: { sha: branchHeadSha } };
    const commitsByPath = item.upstreamPaths.map(path => {
      const query = new URLSearchParams({ sha: entry.branch, per_page: '100' });
      if (path !== '.') query.set('path', path);
      return ghPaginatedShas(run, repoEndpoint(entry.repo, `/commits?${query.toString()}`));
    });
    imports.push(compareResult(entry, item, compare, commitsByPath, repoInfo, run));
  }
  return {
    id: entry.id,
    repo: entry.repo,
    branch: entry.branch,
    headSha: branchHeadSha,
    archived: Boolean(repoInfo.archived),
    license: compareLicense(entry.license, repoInfo.license),
    imports
  };
}

export function recentRunWarning(lastRunAt, now = new Date()) {
  if (!lastRunAt || Number.isNaN(Date.parse(lastRunAt))) return null;
  const age = now.getTime() - Date.parse(lastRunAt);
  if (age < 0 || age >= 20 * 60 * 60 * 1000) return null;
  return `The last patrol ran ${Math.floor(age / 3_600_000)} hours ago; continuing without a prompt.`;
}

function parsePulls(run) {
  const args = ['pr', 'list', '--state', 'open', '--label', 'upstream-patrol', '--json', 'title,number,url,headRefName,body'];
  const raw = ghText(run, args);
  return JSON.parse(raw || '[]');
}

function pullMatchesEntry(pull, entry) {
  const searchable = [pull.title, pull.body, pull.headRefName, pull.url].filter(Boolean).join('\n').toLowerCase();
  const repo = entry.repo?.toLowerCase();
  const id = entry.id.toLowerCase();
  const branchId = id.replaceAll('_', '-');
  return Boolean((repo && searchable.includes(repo)) || searchable.includes(id) || searchable.includes(branchId));
}

function quickPathCount(entry, path, run) {
  if (!entry.repo || !entry.branch) return { count: 0, truncated: false };
  const query = new URLSearchParams({ sha: entry.branch, per_page: '100' });
  if (path !== '.') query.set('path', path);
  if (entry.lastReviewed) query.set('since', entry.lastReviewed);
  const commits = ghJson(run, repoEndpoint(entry.repo, `/commits?${query.toString()}`));
  const count = Array.isArray(commits) ? commits.length : 0;
  return { count, truncated: count === 100 };
}

function quickUpstreamState(entry, run) {
  if (!entry.repo) return { head: null, archived: null, pathCommitCount: 0, lowerBound: false };
  const repo = ghJson(run, repoEndpoint(entry.repo));
  let head = null;
  if (entry.branch) {
    const branch = ghJson(run, repoEndpoint(entry.repo, `/branches/${encodeURIComponent(entry.branch)}`));
    head = branch.commit?.sha ?? null;
  }
  let count = 0;
  let lowerBound = false;
  for (const path of new Set((entry.imports ?? []).flatMap(item => item.upstreamPaths ?? []))) {
    const result = quickPathCount(entry, path, run);
    count += result.count;
    lowerBound ||= result.truncated;
  }
  return { head, archived: Boolean(repo.archived), pathCommitCount: count, lowerBound };
}

function priorityGroup(entry) {
  const verdict = latestVerdict(entry);
  if (verdict === 'queued') return 0;
  if (verdict === 'defer') return 1;
  return 2;
}

export function dueOrder(candidates) {
  return [...candidates].sort((a, b) => priorityGroup(a.entry) - priorityGroup(b.entry) || b.pathCommitCount - a.pathCommitCount || a.entry.id.localeCompare(b.entry.id));
}

export function planDue(index, { count = 2, now = new Date(), pulls = [], quickState = () => ({ head: null, archived: null, pathCommitCount: 0, lowerBound: false }) } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('--count must be an integer from 1 to 3');
  const entriesWithPr = (index.upstreams ?? []).filter(entry => pulls.some(pull => pullMatchesEntry(pull, entry)));
  const ownersWithPr = new Set(entriesWithPr.flatMap(entry => [...ownerSkills(entry)]));
  const excludedByPr = (index.upstreams ?? []).filter(entry =>
    entriesWithPr.some(open => open.id === entry.id) || [...ownerSkills(entry)].some(owner => ownersWithPr.has(owner))
  ).map(entry => entry.id);
  const candidates = [];
  for (const entry of index.upstreams ?? []) {
    if (excludedByPr.includes(entry.id)) continue;
    const measured = quickState(entry);
    // A defer waits for a person. With no path-scoped commit since its review there is nothing new to judge,
    // and defer sorts ahead of everything but queued, so it would hold a slot every night.
    if (latestVerdict(entry) === 'defer' && measured.pathCommitCount === 0 && !measured.archived) continue;
    candidates.push({ entry, ...measured });
  }
  const ordered = dueOrder(candidates);
  const selected = [];
  const usedOwners = new Set();
  for (const candidate of ordered) {
    const owners = ownerSkills(candidate.entry);
    if ([...owners].some(owner => usedOwners.has(owner))) continue;
    selected.push(candidate);
    for (const owner of owners) usedOwners.add(owner);
    if (selected.length === count) break;
  }
  return {
    recentWarning: recentRunWarning(index.lastRunAt, now),
    openPullRequestCount: pulls.length,
    absorptionAllowed: pulls.length < 2,
    excludedByOpenPullRequest: excludedByPr,
    selected: selected.map(({ entry, ...measure }) => ({ id: entry.id, repo: entry.repo, state: entry.state, ...measure }))
  };
}

function atomicJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

export function recordUpstream(index, id, options, { indexPath = INDEX_FILE, stateDir = join(homedir(), '.jstack', 'state', 'upstream-patrol'), now = new Date() } = {}) {
  const entry = index.upstreams.find(item => item.id === id);
  if (!entry) throw new Error(`Unknown upstream id: ${id}`);
  if (!VERDICTS.has(options.verdict)) throw new Error(`Invalid verdict: ${options.verdict}`);
  if (!options.note?.trim()) throw new Error('--note must not be empty');
  if (options.pin && !HEX40.test(options.pin)) throw new Error('--pin must be a full 40-character SHA');
  if (options.pin) {
    const unpinned = entry.imports.filter(item => item.pin === null);
    const existingPins = new Set(entry.imports.map(item => item.pin).filter(Boolean));
    if (unpinned.length === 1) unpinned[0].pin = options.pin;
    else if (entry.imports.length === 1) entry.imports[0].pin = options.pin;
    else if (existingPins.size === 1) {
      for (const item of entry.imports) if (item.pin) item.pin = options.pin;
    } else {
      throw new Error(`${id} has multiple import pins; edit the intended imports explicitly before recording`);
    }
  }
  const date = now.toISOString();
  const scope = [...new Set(entry.imports.flatMap(item => item.upstreamPaths ?? []))];
  entry.reviews ??= [];
  entry.reviews.push({ date, scope, verdict: options.verdict, note: options.note.trim(), pr: options.pr ?? null });
  entry.lastReviewed = date;
  entry.state = options.verdict;
  index.lastRunAt = date;
  atomicJson(indexPath, index);
  mkdirSync(stateDir, { recursive: true });
  const dateName = date.slice(0, 10);
  const backupPath = join(stateDir, `upstreams-${dateName}.json`);
  copyFileSync(indexPath, backupPath);
  return { indexPath, backupPath, entry };
}

function parseOptions(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!['--verdict', '--note', '--pin', '--pr'].includes(key)) throw new Error(`Unknown option: ${key}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${key} requires a value`);
    result[key.slice(2)] = args[++i];
  }
  return result;
}

function ensureAuth(run) {
  const result = run('gh', ['auth', 'status']);
  commandOutput(result, 'gh', ['auth', 'status']);
}

// A record PR may only append reviews of the shape `record` writes, and move state, lastReviewed, lastRunAt
// and import pins to agree with them. Everything else in the index (exclusions, upstream list, licenses,
// paths, modes) is a person's decision, and a field may not move without a review that explains it.
const REVIEW_KEYS = ['date', 'note', 'pr', 'scope', 'verdict'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isIso = value => typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function diffRecord(base, head, { now = new Date() } = {}) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (key === 'lastRunAt' || key === 'upstreams') continue;
    if (!same(base[key], head[key])) problems.push(`top-level field changed: ${key}`);
  }
  const baseIds = (base.upstreams ?? []).map(item => item.id);
  const headIds = (head.upstreams ?? []).map(item => item.id);
  if (!same(baseIds, headIds)) {
    problems.push('upstream list changed (added, removed, or reordered)');
    return problems;
  }
  const addedDates = [];
  (base.upstreams ?? []).forEach((before, position) => {
    const after = head.upstreams[position];
    const oldReviews = before.reviews ?? [];
    const newReviews = after.reviews ?? [];
    if (newReviews.length < oldReviews.length || !same(newReviews.slice(0, oldReviews.length), oldReviews)) {
      problems.push(`${before.id}: existing reviews were changed or removed`);
      return;
    }
    const fresh = newReviews.slice(oldReviews.length);
    let previous = oldReviews.at(-1)?.date ?? null;
    for (const review of fresh) {
      if (!same(Object.keys(review).sort(), REVIEW_KEYS)) problems.push(`${before.id}: a new review has unexpected fields`);
      if (!VERDICTS.has(review.verdict)) problems.push(`${before.id}: a new review has verdict ${review.verdict}`);
      const floor = [previous, base.lastRunAt].filter(Boolean).map(Date.parse).reduce((a, b) => Math.max(a, b), 0);
      if (!isIso(review.date) || Date.parse(review.date) < floor || Date.parse(review.date) > now.getTime() + CLOCK_SKEW_MS) {
        problems.push(`${before.id}: a new review needs an ISO UTC date that is not earlier than the last record and not in the future`);
      }
      if (typeof review.note !== 'string' || !review.note.trim() || review.note.length > 600) problems.push(`${before.id}: a new review needs a note of 1 to 600 characters`);
      if (!Array.isArray(review.scope) || review.scope.some(item => typeof item !== 'string')) problems.push(`${before.id}: a new review scope must be a list of strings`);
      if (review.pr !== null && typeof review.pr !== 'string') problems.push(`${before.id}: a new review pr must be null or a string`);
      previous = review.date;
      addedDates.push(review.date);
    }
    const last = fresh.at(-1);
    if (after.state !== (last ? last.verdict : before.state)) problems.push(`${before.id}: state must follow the last verdict`);
    if ((after.lastReviewed ?? null) !== (last ? last.date : before.lastReviewed ?? null)) problems.push(`${before.id}: lastReviewed must follow the last review`);
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (['state', 'lastReviewed', 'reviews', 'imports'].includes(field)) continue;
      if (!same(before[field], after[field])) problems.push(`${before.id}: ${field} changed`);
    }
    const a = before.imports ?? [];
    const b = after.imports ?? [];
    if (a.length !== b.length) {
      problems.push(`${before.id}: number of imports changed`);
      return;
    }
    a.forEach((item, at) => {
      for (const name of new Set([...Object.keys(item), ...Object.keys(b[at])])) {
        if (name === 'pin') continue;
        if (!same(item[name], b[at][name])) problems.push(`${before.id}: import ${at} field ${name} changed`);
      }
      if (!same(item.pin, b[at].pin)) {
        const checkable = ['full', 'short7'].includes(item.pinRecordedIn?.form);
        if (last?.verdict !== 'absorb' || typeof b[at].pin !== 'string' || !HEX40.test(b[at].pin) || !checkable) {
          problems.push(`${before.id}: import ${at} pin may move only with a new absorb review, to a full SHA, in a record that check can verify`);
        }
      }
    });
  });
  const expectedRun = addedDates.length ? addedDates.reduce((latest, date) => (Date.parse(date) > Date.parse(latest) ? date : latest)) : base.lastRunAt ?? null;
  if ((head.lastRunAt ?? null) !== expectedRun) problems.push('lastRunAt must equal the latest added review date');
  return problems;
}

function usage() {
  return [
    'Usage:',
    '  node .agents/skills/upstream-patrol/scripts/patrol.mjs check',
    '  node .agents/skills/upstream-patrol/scripts/patrol.mjs verify-record BASE_REF',
    '  node .agents/skills/upstream-patrol/scripts/patrol.mjs measure UPSTREAM_ID',
    '  node .agents/skills/upstream-patrol/scripts/patrol.mjs due [--count 1..3]',
    '  node .agents/skills/upstream-patrol/scripts/patrol.mjs record UPSTREAM_ID --verdict VERDICT --note NOTE [--pin SHA] [--pr URL]'
  ].join('\n');
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const root = dependencies.root ?? resolve(SKILL_ROOT, '..', '..', '..');
  const indexPath = dependencies.indexPath ?? INDEX_FILE;
  try {
    const [command, ...args] = argv;
    if (!command || command === '--help' || command === '-h') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (command !== 'verify-record') ensureAuth(run);
    const index = dependencies.index ?? readIndex(indexPath);
    if (command === 'check') {
      const result = checkIndex(index, { root, run });
      process.stdout.write(`Checked ${JSON.stringify(result.checked)}\n`);
      for (const warning of result.warnings) process.stdout.write(`WARN ${warning}\n`);
      for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`);
      if (!result.errors.length) process.stdout.write('Index check passed.\n');
      return result.errors.length ? 1 : 0;
    }
    if (command === 'measure') {
      if (args.length !== 1) throw new Error('measure requires one upstream id');
      const entry = index.upstreams.find(item => item.id === args[0]);
      if (!entry) throw new Error(`Unknown upstream id: ${args[0]}`);
      process.stdout.write(`${JSON.stringify(measureUpstream(entry, { run }), null, 2)}\n`);
      return 0;
    }
    if (command === 'due') {
      let count = 2;
      if (args.length) {
        if (args.length !== 2 || args[0] !== '--count') throw new Error('due accepts only --count N');
        count = Number(args[1]);
      }
      const pulls = parsePulls(run);
      const due = planDue(index, { count, now: new Date(), pulls, quickState: entry => quickUpstreamState(entry, run) });
      process.stdout.write(`${JSON.stringify(due, null, 2)}\n`);
      if (due.recentWarning) process.stdout.write(`WARN ${due.recentWarning}\n`);
      if (!due.absorptionAllowed) process.stdout.write('WARN Two or more upstream-patrol PRs are open; measure and record only.\n');
      return 0;
    }
    if (command === 'verify-record') {
      if (args.length !== 1) throw new Error('verify-record requires one base ref, for example origin/master');
      const spec = `${args[0]}:.agents/skills/upstream-patrol/upstreams.json`;
      const base = JSON.parse(commandOutput(run('git', ['show', spec], { cwd: root }), 'git', ['show', spec]));
      const problems = diffRecord(base, index);
      for (const problem of problems) process.stderr.write(`ERROR ${problem}\n`);
      if (!problems.length) process.stdout.write('Record diff is limited to reviews, state, dates, and pins.\n');
      return problems.length ? 1 : 0;
    }
    if (command === 'record') {
      if (args.length < 1) throw new Error('record requires an upstream id');
      const id = args[0];
      const parsed = parseOptions(args.slice(1));
      const result = recordUpstream(index, id, parsed, {
        indexPath,
        stateDir: dependencies.stateDir ?? join(homedir(), '.jstack', 'state', 'upstream-patrol'),
        now: dependencies.now ?? new Date()
      });
      process.stdout.write(`Recorded ${id}; backup: ${result.backupPath}\n`);
      return 0;
    }
    process.stderr.write(`${usage()}\n`);
    return 2;
  } catch (error) {
    const category = error.category ?? classifyError(error.message);
    process.stderr.write(`${category}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
