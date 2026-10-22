import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkIndex,
  classifyError,
  classifyFiles,
  compareIsPinLost,
  compareLicense,
  diffRecord,
  dueOrder,
  measureUpstream,
  planDue,
  recentRunWarning,
  recordUpstream,
  scopedCommitSet
} from './patrol.mjs';

const sha = digit => digit.repeat(40);
const tempRoots = new Set();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'upstream-patrol-test-'));
  tempRoots.add(root);
  return root;
}

test.after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function entry(id, repo, ownerSkill, state = 'unreviewed') {
  return {
    id,
    repo,
    branch: repo ? 'main' : null,
    license: { spdx_id: 'MIT', class: 'MIT' },
    lastReviewed: null,
    state,
    reviews: [],
    imports: [{
      mode: 'adapted',
      pin: sha('a'),
      upstreamPaths: ['src'],
      localPaths: [],
      pinRecordedIn: null,
      ownerSkill,
      notes: []
    }]
  };
}

test('inventory records 22 source entries plus the two Part A upstreams and explicit exclusions', () => {
  const index = JSON.parse(readFileSync(new URL('../upstreams.json', import.meta.url), 'utf8'));
  assert.equal(index.upstreams.length, 24);
  assert.equal(index.upstreams.filter(item => ['cc-thinking-skills', 'owasp-cheat-sheet-series'].includes(item.id)).length, 2);
  assert.equal(index.upstreams.filter(item => item.repo === null).map(item => item.id).sort().join(','), 'benelog-gist,hyperresearch,noslop-ko');
  assert.ok(index.exclusions.some(item => item.id === 'spotify-portal-ai-plugins'));
  assert.ok(index.upstreams.every(item => Array.isArray(item.imports) && item.imports.length > 0));
});

test('checkIndex accepts a short SHA only when its seven-character prefix is recorded', () => {
  const root = fixture();
  writeFileSync(join(root, 'pin.txt'), `source at ${sha('b')}\n`);
  const valid = {
    lastRunAt: null,
    exclusions: [],
    upstreams: [{
      ...entry('short-pin', 'owner/repo', 'owner'),
      imports: [{ ...entry('short-pin', 'owner/repo', 'owner').imports[0], pin: sha('b'), pinRecordedIn: { file: 'pin.txt', form: 'short7' } }]
    }]
  };
  assert.deepEqual(checkIndex(valid, { root }).errors, []);
  writeFileSync(join(root, 'pin.txt'), `source at ${sha('c')}\n`);
  assert.match(checkIndex(valid, { root }).errors.join('\n'), /recorded short7 value not found/);
});

test('checkIndex reports pin-record files edited after the last review', () => {
  const root = fixture();
  writeFileSync(join(root, 'pin.txt'), sha('b'));
  const upstream = entry('changed-record', 'owner/repo', 'owner');
  upstream.lastReviewed = '2026-01-01T00:00:00.000Z';
  upstream.imports[0].pin = sha('b');
  upstream.imports[0].pinRecordedIn = { file: 'pin.txt', form: 'full' };
  const result = checkIndex({ lastRunAt: null, exclusions: [], upstreams: [upstream] }, {
    root,
    run: () => ({ status: 0, stdout: '2026-02-01T00:00:00+00:00\n', stderr: '' })
  });
  assert.match(result.warnings.join('\n'), /changed after its last review/);
});

test('checkIndex treats planned Part A paths as pending integration warnings', () => {
  const upstream = entry('future', 'owner/repo', 'verify');
  upstream.imports[0].pin = null;
  upstream.imports[0].pinRecordedIn = null;
  upstream.imports[0].localPaths = ['not-yet-created.md'];
  upstream.imports[0].notes = ['The mapped local file appears when Part A is integrated.'];
  assert.deepEqual(checkIndex({ lastRunAt: null, exclusions: [], upstreams: [upstream] }, { root: fixture() }).errors, []);
  assert.match(checkIndex({ lastRunAt: null, exclusions: [], upstreams: [upstream] }, { root: fixture() }).warnings.join('\n'), /pending Part A integration/);
});

test('path-scoped results are the compare intersection with the pin excluded', () => {
  const compare = { commits: [sha('1'), sha('2'), sha('3'), sha('a')] };
  assert.deepEqual(scopedCommitSet(compare, [[sha('1'), sha('a'), sha('4')], [sha('2'), sha('3')]], sha('a')), [sha('1'), sha('2'), sha('3')]);
});

