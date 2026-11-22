/** Typed evidence needs: real CLI behavior through coverage_matrix --needs, with isolated task state and temp files. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../../../../runtime/os.js';
import { capture, context, load } from '../../../../../runtime/task_state.js';
import { main } from '../scripts/coverage_matrix.js';
import { LIMITS, check_evidence, fileBindings, formatDecimal, parseDecimal, requirementSha } from '../scripts/evidence_needs.js';

const COVERAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'coverage_matrix.js');
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const ROWS = [['INC-1', 'database failover'], ['INC-2', 'cache outage'], ['INC-12', 'queue stall']] as const;

async function cli(args: string[]): Promise<{ code: number; out: string; json: any }> {
  const lines: string[] = [], log = console.log, error = console.error; let code: number;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
  try { code = await main(args); } catch (e) { code = 2; lines.push(String(e)); } finally { console.log = log; console.error = error; }
  const out = lines.join('\n'); let json: any; try { json = JSON.parse(out); } catch { json = undefined; }
  return { code, out, json };
}

/** One task with two research requirements, a source log, a body report with a sources section, and a valid manifest. */
function fixture(t: any, costs = [3000, 5500, 1200]) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-evidence-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'work'); mkdirSync(root);
  const c = context(root, home);
  const source = { role: 'user' as const, message: 'turn-1', quote: 'List every incident and total the cost' };
  capture(c, { id: 'inc', expectedRevision: 0, source, purpose: 'Report October incidents', authorized: ['analyze'],
    requirements: [{ id: 'INCIDENTS', text: 'List every October incident', kind: 'research' }, { id: 'COST', text: 'Total the October incident cost', kind: 'research' }] });
  const put = (name: string, body: string): string => { writeFileSync(join(root, name), body); return join(root, name); };
  const log = (rows = costs): string => ROWS.map(([id, what], i) => `${id} ${what} cost ${rows[i]} won on 2026-10-0${i + 1}\n`).join('') + 'NOTE rows above are the October incidents\n';
  put('incidents.log', log());
  const total = costs.reduce((a, b) => a + b, 0);
  const report = (extra: { total?: string; costRows?: string[]; sources?: string } = {}): string =>
    `## 요약\n\nINCIDENTS 10월 장애 목록\n${ROWS.map(([id, what]) => `- ${id} ${what}`).join('\n')}\n개수 3건\n\nCOST 장애 비용:\n${(extra.costRows ?? ROWS.map(([id], i) => `- ${id} ${costs[i]!.toLocaleString('en-US')}`)).join('\n')}\n합계 ${extra.total ?? total.toLocaleString('en-US')} [1]\n\n## 출처\n\n${extra.sources ?? '[1] 장애 로그 — https://example.org/incidents'}\n`;
  put('report.md', report());
  const quote = (i: number): string => `${ROWS[i]![0]} ${ROWS[i]![1]}`;
  const base = (): any => ({
    schema: 'jstack-evidence-needs/1', task: 'inc', workspace: c.workspace, constraintsRevision: 0,
    sources: { S1: { path: 'incidents.log', sha256: sha(readFileSync(join(root, 'incidents.log'))) } },
    needs: [
      { id: 'N1', type: 'enumerate', requirement: 'INCIDENTS', requirementRevision: 1, subquestion: 'SQ1', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: quote(i) })) },
      { id: 'N2', type: 'count', requirement: 'INCIDENTS', requirementRevision: 1, claimed: '3', reportPrefix: '개수', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: quote(i) })) },
      { id: 'N3', type: 'compute', operation: 'sum', requirement: 'COST', requirementRevision: 1, claimed: String(total), reportPrefix: '합계', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: `${quote(i)} cost ${costs[i]}`, value: String(costs[i]) })) },
    ],
  });
  const needsPath = join(root, 'needs.json');
  const run = (edit: (m: any) => void = () => {}, extra: string[] = [], format = 'json') => {
    const m = base(); edit(m); writeFileSync(needsPath, JSON.stringify(m));
    return cli(['--needs', needsPath, '--task', 'inc', '--workspace', root, '--home', home, '--report', join(root, 'report.md'), '--format', format, ...extra]);
  };
  const revise = (input: any) => capture(c, { id: 'inc', expectedRevision: load(c, 'inc').revision, source, ...input });
  return { home, root, c, put, log, report, run, revise, needsPath, base };
}
const kinds = (result: { json: any }): string[] => result.json.evidence.findings.map((f: any) => f.kind);

