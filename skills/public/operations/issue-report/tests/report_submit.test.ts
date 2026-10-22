import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { atomicWrite, runProcess } from '../../../../../runtime/os.js';
import { DEFAULT_REPO, ensure, headline, readConfig, readQueue, roots } from '../scripts/state.js';
import { AWS_KEY, cleanupGh, cli, drafted, fixture, GH_TOKEN, ghCalls, LONG_FAILURE, plainDraft, spawnCli, stubGh, wholeWordPrefix } from './_report_helpers.js';

after(cleanupGh);
test('draft writes fixed fields and passes the whole draft through redaction', async () => {
  const home = fixture();
  try {
    const { id, draft } = await drafted(home);
    const text = readFileSync(draft, 'utf8');
    for (const heading of ['## Summary', '## Surface', '## Expected behavior', '## Actual behavior', '## Steps to reproduce', '## Evidence excerpt', '## Environment', '## Doctor summary']) assert.ok(text.includes(heading), heading);
    assert.match(text, /The scan lists candidates/); assert.match(text, /\(not provided by the reporter\)/);
    assert.match(text, /- Node: v\d+/); assert.match(text, /- doctor exit code: /);
    assert.equal(text.includes(home), false); assert.equal(text.includes(GH_TOKEN), false);
    const candidate = readQueue(roots(home)).find(c => c.id === id);
    assert.equal(candidate?.status, 'drafted');
    const source = headline(candidate!.excerpt);
    assert.ok(source.length > 160, 'the fixture summary needs shortening');
    wholeWordPrefix(/## Summary\n\n(.*)/.exec(text)![1], source, 160);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('submit refuses without --confirm and sends nothing', async () => {
  const home = fixture();
  try {
    const draft = await plainDraft(home, LONG_FAILURE), bin = stubGh(home, 'ok');
    const before = ghCalls(home).length;
    const refused = spawnCli(home, ['submit', draft, '--json'], bin);
    assert.equal(refused.code, 2); assert.match(refused.err, /Refusing to submit without --confirm/);
    assert.equal(refused.out, '', 'a refusal prints no JSON result, with or without --json');
    assert.equal(ghCalls(home).length, before);
    assert.ok(existsSync(draft));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('missing, unauthenticated or unauthorized gh exits 3 and keeps the draft', async () => {
  const home = fixture();
  try {
    const { id, draft } = await drafted(home), empty = join(home, 'no-gh');
    mkdirSync(empty); assert.equal(readdirSync(empty).length, 0);
    const missing = spawnCli(home, ['submit', id, '--confirm'], empty);
    assert.equal(missing.code, 3); assert.ok(missing.out.includes(draft)); assert.ok(existsSync(draft));
    for (const mode of ['unauth', 'noaccess'] as const) {
      const r = await cli(home, ['submit', draft, '--confirm'], stubGh(home, mode));
      assert.equal(r.code, 3, mode); assert.ok(r.out.includes(draft)); assert.ok(existsSync(draft));
      assert.equal(ghCalls(home).some(args => args[1] === 'create'), false);
    }
    assert.deepEqual(ghCalls(home).map(args => args[0]), ['--version', 'auth', '--version', 'auth', 'repo'], 'each mode stops at its own gh check');
    assert.equal(readQueue(roots(home)).find(c => c.id === id)?.status, 'drafted');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('confirmed submission stops on a matching open issue unless --new, then records a receipt', async () => {
  const home = fixture();
  try {
    const { id, draft } = await drafted(home);
    const duplicate = await cli(home, ['submit', draft, '--confirm'], stubGh(home, 'duplicate'));
    assert.equal(duplicate.code, 4); assert.match(duplicate.out, /issues\/7/);
    assert.equal(ghCalls(home).some(args => args[1] === 'create'), false);
    const created = await cli(home, ['submit', draft, '--confirm', '--new', '--json'], stubGh(home, 'duplicate'));
    assert.equal(created.code, 0, created.err);
    assert.equal(JSON.parse(created.out).repo, DEFAULT_REPO); assert.deepEqual(JSON.parse(created.out).warnings, [], 'the default target has no warning');
    const create = ghCalls(home).find(args => args[1] === 'create')!;
    assert.deepEqual(create.slice(create.indexOf('--body-file'), create.indexOf('--body-file') + 2), ['--body-file', draft]);
    assert.ok(create.includes('bug') && create.includes('from-report'));
    const title = create[create.indexOf('--title') + 1], prefix = '[report] jst report: ';
    assert.ok(title.startsWith(prefix), title);
    wholeWordPrefix(title.slice(prefix.length), /## Summary\n\n(.*)/.exec(readFileSync(draft, 'utf8'))![1], 100);
    const r = roots(home), receipts = readFileSync(join(r.reports, 'receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(receipts.length, 1); assert.equal(receipts[0].id, id); assert.equal(receipts[0].url, 'https://example.invalid/issues/8');
    assert.equal(readQueue(r).find(c => c.id === id)?.status, 'submitted');
    assert.notEqual(readConfig(r).lastRetro, null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('submission re-redacts an edited draft and refuses until it is reviewed again', async () => {
  const home = fixture();
  try {
    const draft = await plainDraft(home, LONG_FAILURE), bin = stubGh(home, 'ok');
    writeFileSync(draft, readFileSync(draft, 'utf8') + `\nadded ${AWS_KEY}\n`);
    // Every error also exits 1, so the result itself must say that the draft changed.
    const changed = await cli(home, ['submit', draft, '--confirm', '--json'], bin);
    assert.equal(changed.code, 1); assert.equal(JSON.parse(changed.out || '{}').status, 'changed', changed.err);
    assert.equal(readFileSync(draft, 'utf8').includes(AWS_KEY), false);
    assert.equal(ghCalls(home).length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('an edited draft that is no longer private is refused without a rewrite or a gh call', async () => {
  const home = fixture();
  try {
    const draft = await plainDraft(home, LONG_FAILURE), bin = stubGh(home, 'ok');
    writeFileSync(draft, readFileSync(draft, 'utf8') + `\nadded ${AWS_KEY}\n`);
    // POSIX checks the mode and Windows the owner and ACL; a draft made with chmod alone fails the Windows check.
    if (process.platform === 'win32') assert.equal(runProcess('icacls.exe', [draft, '/grant', '*S-1-1-0:R']).status, 0);
    else chmodSync(draft, 0o644);
    const refused = await cli(home, ['submit', draft, '--confirm', '--json'], bin);
    assert.equal(refused.code, 1); assert.equal(refused.out, ''); assert.match(refused.err, /private state/);
    assert.equal(readFileSync(draft, 'utf8').includes(AWS_KEY), true); assert.equal(ghCalls(home).length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a non-default repository is warned about; --repo targets one submission and is never saved', async () => {
  const home = fixture();
  try {
    const r = roots(home), config = join(r.reports, 'config.json');
    assert.doesNotMatch((await cli(home, ['status'])).out, /WARNING/);
    const draft = await plainDraft(home, 'scan stopped before it listed any candidate');
    const sent = await cli(home, ['submit', draft, '--confirm', '--repo', 'other/target', '--json'], stubGh(home, 'ok'));
    assert.equal(sent.code, 0, sent.err);
    const result = JSON.parse(sent.out);
    assert.equal(result.repo, 'other/target', 'the JSON result names the target');
    assert.deepEqual(result.warnings, [sent.err.trim()], 'the JSON result carries the warning that went to stderr');
    assert.match(sent.err, /WARNING: .*other\/target.*not the default ysys143\/jstack/);
    for (const step of ['view', 'list', 'create']) assert.ok(ghCalls(home).find(args => args[1] === step)?.includes('other/target'), `gh ${step} uses --repo`);
    const saved = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(saved.repo, DEFAULT_REPO, '--repo is never saved');
    assert.equal(typeof saved.lastRetro, 'string', 'the submission still records the retrospective');

    atomicWrite(config, Buffer.from(JSON.stringify({ repo: 'someone/else', lastRetro: null })));
    assert.match((await cli(home, ['status'])).out, /Repository: someone\/else\nWARNING: .*someone\/else.*not the default ysys143\/jstack.*config\.json/);
    const status = JSON.parse((await cli(home, ['status', '--json'])).out);
    assert.equal(status.repo, 'someone/else'); assert.equal(status.defaultRepo, DEFAULT_REPO); assert.equal(status.warnings.length, 1);
    const before = ghCalls(home).length;
    const refused = await cli(home, ['submit', draft], stubGh(home, 'ok'));
    assert.equal(refused.code, 2); assert.match(refused.err, /WARNING: .*someone\/else/); assert.match(refused.err, /Nothing was sent\. Target: someone\/else\./);
    assert.equal((await cli(home, ['submit', draft, '--confirm', '--repo', 'notarepo'], stubGh(home, 'ok'))).code, 2);
    assert.equal((await cli(home, ['status', '--repo', 'a/b'])).code, 2, '--repo belongs to submit only');
    assert.equal(ghCalls(home).length, before, 'refusals and usage errors send nothing');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a configured repository that is not a valid slug is named, never replaced silently, and submit refuses it', async () => {
  const home = fixture();
  try {
    const r = roots(home), config = join(r.reports, 'config.json'); ensure(r);
    for (const repo of ['myorg/private-reports.git', 'my-org-/reports', 'https://github.com/a/b', 5, ['a/b']]) {
      atomicWrite(config, Buffer.from(JSON.stringify({ repo, lastRetro: null })));
      assert.deepEqual(readConfig(r), { repo: DEFAULT_REPO, lastRetro: null, rejectedRepo: typeof repo === 'string' ? repo : JSON.stringify(repo) }, JSON.stringify(repo));
    }
    for (const repo of [undefined, null, 'owner/repo']) { atomicWrite(config, Buffer.from(JSON.stringify({ repo, lastRetro: null }))); assert.equal('rejectedRepo' in readConfig(r), false, `${repo}`); }
    atomicWrite(config, Buffer.from(JSON.stringify({ repo: 'myorg/private-reports.git', lastRetro: null })));
    assert.equal((await cli(home, ['finish'])).code, 0);
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).repo, 'myorg/private-reports.git', 'a later write keeps the value the user configured');
    const status = await cli(home, ['status']);
    assert.match(status.out, /^Repository: ysys143\/jstack\nWARNING: repo "myorg\/private-reports\.git" in .*config\.json is not a valid OWNER\/NAME; submit refuses until it is fixed there or --repo OWNER\/NAME is given\./);

    const draft = await plainDraft(home, 'scan stopped before it listed any candidate'), bin = stubGh(home, 'ok');
    for (const args of [['submit', draft, '--confirm'], ['submit', draft]]) {
      const refused = await cli(home, args, bin);
      assert.equal(refused.code, 2, args.join(' ')); assert.match(refused.err, /WARNING: repo "myorg\/private-reports\.git"/); assert.match(refused.err, /Nothing was sent\./);
    }
    assert.equal(ghCalls(home).length, 0, 'a refused submission reaches no gh call'); assert.ok(existsSync(draft));
    const explicit = await cli(home, ['submit', draft, '--confirm', '--repo', 'other/target', '--json'], bin), result = JSON.parse(explicit.out);
    assert.equal(explicit.code, 0, explicit.err); assert.equal(result.repo, 'other/target');
    assert.equal(result.warnings.length, 2, 'the rejected value is named beside the --repo warning');
    assert.match(result.warnings[1], /repo "myorg\/private-reports\.git" in .*config\.json is not a valid OWNER\/NAME; it is ignored for this submission\./);
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).repo, 'myorg/private-reports.git', 'a submission keeps the configured value too');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