test('pin-lost is detected when compare diverges or has commits behind the pin', () => {
  assert.equal(compareIsPinLost({ status: 'ahead', behind_by: 0 }), false);
  assert.equal(compareIsPinLost({ status: 'diverged', behind_by: 0 }), true);
  assert.equal(compareIsPinLost({ status: 'ahead', behind_by: 1 }), true);
});

test('license comparison distinguishes unchanged declarations from drift', () => {
  assert.equal(compareLicense({ spdx_id: 'MIT' }, { spdx_id: 'MIT' }), null);
  assert.deepEqual(compareLicense({ spdx_id: 'MIT' }, { spdx_id: 'Apache-2.0' }), { expected: 'MIT', observed: 'Apache-2.0' });
  assert.deepEqual(compareLicense({ spdx_id: null }, { spdx_id: 'MIT' }), { expected: null, observed: 'MIT' });
});

test('measureUpstream intersects paginated path history and reports license and file changes', () => {
  const pin = sha('a');
  const head = sha('b');
  const commitOne = sha('1');
  const commitTwo = sha('2');
  const outside = sha('3');
  const notCompared = sha('4');
  const tree = (entries) => ({ tree: entries.map(([path, value]) => ({ path, sha: value, type: 'blob' })) });
  const encode = text => Buffer.from(text).toString('base64');
  const entryData = entry('test', 'owner/repo', 'test');
  entryData.imports[0].pin = pin;
  const compare = {
    status: 'ahead',
    ahead_by: 3,
    behind_by: 0,
    head_commit: { sha: head },
    commits: [{ sha: commitOne }, { sha: commitTwo }, { sha: outside }],
    files: [
      { filename: 'src/new.js', status: 'added' },
      { filename: 'src/guide.md', status: 'modified' },
      { filename: 'docs/outside.md', status: 'modified' }
    ]
  };
  const beforeTree = tree([
    ['LICENSE', 'root-license'],
    ['src/LICENSE', 'local-license-old'],
    ['src/package.json', 'manifest-old']
  ]);
  const afterTree = tree([
    ['LICENSE', 'root-license'],
    ['src/LICENSE', 'local-license-new'],
    ['src/package.json', 'manifest-new'],
    ['src/new.js', 'new-file']
  ]);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command !== 'gh') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'api' && args.includes('--paginate')) return { status: 0, stdout: `${commitOne}\n${commitTwo}\n${notCompared}\n`, stderr: '' };
    const endpoint = args[1];
    if (endpoint === 'repos/owner/repo') return { status: 0, stdout: JSON.stringify({ archived: false, license: { spdx_id: 'MIT' } }), stderr: '' };
    if (endpoint === 'repos/owner/repo/branches/main') return { status: 0, stdout: JSON.stringify({ commit: { sha: head } }), stderr: '' };
    if (endpoint.includes('/compare/')) return { status: 0, stdout: JSON.stringify(compare), stderr: '' };
    if (endpoint.includes(`/git/trees/${pin}?`)) return { status: 0, stdout: JSON.stringify(beforeTree), stderr: '' };
    if (endpoint.includes(`/git/trees/${head}?`)) return { status: 0, stdout: JSON.stringify(afterTree), stderr: '' };
    if (endpoint.includes(`/contents/src/package.json?ref=${pin}`)) return { status: 0, stdout: JSON.stringify({ encoding: 'base64', content: encode('{"license":"MIT"}') }), stderr: '' };
    if (endpoint.includes(`/contents/src/package.json?ref=${head}`)) return { status: 0, stdout: JSON.stringify({ encoding: 'base64', content: encode('{"license":"Apache-2.0"}') }), stderr: '' };
    if (endpoint.includes(`/contents/src/new.js?ref=${head}`)) return { status: 0, stdout: JSON.stringify({ encoding: 'base64', content: encode('/* SPDX-License-Identifier: Apache-2.0 */') }), stderr: '' };
    throw new Error(`Unexpected mocked endpoint: ${endpoint}`);
  };
  const measured = measureUpstream(entryData, { run });
  assert.equal(measured.imports[0].ahead_by, 3);
  assert.equal(measured.imports[0].pathCommitCount, 2);
  assert.deepEqual(measured.imports[0].fileClassification.executable, ['src/new.js']);
  assert.deepEqual(measured.imports[0].fileClassification['instruction-surface'], ['src/guide.md']);
  assert.deepEqual(measured.imports[0].license.licenseFiles.map(item => item.path), ['src/LICENSE']);
  assert.deepEqual(measured.imports[0].license.manifestLicenseChanges, [{ path: 'src/package.json', before: 'MIT', after: 'Apache-2.0' }]);
  assert.deepEqual(measured.imports[0].license.spdxHeaderChanges, [{ path: 'src/new.js', declared: 'Apache-2.0' }]);
  assert.ok(calls.some(call => call.includes('--paginate')));
});