test('a valid exhaustive set, count and sum pass mechanically and say what that does not prove', async t => {
  const f = fixture(t); const r = await f.run();
  assert.equal(r.code, 0, r.out); assert.equal(r.json.evidence.mechanicalResult, 'consistent');
  assert.deepEqual(r.json.evidence.needs.map((n: any) => [n.id, n.status]), [['N1', 'consistent'], ['N2', 'consistent'], ['N3', 'consistent']]);
  assert.equal(r.json.evidence.needs[2].computed, '9700'); assert.equal(r.json.evidence.needs[0].boundaryItems, 3);
  assert.match(r.json.evidence.scope, /does not show that the source is the whole population/);
  assert.equal(r.json.evidence.review.length, 9); assert.equal(r.json.evidence.identity.task, 'inc');
  const text = await f.run(() => {}, [], 'text');
  assert.equal(text.code, 0); assert.match(text.out, /mechanical result: consistent/); assert.match(text.out, /does not show that the source is the whole population/);
});
test('omitted, duplicate, unknown and miscounted items each fail with their own finding', async t => {
  const f = fixture(t);
  assert.ok(kinds(await f.run(m => { m.needs[0].items.pop(); })).includes('OMITTED'));
  const dupe = await f.run(m => { m.needs[0].items.push({ ...m.needs[0].items[1] }); });
  assert.ok(kinds(dupe).includes('DUPLICATE_ITEM')); assert.equal(dupe.code, 1);
  const unknown = await f.run(m => { m.needs[0].items[2] = { id: 'INC-99', source: 'S1', quote: 'INC-99 queue stall' }; });
  assert.ok(kinds(unknown).includes('UNKNOWN_ITEM') && kinds(unknown).includes('QUOTE_NOT_SUPPORTED') && kinds(unknown).includes('OMITTED'));
  const count = await f.run(m => { m.needs[1].claimed = '4'; });
  assert.ok(kinds(count).includes('COUNT_MISMATCH')); assert.equal(count.code, 1);
  assert.ok(kinds(await f.run(m => { delete m.needs[1].claimed; })).includes('CLAIM_MISSING'));
});
test('the sum is recomputed exactly: a model-supplied total, or a report that repeats it, cannot pass', async t => {
  const f = fixture(t);
  const wrong = await f.run(m => { m.needs[2].claimed = '9800'; });
  assert.deepEqual(kinds(wrong).filter(k => k === 'ARITHMETIC_MISMATCH'), ['ARITHMETIC_MISMATCH']);
  f.put('report.md', f.report({ total: '9,800' }));
  const echoed = await f.run(m => { m.needs[2].claimed = '9800'; });
  assert.ok(kinds(echoed).includes('ARITHMETIC_MISMATCH') && kinds(echoed).includes('AGGREGATE_MISMATCH')); assert.equal(echoed.code, 1);
  assert.equal(formatDecimal(parseDecimal('0.1')!), '0.1'); assert.equal(parseDecimal('9'.repeat(LIMITS.decimalChars + 1)), undefined);
  const exact = fixture(t, [1, 2, 3]);
  exact.put('incidents.log', 'INC-1 database failover cost 0.1 won\nINC-2 cache outage cost 0.2 won\nINC-12 queue stall cost 0.3 won\n');
  exact.put('report.md', exact.report({ total: '0.6', costRows: ['- INC-1 0.1', '- INC-2 0.2', '- INC-12 0.3'] }));
  const sum = await exact.run(m => {
    m.sources.S1.sha256 = sha(readFileSync(join(exact.root, 'incidents.log')));
    m.needs[2].claimed = '0.6'; m.needs[2].items.forEach((i: any, k: number) => { i.value = ['0.1', '0.2', '0.3'][k]; i.quote = `${i.id} ${ROWS[k]![1]} cost ${i.value}`; });
  });
  assert.equal(sum.json.evidence.needs[2].computed, '0.6'); assert.equal(sum.json.evidence.needs[2].status, 'consistent', sum.out);
  const huge = await f.run(m => { m.needs[2].items[0].value = '1'.repeat(60); });
  assert.ok(kinds(huge).includes('VALUE_NOT_NUMERIC'));
});
test('numbers must come from the item\'s own quoted row, not from another row or a bare number', async t => {
  const f = fixture(t);
  const swapped = await f.run(m => { m.needs[2].items[0].value = '5500'; });
  assert.ok(kinds(swapped).includes('VALUE_NOT_IN_QUOTE'));
  const stitched = await f.run(m => { m.needs[2].items[0].quote = 'INC-1 database failover cost 3000 won on 2026-10-01 INC-2 cache outage cost 5500'; m.needs[2].items[0].value = '5500'; });
  assert.ok(kinds(stitched).includes('QUOTE_NOT_SUPPORTED'));
  const wide = await f.run(m => { m.needs[2].items[0].quote = 'INC-1 database failover cost 3000 won on 2026-10-01'; });
  assert.ok(kinds(wide).includes('AMBIGUOUS_VALUE'));
  const bare = await f.run(m => { m.needs[2].items[0].quote = 'INC-1 3000'; });
  assert.ok(kinds(bare).includes('QUOTE_NOT_SUPPORTED'));
  const invented = await f.run(m => { m.needs[0].items[1].quote = 'INC-2 cache meltdown'; });
  assert.ok(kinds(invented).includes('QUOTE_NOT_SUPPORTED')); assert.equal(invented.code, 1);
});
test('unsupported number notation is never read as its prefix; grouped, decimal and negative values still pass', async t => {
  const f = fixture(t);
  const withRow = async (row: string, value: string, quoteEnd = row) => {
    const log = `INC-1 database failover cost ${row} dollars\nINC-2 cache outage cost 5500 won\nINC-12 queue stall cost 1200 won\n`;
    f.put('incidents.log', log);
    return f.run(m => { m.sources.S1.sha256 = sha(log); m.needs[2].items[0].quote = `INC-1 database failover cost ${quoteEnd}`; m.needs[2].items[0].value = value; });
  };
  for (const [row, value] of [['1,23', '1'], ['3e3', '3'], ['1.2.3', '1'], ['1_000', '1'], ['1.234,56', '1']]) {
    const r = await withRow(row, value); assert.ok(kinds(r).includes('MALFORMED_NUMBER'), `${row}: ${r.out}`); assert.equal(r.code, 1);
  }
  // A quote that stops inside a number of its own row would ground a prefix of it.
  for (const [row, quoteEnd, value] of [['3000', '3', '3'], ['1,23', '1', '1'], ['3000', '000', '0'], ['-3000', '3000', '3000'], ['0.5', '0', '0'], ['3e3', '3', '3']]) {
    const r = await withRow(row, value, quoteEnd); assert.ok(kinds(r).includes('QUOTE_NOT_SUPPORTED'), `${row} clipped to ${quoteEnd}: ${r.out}`); assert.equal(r.code, 1);
  }
  const minus = await withRow('\u22125', '5'); assert.ok(kinds(minus).includes('VALUE_NOT_IN_QUOTE'), 'a true minus sign is not dropped');
  const grounding = ['VALUE_NOT_IN_QUOTE', 'MALFORMED_NUMBER', 'AMBIGUOUS_VALUE', 'QUOTE_TOO_BARE', 'QUOTE_NOT_SUPPORTED', 'VALUE_NOT_NUMERIC'];
  for (const [row, value] of [['1,234', '1234'], ['0.5', '0.5'], ['-3.5', '-3.5'], ['3000.', '3000']]) {
    const r = await withRow(row, value); assert.deepEqual(kinds(r).filter(k => grounding.includes(k)), [], `${row}: ${r.out}`);
  }
  assert.equal(formatDecimal(parseDecimal('-3.5')!), '-3.5'); assert.equal(parseDecimal('1,23'), undefined); assert.equal(parseDecimal('3e3'), undefined);
});
test('values and claims are nonblank JSON strings; JSON numbers, blanks and structures never ground anything', async t => {
  const f = fixture(t);
  const lookup = (value: unknown, claimed: unknown) => (m: any) => { m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed, items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value }] }); };
  for (const bad of ['', '   ', [], ['approved'], true, null, 5500]) {
    const r = await f.run(lookup(bad, bad)); assert.equal(r.code, 1, JSON.stringify(bad));
    assert.ok(kinds(r).includes('INVALID_ITEM') && kinds(r).includes('INVALID_NEED'), `${JSON.stringify(bad)}: ${r.out}`);
    assert.equal(r.json.evidence.needs[3].status, 'defective');
  }
  for (const bad of [3, 3.5, -1, 9007199254740993, '', null, [3]]) assert.ok(kinds(await f.run(m => { m.needs[1].claimed = bad; })).includes('INVALID_NEED'), JSON.stringify(bad));
  const raw = f.base(); writeFileSync(f.needsPath, JSON.stringify(raw).replace('"claimed":"3"', '"claimed":3.0000000000000001'));
  const lexeme = await cli(['--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md'), '--format', 'json']);
  assert.ok(lexeme.json.evidence.findings.some((x: any) => x.kind === 'INVALID_NEED'), 'a JSON number that rounds to 3 never counts'); assert.equal(lexeme.code, 1);
  const claimOnly = await f.run(lookup('5500', 5500)); assert.ok(kinds(claimOnly).includes('INVALID_NEED') && kinds(claimOnly).includes('CLAIM_MISSING'));
  assert.ok(kinds(await f.run(m => { m.needs[2].items[0].value = [3000]; m.needs[2].claimed = '3000'; })).includes('INVALID_ITEM'));
  assert.equal((await f.run(lookup('5500', '5500'))).json.evidence.needs[3].status, 'consistent');
  // A JSON number above 2^53 is rounded by the parser; the exact string survives and the number is refused.
  const log = f.log().replace('cost 5500', 'cost 9007199254740993');
  f.put('incidents.log', log);
  f.put('report.md', f.report().replace('- INC-2 5,500', '- INC-2 9007199254740993'));
  const big = (value: unknown, claimed: unknown) => f.run(m => { m.sources.S1.sha256 = sha(log); m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed, items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 9007199254740993', value }] }); });
  const exact = await big('9007199254740993', '9007199254740993'); assert.equal(exact.json.evidence.needs[3].status, 'consistent', exact.out);
  const rounded = await big(9007199254740993, 9007199254740993); assert.ok(kinds(rounded).includes('INVALID_ITEM')); assert.equal(rounded.json.evidence.needs[3].status, 'defective');
  const off = await big('9007199254740992', '9007199254740992'); assert.ok(kinds(off).includes('VALUE_NOT_IN_QUOTE'));
});
test('a quote lies inside one physical row with an exact ID token; totals never reuse item rows', async t => {
  const f = fixture(t);
  const lookupOn = (log: string, id: string, quote: string, value: string, extra: (m: any) => void = () => {}) => { f.put('incidents.log', log); return f.run(m => { m.sources.S1.sha256 = sha(log); m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed: value, items: [{ id, source: 'S1', quote, value }] }); extra(m); }); };
  const stitched = await lookupOn('ITEM-A status pending\nITEM-B status approved\n', 'ITEM-A', 'ITEM-A status pending ITEM-B status approved', 'approved', m => { m.needs = m.needs.slice(3); });
  assert.ok(kinds(stitched).includes('QUOTE_NOT_SUPPORTED'), stitched.out);
  const prefixed = await lookupOn('ITEM-AB status approved\n', 'ITEM-A', 'ITEM-AB status approved', 'approved', m => { m.needs = m.needs.slice(3); });
  assert.ok(kinds(prefixed).includes('QUOTE_NOT_SUPPORTED'), 'ITEM-A is not ITEM-AB');
  const honest = await lookupOn('ITEM-A status approved\n', 'ITEM-A', 'ITEM-A status approved', 'approved', m => { m.needs = m.needs.slice(3); });
  assert.ok(!kinds(honest).includes('QUOTE_NOT_SUPPORTED'), honest.out);
  // A component row cannot stand in for the total: the only 3000 here is INC-1's own row.
  f.put('incidents.log', f.log());
  const solo = (report: string) => { f.put('report.md', report); return f.run(m => { m.needs = [{ id: 'N9', type: 'compute', operation: 'sum', requirement: 'COST', requirementRevision: 1, claimed: '3000', reportPrefix: '합계', items: [{ id: 'INC-1', source: 'S1', quote: 'INC-1 database failover cost 3000', value: '3000' }] }]; m.needs.unshift({ ...f.base().needs[0], items: f.base().needs[0].items }); }); };
  const hidden = await solo('## 요약\n\nINCIDENTS 목록\n- INC-1 database failover\n- INC-2 cache outage\n- INC-12 queue stall\n\nCOST 비용\n- INC-1 3,000\n합계 99\n');
  assert.ok(kinds(hidden).includes('AGGREGATE_MISMATCH'), hidden.out);
  const shown = await solo('## 요약\n\nINCIDENTS 목록\n- INC-1 database failover\n- INC-2 cache outage\n- INC-12 queue stall\n\nCOST 비용\n- INC-1 3,000\n합계 3,000\n');
  assert.ok(!kinds(shown).some(k => k.startsWith('AGGREGATE') || k === 'NOT_IN_REPORT'), shown.out);
  // The residual case: a component row and another labelled number cannot stand in for the total.
  const withPrefix = async (cost: string, prefix = 'Total cost') => { f.put('report.md', `## 요약\n\nINCIDENTS 목록\n- INC-1 database failover\n- INC-2 cache outage\n- INC-12 queue stall\n\nCOST 비용\n${cost}\n`); return f.run(m => { m.needs = [{ id: 'N9', type: 'compute', operation: 'sum', requirement: 'COST', requirementRevision: 1, claimed: '3000', ...(prefix ? { reportPrefix: prefix } : {}), items: [{ id: 'INC-1', source: 'S1', quote: 'INC-1 database failover cost 3000', value: '3000' }] }]; m.needs.unshift({ ...f.base().needs[0] }); }); };
  const residual = await withPrefix('- INC-1 3,000\nBudget 3,000\nTotal cost 99'); assert.ok(kinds(residual).includes('AGGREGATE_MISMATCH'), residual.out);
  const control = await withPrefix('- INC-1 3,000\nBudget 99\nTotal cost 3,000'); assert.ok(!kinds(control).some(k => k.startsWith('AGGREGATE') || k === 'NOT_IN_REPORT'), control.out); assert.equal(control.json.evidence.needs[1].aggregateLine, 'Total cost 3,000');
  assert.ok(kinds(await withPrefix('- INC-1 3,000\nBudget 3,000')).includes('NOT_IN_REPORT'));
  assert.ok(kinds(await withPrefix('Total cost 3,000\nTotal cost 3,000')).includes('AMBIGUOUS_AGGREGATE'));
  assert.ok(kinds(await withPrefix('Total cost 3,000 of 5,000')).includes('AGGREGATE_NOT_SINGLE_NUMBER'));
  assert.ok(kinds(await withPrefix('Total cost 3,000', '')).includes('PREFIX_MISSING'));
  assert.ok(kinds(await withPrefix('Total cost: 3,000 [4]')).every(k => !k.startsWith('AGGREGATE')), 'a citation after the number is not a second number');
});
test('typed mode refuses --pairs; boundary memory stays linear and bounded', async t => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, 'report.md'), 'utf8');
  assert.equal((await f.run(() => {}, ['--pairs', join(f.root, 'report.md')])).code, 2);
  assert.equal(readFileSync(join(f.root, 'report.md'), 'utf8'), before, 'the report was not overwritten');
  const repeated = 'A-1 x\n'.repeat(100000), many = Array.from({ length: LIMITS.items + 5 }, (_, i) => `B-${i} y\n`).join('');
  f.put('dup.log', repeated); f.put('many.log', many);
  const dup = await f.run(m => { m.sources.S2 = { path: 'dup.log', sha256: sha(repeated) }; m.sources.S3 = { path: 'many.log', sha256: sha(many) }; m.needs[0].boundary = { source: 'S2', linePrefix: 'A-' }; m.needs[1].boundary = { source: 'S3', linePrefix: 'B-' }; });
  assert.ok(kinds(dup).includes('AMBIGUOUS_ROW')); assert.ok(dup.json.evidence.findings.some((x: any) => x.kind === 'INVALID_BOUNDARY' && /more than/.test(x.detail)));
});
test('the report must show each value on its item row inside the bound requirement, not in dates, citations or sources', async t => {
  const f = fixture(t, [3000, 5500, 21]);
  f.put('incidents.log', f.log([3000, 5500, 21]));
  const edit = (m: any) => { m.sources.S1.sha256 = sha(readFileSync(join(f.root, 'incidents.log'))); };
  assert.equal((await f.run(edit)).code, 0);
  f.put('report.md', f.report({ costRows: ['- INC-1 3,000', '- INC-2 5,500', '- INC-12 2026-10-21 queue stall [1]'] }));
  const dated = await f.run(edit); assert.ok(kinds(dated).includes('NOT_IN_REPORT'), dated.out);
  f.put('report.md', f.report({ costRows: ['- INC-1 3,000', '- INC-2 5,500', '- INC-12 queue stall'], total: '8,521' }));
  assert.ok(kinds(await f.run(edit)).includes('NOT_IN_REPORT'));
  f.put('report.md', f.report({ total: '', sources: '[1] 합계 8,521 — https://example.org/incidents' }).replace('합계  [1]', '합계 [1]'));
  const sourcesOnly = await f.run(edit); assert.ok(kinds(sourcesOnly).includes('AGGREGATE_NOT_SINGLE_NUMBER'));
  f.put('report.md', f.report({ costRows: ['- INC-1 5,500', '- INC-2 3,000', '- INC-12 21'] }));
  assert.ok(kinds(await f.run(edit)).includes('NOT_IN_REPORT'), 'values swapped between item rows');
  f.put('report.md', '## 요약\n\nINCIDENTS 10월 장애 목록: 총 3건\n- INC-1 a\n- INC-2 b\n- INC-12 c\n합계 8,521\n\nCOST 장애 비용\n\n## 출처\n\n[1] x https://example.org\n');
  assert.ok(kinds(await f.run(edit)).includes('NOT_IN_REPORT'), 'total reported under the other requirement');
});
test('missing, empty and unreadable evidence never passes', async t => {
  const f = fixture(t);
  assert.ok(kinds(await f.run(m => { m.needs = []; })).includes('EMPTY_EVIDENCE'));
  assert.ok(kinds(await f.run(m => { delete m.needs; })).includes('EMPTY_EVIDENCE'));
  assert.ok(kinds(await f.run(m => { m.needs[0].items = []; })).includes('EMPTY_EVIDENCE'));
  const nothing = await f.run(m => { m.needs = []; }); assert.equal(nothing.code, 1); assert.equal(nothing.json.evidence.mechanicalResult, 'not-consistent');
  assert.equal((await f.run(m => { m.schema = 'other'; })).code, 2);
  assert.equal((await cli(['--needs', join(f.root, 'absent.json'), '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')])).code, 2);
  writeFileSync(f.needsPath, '{not json'); assert.equal((await cli(['--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')])).code, 2);
  assert.ok(kinds(await f.run(m => { m.needs[2].items[0].source = 'S9'; })).includes('INVALID_ITEM'));
});
test('stale sources, revised or withdrawn requirements, changed constraints and replayed manifests cannot pass', async t => {
  const f = fixture(t);
  const manifest = f.base(); f.put('incidents.log', f.log() + 'INC-13 late arrival cost 1 won\n');
  const staleSource = await f.run(m => { m.sources.S1.sha256 = manifest.sources.S1.sha256; });
  assert.ok(kinds(staleSource).includes('STALE_SOURCE')); assert.equal(staleSource.code, 1);
  f.put('incidents.log', f.log());
  assert.equal((await f.run()).code, 0);
  f.revise({ constraints: ['Only production incidents'] });
  const scope = await f.run(); assert.ok(kinds(scope).includes('STALE_TASK'), scope.out);
  assert.equal((await f.run(m => { m.constraintsRevision = 1; })).code, 0, 'same manifest rebuilt on the current constraints');
  const replay = await f.run(m => { m.constraintsRevision = 1; m.task = 'other'; }); assert.ok(kinds(replay).includes('STALE_TASK'));
  const moved = await f.run(m => { m.constraintsRevision = 1; m.workspace = 'f'.repeat(64); }); assert.ok(kinds(moved).includes('STALE_TASK'));
  f.revise({ requirements: [{ id: 'COST', text: 'Total only the production incident cost', kind: 'research' }] });
  const revised = await f.run(m => { m.constraintsRevision = 1; }); assert.ok(kinds(revised).includes('STALE_REQUIREMENT'));
  assert.equal((await f.run(m => { m.constraintsRevision = 1; m.needs[2].requirementRevision = 2; })).code, 0);
  f.revise({ withdraw: ['COST'] });
  const withdrawn = await f.run(m => { m.constraintsRevision = 1; m.needs[2].requirementRevision = 2; });
  assert.ok(kinds(withdrawn).includes('INACTIVE_REQUIREMENT')); assert.equal(withdrawn.code, 1);
  const narrowed = await f.run(m => { m.constraintsRevision = 1; m.needs.pop(); });
  assert.equal(narrowed.code, 0, narrowed.out); assert.equal(narrowed.json.evidence.requirements.find((r: any) => r.id === 'COST').active, false);
  assert.ok(kinds(await f.run(m => { m.constraintsRevision = 1; m.needs.pop(); }, ['--cover', 'COST'])).includes('INACTIVE_REQUIREMENT'));
});
test('coverage defaults to every active requirement; --cover narrows it and an empty selection fails', async t => {
  const f = fixture(t);
  const missing = await f.run(m => { m.needs = m.needs.slice(2); });
  assert.deepEqual(missing.json.evidence.findings.filter((x: any) => x.kind === 'NO_NEED').map((x: any) => x.req), ['INCIDENTS']);
  const narrowed = await f.run(m => { m.needs = m.needs.slice(2); }, ['--cover', 'COST']);
  assert.equal(narrowed.code, 0); assert.deepEqual([narrowed.json.evidence.covered, narrowed.json.evidence.outsideScope], [['COST'], ['INCIDENTS']]);
  assert.match((await f.run(m => { m.needs = m.needs.slice(2); }, ['--cover', 'COST'], 'text')).out, /outside this check: INCIDENTS; this result says nothing about the task as a whole/);
  assert.equal((await f.run(() => {}, ['--cover', 'all'])).code, 0);
  assert.equal((await f.run(() => {}, ['--cover', ''])).code, 2);
  assert.equal((await f.run(() => {}, ['--cover', 'COST,'])).code, 2);
  assert.equal((await f.run(() => {}, ['--cover', 'COST,all'])).code, 2);
  assert.ok(kinds(await f.run(() => {}, ['--cover', 'NOPE'])).includes('UNKNOWN_REQUIREMENT'));
  f.revise({ withdraw: ['INCIDENTS', 'COST'] });
  const none = await f.run(m => { m.constraintsRevision = 0; m.needs = []; });
  assert.ok(kinds(none).includes('NO_ACTIVE_REQUIREMENT')); assert.equal(none.code, 1);
});
test('completeness is only claimed against a declared boundary; compare and judge stay manual', async t => {
  const f = fixture(t);
  const open = await f.run(m => { delete m.needs[0].boundary; });
  assert.ok(kinds(open).includes('UNMEASURED')); assert.equal(open.code, 1); assert.equal(open.json.evidence.needs[0].status, 'unmeasured');
  assert.ok(kinds(await f.run(m => { m.needs[0].boundary.linePrefix = 'XYZ-'; })).includes('EMPTY_BOUNDARY'));
  assert.ok(kinds(await f.run(m => { m.needs[0].boundary.delimiter = ''; })).includes('INVALID_BOUNDARY'));
  f.put('incidents.log', f.log() + 'INC-2 cache outage cost 5600 won\n');
  assert.ok(kinds(await f.run(m => { m.sources.S1.sha256 = sha(readFileSync(join(f.root, 'incidents.log'))); })).includes('AMBIGUOUS_ROW'));
  const manual = await f.run(m => { m.needs.push({ id: 'N9', type: 'judge', requirement: 'COST', requirementRevision: 1 }, { id: 'N10', type: 'compare', requirement: 'COST', requirementRevision: 1 }); });
  assert.equal(manual.code, 1); assert.deepEqual(manual.json.evidence.needs.slice(3).map((n: any) => n.status), ['manual', 'manual']);
  assert.ok(kinds(await f.run(m => { m.needs[2].operation = 'ratio'; })).includes('UNSUPPORTED_OPERATION'));
  const corrected = await f.run(m => { m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed: '5500', items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] }); });
  assert.equal(corrected.json.evidence.needs[3].status, 'defective', 'a lookup over a corrected row is ambiguous'); assert.ok(kinds(corrected).includes('AMBIGUOUS_ROW'));
  f.put('incidents.log', f.log());
  const lookup = await f.run(m => { m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed: '5500', items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] }); });
  assert.equal(lookup.json.evidence.needs[3].status, 'consistent', lookup.out);
  const badLookup = await f.run(m => { m.needs.push({ id: 'L1', type: 'lookup', requirement: 'COST', requirementRevision: 1, claimed: '5600', items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] }); });
  assert.ok(kinds(badLookup).includes('VALUE_MISMATCH'));
});
test('--req file bindings use the current requirement text and reject ambiguous rows; the plain RFP check is unchanged', async t => {
  const f = fixture(t);
  const req = f.put('rfp.txt', 'REQ-001  Every October incident is listed\nREQ-002  The cost is totalled\n');
  const body = `## 요약\n\nREQ-001 목록\n- INC-1 database failover\n- INC-2 cache outage\n- INC-12 queue stall\n개수 3건\n\nREQ-002 합계 9,700\n- INC-1 3,000\n- INC-2 5,500\n- INC-12 1,200\n\n## 출처\n\n[1] x https://example.org\n`;
  f.put('report.md', body);
  const hash = (text: string) => sha(text.normalize('NFKC').replace(/\s+/gu, ' ').trim());
  const typed = (extra: (m: any) => void = () => {}, reqPath = req) => { const m = f.base(); delete m.task; delete m.workspace; delete m.constraintsRevision;
    for (const n of m.needs) { delete n.requirementRevision; n.requirement = n.requirement === 'INCIDENTS' ? 'REQ-001' : 'REQ-002'; n.requirementSha256 = hash(n.requirement === 'REQ-001' ? 'Every October incident is listed' : 'The cost is totalled'); }
    extra(m); writeFileSync(f.needsPath, JSON.stringify(m)); return cli(['--needs', f.needsPath, '--req', reqPath, '--report', join(f.root, 'report.md'), '--min-chars', '10', '--format', 'json']); };
  const ok = await typed(); assert.equal(ok.code, 0, ok.out); assert.equal(ok.json.evidence.binding, 'requirements-file'); assert.equal(ok.json.total, 2);
  const stale = await typed(m => { m.needs[2].requirementSha256 = hash('The cost is totalled for production'); }); assert.ok(kinds(stale).includes('STALE_REQUIREMENT'));
  const one = await typed(m => { m.needs = m.needs.slice(0, 2); }); assert.ok(one.json.evidence.findings.some((x: any) => x.kind === 'NO_NEED' && x.req === 'REQ-002'));
  const dup = f.put('dup.txt', 'REQ-001  first reading\nREQ-001  second reading\nREQ-002  other\n');
  const twice = await typed(() => {}, dup); assert.equal(twice.code, 2); assert.match(twice.out, /Duplicate requirement ID/);
  assert.equal((await cli(['--req', dup, '--report', join(f.root, 'report.md')])).code, 1, 'legacy last-row-wins parsing is unchanged without --needs');
  const legacy = await cli(['--req', req, '--report', join(f.root, 'report.md'), '--min-chars', '10', '--format', 'json']);
  assert.deepEqual(Object.keys(legacy.json), ['findings', 'total', 'covered', 'pairs']);
  assert.equal((await cli(['--req', req, '--report', join(f.root, 'report.md'), '--task', 'inc'])).code, 2);
  assert.equal((await cli(['--needs', f.needsPath, '--report', join(f.root, 'report.md')])).code, 2);
});
test('inputs are read within fixed bounds and a FIFO cannot hang the checker', async t => {
  const f = fixture(t);
  f.put('big.log', 'x'.repeat(LIMITS.fileBytes + 1));
  const big = await f.run(m => { m.sources.S2 = { path: 'big.log', sha256: sha('x'.repeat(LIMITS.fileBytes + 1)) }; m.needs[0].items[0].source = 'S2'; });
  assert.ok(kinds(big).includes('SOURCE_MISSING') && /larger than/.test(JSON.stringify(big.json)));
  if (process.platform !== 'win32') {
    const fifo = join(f.root, 'pipe.log'); assert.equal(runProcess('mkfifo', [fifo]).status, 0);
    // A blocking open cannot be interrupted in-process, so FIFO inputs run in a child with a hard timeout.
    const child = (extra: string[]) => runProcess(process.execPath, [COVERAGE, '--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--format', 'json', ...extra], { timeout: 20000 });
    const timedOut = (r: { error?: Error }): boolean => (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    const piped = f.base(); piped.sources.S3 = { path: 'pipe.log', sha256: sha('') }; piped.needs[0].items[0].source = 'S3'; writeFileSync(f.needsPath, JSON.stringify(piped));
    const fromSource = child(['--report', join(f.root, 'report.md')]);
    assert.ok(!timedOut(fromSource), 'a FIFO source blocked the checker'); assert.equal(fromSource.status, 1); assert.match(fromSource.stdout, /SOURCE_MISSING/);
    const asReport = child(['--report', fifo]);
    assert.ok(!timedOut(asReport), 'a FIFO report blocked the checker'); assert.equal(asReport.status, 2);
    writeFileSync(f.needsPath, JSON.stringify(f.base()));
    symlinkSync(join(f.root, 'incidents.log'), join(f.root, 'alias.log'));
    const aliased = await f.run(m => { m.sources.S4 = { path: 'alias.log', sha256: m.sources.S1.sha256 }; m.needs[0].items[0].source = 'S4'; });
    assert.ok(kinds(aliased).includes('SOURCE_MISSING'), 'a symbolic link is not followed');
  }
  assert.equal((await cli(['--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'big.log')])).code, 2, 'an oversized report is refused in typed mode');
  const many = fixture(t); const tooMany = await many.run(m => { for (let i = 0; i < LIMITS.sources + 1; i++) m.sources[`X${i}`] = m.sources.S1; });
  assert.equal(tooMany.code, 2);
});
/** Direct check_evidence call against one hash-checked source, bound to a requirements file with one requirement. */
function direct(t: any, req = 'REQ-1') {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-evidence-direct-'))); t.after(() => rmSync(top, { recursive: true, force: true }));
  const dir = join(top, 'base'); mkdirSync(dir);
  const bindings = fileBindings({ [req]: 'x' });
  return (log: string, need: any, report: string, path = 'a.log') => {
    if (path === 'a.log') writeFileSync(join(dir, path), log);
    const r = check_evidence({ schema: 'jstack-evidence-needs/1', sources: { S1: { path, sha256: sha(log) } }, needs: [{ requirement: req, requirementSha256: requirementSha('x'), ...need }] }, dir, [report], bindings, 'requirements-file');
    return { result: r.mechanicalResult, kinds: r.findings.map(x => x.kind), dir };
  };
}
const TWO = 'INC-1 database failover cost 3000 won\nINC-2 cache outage cost 5500 won\n';
const twoSum = { id: 'N1', type: 'compute', operation: 'sum', claimed: '8500', reportPrefix: '합계', boundary: { source: 'S1', linePrefix: 'INC-' },
  items: [{ id: 'INC-1', source: 'S1', quote: 'INC-1 database failover cost 3000', value: '3000' }, { id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] };
test('a report line that names several submitted items is never value evidence for any of them', t => {
  const check = direct(t);
  assert.equal(check(TWO, twoSum, 'REQ-1 비용\n- INC-1 3,000\n- INC-2 5,500\n합계 8,500').result, 'consistent');
  for (const swapped of ['REQ-1 cost: INC-1 costs 5,500 and INC-2 costs 3,000\n합계 8,500', 'REQ-1 비용\n| INC-1, INC-2 | 5,500 / 3,000 |\n합계 8,500', 'REQ-1 비용\n| INC-1, INC-2 | 3,000 / 5,500 |\n합계 8,500']) {
    const r = check(TWO, twoSum, swapped); assert.equal(r.result, 'not-consistent', swapped); assert.ok(r.kinds.includes('NOT_IN_REPORT'), swapped);
  }
});
test('nested item IDs keep their own rows: INC-1.2 is not INC-1, and their values still cannot be swapped', t => {
  const check = direct(t);
  for (const [long, short, prefix] of [['INC-1.2', 'INC-1', 'INC-'], ['§3.1', '§3', '§']] as const) {
    const log = `${long} travel cost 30 won\n${short} staff cost 55 won\n`;
    const need = { id: 'N1', type: 'compute', operation: 'sum', claimed: '85', reportPrefix: '합계', boundary: { source: 'S1', linePrefix: prefix },
      items: [{ id: long, source: 'S1', quote: `${long} travel cost 30`, value: '30' }, { id: short, source: 'S1', quote: `${short} staff cost 55`, value: '55' }] };
    const ok = check(log, need, `REQ-1 비용\n- ${long} 30\n- ${short} 55\n합계 85`); assert.equal(ok.result, 'consistent', `${long}/${short}: ${ok.kinds.join()}`);
    const swapped = check(log, need, `REQ-1 비용\n- ${long} 55\n- ${short} 30\n합계 85`); assert.ok(swapped.kinds.includes('NOT_IN_REPORT'), `${long}/${short} swapped`);
    assert.ok(check(log, need, `REQ-1 비용\n- ${long} 30 (${short} 55)\n합계 85`).kinds.includes('NOT_IN_REPORT'), `${long}/${short} on one line`);
    const listed = { id: 'N2', type: 'enumerate', boundary: { source: 'S1', linePrefix: prefix }, items: need.items.map(({ value, ...item }) => item) };
    assert.equal(check(log, listed, `REQ-1 목록\n- ${long}\n- ${short}`).result, 'consistent', `${long}/${short} listed`);
    assert.ok(check(log, listed, `REQ-1 목록\n- ${long}`).kinds.includes('NOT_IN_REPORT'), `${long} alone does not list ${short}`);
    assert.ok(check(log, need, `REQ-1 비용\n- ${long} 30 55\n합계 85`).kinds.includes('NOT_IN_REPORT'), `${long}'s row is not ${short}'s row`);
  }
});
test('a dot followed by a digit continues an ID, so a lookup never reads a longer ID as its own', t => {
  const check = direct(t);
  const lookup = (value: string, quote: string) => ({ id: 'L1', type: 'lookup', claimed: value, items: [{ id: 'INC-1', source: 'S1', quote, value }] });
  const borrowed = check('INC-1.2 travel cost 30 won\n', lookup('30', 'INC-1.2 travel cost 30'), 'REQ-1 비용\n- INC-1 30');
  assert.ok(borrowed.kinds.includes('QUOTE_NOT_SUPPORTED'), `R1: ${borrowed.kinds.join()}`);
  const both = 'INC-1 staff cost 30 won\nINC-1.2 travel cost 30 won\n';
  const otherRow = check(both, lookup('30', 'INC-1 staff cost 30'), 'REQ-1 비용\n- INC-1.2 30');
  assert.deepEqual(otherRow.kinds, ['NOT_IN_REPORT'], 'R2: the INC-1.2 report row does not report INC-1');
  assert.equal(check(both, lookup('30', 'INC-1 staff cost 30'), 'REQ-1 비용\n- INC-1 30').result, 'consistent', 'R3: an INC-1.2 row is not a second INC-1 row');
  assert.equal(check('INC-1 staff cost 30 won.\n', lookup('30', 'INC-1 staff cost 30'), 'REQ-1 비용. INC-1. 30').result, 'consistent', 'a sentence-ending dot still ends the ID');
  const subRequirement = check('INC-1 staff cost 30 won\n', lookup('30', 'INC-1 staff cost 30'), 'REQ-1.2 비용\n- INC-1 30');
  assert.deepEqual(subRequirement.kinds, ['NOT_IN_REPORT'], 'a paragraph naming REQ-1.2 is not a REQ-1 paragraph');
  const grade = (log: string) => check(log, { id: 'L1', type: 'lookup', claimed: '2등급', items: [{ id: 'ITEM-A', source: 'S1', quote: log.trim(), value: '2등급' }] }, 'REQ-1 등급\n- ITEM-A 2등급');
  assert.ok(grade('ITEM-A 등급 A.2등급\n').kinds.includes('VALUE_NOT_IN_QUOTE'), 'a label is not read from inside A.2등급');
  assert.equal(grade('ITEM-A 등급 2등급\n').result, 'consistent');
  // IDs outside letters, digits, `_` and `-` take the boundary-test path: a sentence-ending dot still ends them.
  const section = direct(t, '§3');
  const dotted = { id: 'L1', type: 'lookup', claimed: '30', items: [{ id: 'INC-1.2', source: 'S1', quote: 'INC-1.2. end cost 30', value: '30' }] };
  const ended = section('INC-1.2. end cost 30 won\n', dotted, '§3. heading\n- INC-1.2. 30');
  assert.equal(ended.result, 'consistent', `§3. and INC-1.2. end their IDs: ${ended.kinds.join()}`);
  // Occurrences never overlap: in `7 7 7` the ID `7 7` is removed once, so the trailing 7 stays a second number.
  const repeated = { id: 'L1', type: 'lookup', claimed: '5', items: [{ id: '7 7', source: 'S1', quote: '7 7 7 cost 5', value: '5' }] };
  const overlap = check('7 7 7 cost 5 won\n', repeated, 'REQ-1 비용\n- 7 7 5');
  assert.ok(overlap.kinds.includes('AMBIGUOUS_VALUE'), `overlapping occurrences: ${overlap.kinds.join()}`);
});
test('a quote must lie in a source row that names the item ID as a whole token', t => {
  const check = direct(t);
  const lookup = { id: 'L1', type: 'lookup', claimed: '5500', items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cost 5500', value: '5500' }] };
  const glued = check('XINC-2 cost 5500 won\n', lookup, 'REQ-1 비용\n- INC-2 5,500'); assert.ok(glued.kinds.includes('QUOTE_NOT_SUPPORTED'), glued.kinds.join());
  assert.equal(check('INC-2 cost 5500 won\n', lookup, 'REQ-1 비용\n- INC-2 5,500').result, 'consistent');
});
test('a lookup label matches as a whole token in the quote and the report, never inside a longer word', t => {
  const check = direct(t);
  const lookup = (value: string) => ({ id: 'L1', type: 'lookup', claimed: value, items: [{ id: 'ITEM-A', source: 'S1', quote: 'ITEM-A status unapproved', value }] });
  const inside = check('ITEM-A status unapproved\n', lookup('approved'), 'REQ-1 상태\n- ITEM-A approved');
  assert.equal(inside.result, 'not-consistent'); assert.ok(inside.kinds.includes('VALUE_NOT_IN_QUOTE'), inside.kinds.join());
  assert.equal(check('ITEM-A status unapproved\n', lookup('unapproved'), 'REQ-1 상태\n- ITEM-A unapproved').result, 'consistent');
  const report = check('ITEM-A status approved\n', { ...lookup('approved'), items: [{ id: 'ITEM-A', source: 'S1', quote: 'ITEM-A status approved', value: 'approved' }] }, 'REQ-1 상태\n- ITEM-A unapproved');
  assert.ok(report.kinds.includes('NOT_IN_REPORT'), report.kinds.join());
});
test('item IDs are removed as whole tokens, so a longer ID never leaves digits that pass for a value', t => {
  const check = direct(t);
  const lookup = { id: 'L1', type: 'lookup', claimed: '2', items: [{ id: 'INC-1', source: 'S1', quote: 'INC-1 database failover cost 2', value: '2' }] };
  const log = 'INC-1 database failover cost 2 won\nINC-12 queue stall cost 7 won\n';
  assert.equal(check(log, lookup, 'REQ-1 비용\n- INC-1 2').result, 'consistent');
  const report = check(log, lookup, 'REQ-1 비용\n- INC-1 (related: INC-12) total impact'); assert.ok(report.kinds.includes('NOT_IN_REPORT'), report.kinds.join());
  const quote = check('INC-1 see INC-12\n', { ...lookup, items: [{ id: 'INC-1', source: 'S1', quote: 'INC-1 see INC-12', value: '2' }] }, 'REQ-1 비용\n- INC-1 2');
  assert.ok(quote.kinds.includes('VALUE_NOT_IN_QUOTE'), quote.kinds.join());
});
test('a lookup honours its boundary and never grounds one of several rows for the same ID', t => {
  const check = direct(t);
  const log = 'INC-2 cache outage cost 5500 won\nINC-2 cache outage cost 5600 won (corrected)\n';
  const lookup = (boundary: boolean) => ({ id: 'L1', type: 'lookup', claimed: '5500', ...(boundary ? { boundary: { source: 'S1', linePrefix: 'INC-' } } : {}), items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] });
  for (const bounded of [true, false]) { const r = check(log, lookup(bounded), 'REQ-1 비용\n- INC-2 5,500'); assert.ok(r.kinds.includes('AMBIGUOUS_ROW'), `${bounded}: ${r.kinds.join()}`); }
  assert.equal(check('INC-2 cache outage cost 5500 won\nINC-3 other cost 1 won\n', lookup(true), 'REQ-1 비용\n- INC-2 5,500').result, 'consistent', 'other boundary rows are not omissions for a lookup');
  assert.ok(check('INC-3 other cost 1 won\nNOTE INC-2 cache outage cost 5500\n', { ...lookup(true), items: [{ id: 'INC-2', source: 'S1', quote: 'INC-2 cache outage cost 5500', value: '5500' }] }, 'REQ-1 비용\n- INC-2 5,500').kinds.includes('UNKNOWN_ITEM'));
});
test('a source path that leaves the needs directory or passes through a linked directory is refused', t => {
  const check = direct(t); const log = 'ITEM-A status approved\n';
  const lookup = { id: 'L1', type: 'lookup', claimed: 'approved', items: [{ id: 'ITEM-A', source: 'S1', quote: 'ITEM-A status approved', value: 'approved' }] };
  const { dir } = check(log, lookup, 'REQ-1 상태\n- ITEM-A approved');
  mkdirSync(join(dir, 'real')); writeFileSync(join(dir, 'real', 'c.log'), log);
  assert.equal(check(log, lookup, 'REQ-1 상태\n- ITEM-A approved', 'real/c.log').result, 'consistent');
  if (process.platform !== 'win32') {
    symlinkSync(join(dir, 'real'), join(dir, 'linkdir'));
    assert.ok(check(log, lookup, 'REQ-1 상태\n- ITEM-A approved', 'linkdir/c.log').kinds.includes('SOURCE_MISSING'), 'a linked directory is not followed');
  }
  writeFileSync(join(dir, '..', 'outside.log'), log);
  assert.ok(check(log, lookup, 'REQ-1 상태\n- ITEM-A approved', '../outside.log').kinds.includes('SOURCE_MISSING'), 'a path outside the needs directory is refused');
  assert.ok(check(log, lookup, 'REQ-1 상태\n- ITEM-A approved', join(dir, '..', 'outside.log')).kinds.includes('SOURCE_MISSING'), 'an absolute path outside the needs directory is refused');
});
test('a spawned process runs the same opt-in path and exit codes', t => {
  const f = fixture(t); const m = f.base(); writeFileSync(f.needsPath, JSON.stringify(m));
  const args = [COVERAGE, '--needs', f.needsPath, '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')];
  const ok = runProcess(process.execPath, args);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /mechanical result: consistent/);
  m.needs[2].claimed = '1'; writeFileSync(f.needsPath, JSON.stringify(m));
  const bad = runProcess(process.execPath, args); assert.equal(bad.status, 1); assert.match(bad.stdout, /\[ARITHMETIC_MISMATCH\]/);
  const abort = runProcess(process.execPath, [COVERAGE, '--needs', join(f.root, 'absent.json'), '--task', 'inc', '--workspace', f.root, '--home', f.home, '--report', join(f.root, 'report.md')]);
  assert.equal(abort.status, 2);
});