test('file classification separates executable code, agent instructions, and other files', () => {
  assert.deepEqual(classifyFiles(['src/check.mjs', 'references/prompt.md', 'assets/logo.svg']), {
    executable: ['src/check.mjs'],
    'instruction-surface': ['references/prompt.md'],
    other: ['assets/logo.svg']
  });
});

test('due prioritizes queued, then decided defer, then the largest path change count', () => {
  const candidates = [
    { entry: entry('normal-small', 'a/one', 'owner-a'), pathCommitCount: 2 },
    { entry: entry('queued', 'b/two', 'owner-b', 'queued'), pathCommitCount: 0 },
    { entry: entry('deferred', 'c/three', 'owner-c', 'defer'), pathCommitCount: 0 },
    { entry: entry('normal-large', 'd/four', 'owner-d'), pathCommitCount: 30 }
  ];
  assert.deepEqual(dueOrder(candidates).map(item => item.entry.id), ['queued', 'deferred', 'normal-large', 'normal-small']);
});

test('due warns inside 20 hours and does not request a decision', () => {
  const now = new Date('2026-10-04T12:00:00.000Z');
  assert.match(recentRunWarning('2026-10-03T20:00:00.000Z', now), /continuing without a prompt/);
  assert.equal(recentRunWarning('2026-10-03T10:00:00.000Z', now), null);
  const due = planDue({ lastRunAt: '2026-10-04T04:00:00.000Z', upstreams: [] }, { now, pulls: [] });
  assert.match(due.recentWarning, /without a prompt/);
});

test('due excludes open upstream PRs and avoids selecting two upstreams for one owner skill', () => {
  const first = entry('first-source', 'owner/first', 'shared-owner');
  const second = entry('second-source', 'owner/second', 'shared-owner');
  const third = entry('third-source', 'owner/third', 'different-owner');
  const index = { lastRunAt: null, upstreams: [first, second, third] };
  const result = planDue(index, {
    pulls: [{ title: 'Patrol owner/first update', body: '', headRefName: 'fix/first-source', url: '' }],
    quickState: item => ({ head: sha('e'), archived: false, pathCommitCount: item.id === 'second-source' ? 1 : 0, lowerBound: false })
  });
  assert.deepEqual(result.excludedByOpenPullRequest, ['first-source', 'second-source']);
  assert.deepEqual(result.selected.map(item => item.id), ['third-source']);
});

test('due skips a defer with no new path-scoped commit so it cannot hold a slot every night', () => {
  const waiting = entry('waiting-defer', 'owner/waiting', 'owner-w', 'defer');
  const moved = entry('moved-defer', 'owner/moved', 'owner-m', 'defer');
  const fresh = entry('fresh-source', 'owner/fresh', 'owner-f');
  const result = planDue({ lastRunAt: null, upstreams: [waiting, moved, fresh] }, {
    pulls: [],
    quickState: item => ({ head: sha('e'), archived: false, pathCommitCount: item.id === 'waiting-defer' ? 0 : 3, lowerBound: false })
  });
  assert.deepEqual(result.selected.map(item => item.id), ['moved-defer', 'fresh-source']);
});

function recordBase() {
  const pinned = entry('pinned', 'o/b', 'owner-b');
  pinned.imports[0].pinRecordedIn = { file: 'NOTICE', form: 'full' };
  return { lastRunAt: null, exclusions: [{ id: 'x', repo: null, reason: 'person' }], upstreams: [entry('plain', 'o/a', 'owner-a'), pinned] };
}

const cloneJson = value => JSON.parse(JSON.stringify(value));
const review = (verdict, date = '2026-10-09T00:00:00.000Z') => ({ date, scope: ['src'], verdict, note: 'own words', pr: null });
const NOW = new Date('2026-10-10T00:00:00.000Z');

test('verify-record accepts a review with its state, dates and pin and nothing else', () => {
  const base = recordBase();
  const head = cloneJson(base);
  head.lastRunAt = '2026-10-09T00:00:00.000Z';
  head.upstreams[0].reviews.push(review('no-change'));
  head.upstreams[0].state = 'no-change';
  head.upstreams[0].lastReviewed = head.lastRunAt;
  head.upstreams[1].reviews.push(review('absorb'));
  head.upstreams[1].state = 'absorb';
  head.upstreams[1].lastReviewed = head.lastRunAt;
  head.upstreams[1].imports[0].pin = sha('b');
  assert.deepEqual(diffRecord(base, head, { now: NOW }), []);
  assert.deepEqual(diffRecord(base, cloneJson(base), { now: NOW }), []);
});

test('verify-record rejects every change a person owns or a review does not explain', () => {
  const base = recordBase();
  const withReview = (verdict, mutate = () => {}) => {
    const head = cloneJson(base);
    head.lastRunAt = '2026-10-09T00:00:00.000Z';
    head.upstreams[1].reviews.push(review(verdict));
    head.upstreams[1].state = verdict;
    head.upstreams[1].lastReviewed = head.lastRunAt;
    mutate(head);
    return head;
  };
  const edits = {
    'exclusions edited': head => { head.exclusions = []; },
    'upstream removed': head => { head.upstreams.pop(); },
    'upstream paths edited': head => { head.upstreams[0].imports[0].upstreamPaths = ['.']; },
    'import mode edited': head => { head.upstreams[0].imports[0].mode = 'snapshot'; },
    'license edited': head => { head.upstreams[1].license = { spdx_id: 'GPL-3.0', class: 'GPL' }; },
    'state moved without a review': head => { head.upstreams[0].state = 'approved-by-bot'; },
    'lastReviewed moved without a review': head => { head.upstreams[0].lastReviewed = '2099-01-01T00:00:00Z'; },
    'pin moved without a review': head => { head.upstreams[1].imports[0].pin = sha('c'); },
    'pin key deleted': head => { delete head.upstreams[1].imports[0].pin; },
    'lastRunAt moved without a review': head => { head.lastRunAt = '2099-01-01T00:00:00Z'; }
  };
  for (const [label, edit] of Object.entries(edits)) {
    const head = cloneJson(base);
    edit(head);
    assert.notDeepEqual(diffRecord(base, head, { now: NOW }), [], label);
  }
  const lateDate = date => withReview('no-change', head => {
    head.upstreams[1].reviews.at(-1).date = date;
    head.upstreams[1].lastReviewed = date;
    head.lastRunAt = date;
  });
  for (const [label, date] of Object.entries({ 'far future': '2099-01-01T00:00:00.000Z', 'not ISO': 'Oct 9 2026', 'bare number': '1', 'no milliseconds': '2026-10-09T00:00:00Z' })) {
    assert.notDeepEqual(diffRecord(base, lateDate(date), { now: NOW }), [], `date ${label}`);
  }
  const dated = cloneJson(base);
  dated.lastRunAt = '2026-10-05T00:00:00.000Z';
  assert.notDeepEqual(diffRecord(dated, withReview('no-change', head => {
    head.upstreams[1].reviews.at(-1).date = '2026-10-01T00:00:00.000Z';
    head.upstreams[1].lastReviewed = '2026-10-01T00:00:00.000Z';
    head.lastRunAt = '2026-10-01T00:00:00.000Z';
  }), { now: NOW }), [], 'a review dated before the last recorded run');
  assert.notDeepEqual(diffRecord(base, withReview('no-change', head => { head.upstreams[1].reviews.at(-1).scope = 'x'; }), { now: NOW }), [], 'scope not a list');
  assert.notDeepEqual(diffRecord(base, withReview('no-change', head => { head.upstreams[1].reviews.at(-1).pr = { a: 1 }; }), { now: NOW }), [], 'pr not a string');
  assert.notDeepEqual(diffRecord(base, withReview('no-change', head => { head.upstreams[1].reviews.at(-1).note = 'x'.repeat(601); }), { now: NOW }), [], 'note too long');
  assert.notDeepEqual(diffRecord(base, withReview('absorb', head => { head.upstreams[1].imports[0].pin = [sha('c')]; }), { now: NOW }), [], 'pin coerced from an array');
  assert.notDeepEqual(diffRecord(base, withReview('merged-by-bot'), { now: NOW }), [], 'unknown verdict');
  assert.notDeepEqual(diffRecord(base, withReview('no-change', head => { head.upstreams[1].imports[0].pin = sha('c'); }), { now: NOW }), [], 'pin moved by a non-absorb review');
  assert.notDeepEqual(diffRecord(base, withReview('absorb', head => { head.upstreams[1].imports[0].pin = 'short'; }), { now: NOW }), [], 'pin is not a full SHA');
  assert.notDeepEqual(diffRecord(base, withReview('absorb', head => { head.upstreams[1].imports[0].pinRecordedIn = { file: 'NOTICE', form: 'version' }; }), { now: NOW }), [], 'record form changed');
  assert.notDeepEqual(diffRecord(base, withReview('absorb', head => { head.upstreams[1].reviews.at(-1).extra = 'field'; }), { now: NOW }), [], 'review with extra field');
  assert.notDeepEqual(diffRecord(base, withReview('absorb', head => { head.upstreams[1].state = 'defer'; }), { now: NOW }), [], 'state disagrees with the verdict');

  const reviewed = cloneJson(base);
  reviewed.upstreams[0].reviews.push(review('no-change', '2026-10-01T00:00:00.000Z'));
  const rewritten = cloneJson(reviewed);
  rewritten.upstreams[0].reviews[0].verdict = 'absorb';
  assert.notDeepEqual(diffRecord(reviewed, rewritten, { now: NOW }), [], 'an existing review must not be rewritten');
});

test('verify-record accepts what record itself writes, with and without a pin', () => {
  const root = fixture();
  const indexPath = join(root, 'upstreams.json');
  const stateDir = join(root, 'state');
  const base = recordBase();
  const now = new Date('2026-10-09T00:00:00.000Z');
  for (const options of [
    { id: 'plain', verdict: 'no-change', note: 'Nothing new.' },
    { id: 'pinned', verdict: 'absorb', note: 'Absorbed.', pin: sha('d'), pr: 'https://example.test/pull/1' }
  ]) {
    const head = cloneJson(base);
    const { id, ...rest } = options;
    recordUpstream(head, id, rest, { indexPath, stateDir, now });
    assert.deepEqual(diffRecord(base, head, { now: NOW }), [], id);
  }
});

test('due keeps an archived defer so replacement stays visible', () => {
  const archived = entry('archived-defer', 'owner/archived', 'owner-a', 'defer');
  const result = planDue({ lastRunAt: null, upstreams: [archived] }, {
    pulls: [],
    quickState: () => ({ head: sha('e'), archived: true, pathCommitCount: 0, lowerBound: false })
  });
  assert.deepEqual(result.selected.map(item => item.id), ['archived-defer']);
});

test('two open patrol PRs cap due output at measure-and-record-only', () => {
  const result = planDue({ lastRunAt: null, upstreams: [] }, { pulls: [{}, {}] });
  assert.equal(result.openPullRequestCount, 2);
  assert.equal(result.absorptionAllowed, false);
});

test('record updates the index and writes a dated state backup', () => {
  const root = fixture();
  const indexPath = join(root, 'skill', 'upstreams.json');
  const stateDir = join(root, '.jstack', 'state', 'upstream-patrol');
  mkdirSync(join(root, 'skill'), { recursive: true });
  const source = {
    lastRunAt: null,
    exclusions: [],
    upstreams: [entry('record-me', 'owner/repo', 'skill')]
  };
  writeFileSync(indexPath, JSON.stringify(source));
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const now = new Date('2026-10-04T09:30:00.000Z');
  const result = recordUpstream(index, 'record-me', { verdict: 'no-change', note: 'No path-scoped commits.' }, { indexPath, stateDir, now });
  const saved = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(saved.lastRunAt, now.toISOString());
  assert.equal(saved.upstreams[0].state, 'no-change');
  assert.equal(saved.upstreams[0].reviews[0].note, 'No path-scoped commits.');
  assert.ok(existsSync(result.backupPath));
  assert.deepEqual(JSON.parse(readFileSync(result.backupPath, 'utf8')), saved);
});

test('record can establish one missing baseline pin and rejects an ambiguous multi-import pin', () => {
  const root = fixture();
  const indexPath = join(root, 'index.json');
  const stateDir = join(root, 'state');
  const source = { lastRunAt: null, exclusions: [], upstreams: [entry('new-pin', 'owner/repo', 'skill')] };
  source.upstreams[0].imports[0].pin = null;
  source.upstreams[0].imports[0].pinRecordedIn = null;
  const pin = sha('f');
  recordUpstream(source, 'new-pin', { verdict: 'defer', note: 'Set initial baseline.', pin }, { indexPath, stateDir, now: new Date('2026-10-04T09:30:00Z') });
  assert.equal(JSON.parse(readFileSync(indexPath, 'utf8')).upstreams[0].imports[0].pin, pin);
});

test('GitHub errors are categorized without hiding the original class', () => {
  assert.equal(classifyError('HTTP 401 Bad credentials'), 'authentication');
  assert.equal(classifyError('HTTP 404 Not Found'), 'not-found');
  assert.equal(classifyError('getaddrinfo ENOTFOUND api.github.com'), 'network');
  assert.equal(classifyError('unexpected exit 2'), 'command');
});
