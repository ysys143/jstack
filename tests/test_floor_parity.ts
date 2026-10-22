/** The original twenty contamination controls, including final-verdict and alias semantics. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './_fixtures.js';
const designPackFloors = Array.from({ length: 41 }, (_, index) => [`assets/design-packs/fixture-${index}.md`, 1] as [string, number]);
const label = 'skills/ui', floorLines = [['SKILL.md', 16], ['NOTICE', 4], ['UPSTREAM.sha256', 2], ['references/web-interface-guidelines.md', 8], ['LICENSE.web-interface-guidelines', 1], ...designPackFloors].map(([file, count]) => `[PASS] 계약 커버리지: ${file} — ${count}건 실패 (하한 ${count})`).join('\n') + '\n[PASS] 자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다 — 16건 실패 (하한 16)';
function run(stdout: string, selected = label) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-root-floor-'));
  try { writeFileSync(join(root, 'ui.out'), stdout); return spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check_floor_parity.js', import.meta.url)), selected, '--root', ROOT, '--from-dir', root], { cwd: ROOT, encoding: 'utf8' }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const green = () => run(floorLines + '\n\n47/47 통과\n'), red = () => run(floorLines + '\n\n45/47 통과\n');
const sourceUiRel = existsSync(join(ROOT, 'skills/ui')) ? 'skills/ui' : 'skills/public/engineering/web-interface';
const sourceUi = join(ROOT, sourceUiRel);
let registered = 0;
function check(name: string, assertion: () => void) { registered++; test(`floor parity: ${name}`, assertion); }
check('clean suites pass', () => { const result = green(); assert.equal(result.status, 0, result.stdout + result.stderr); });
check('clean suites are not called contaminated', () => assert.doesNotMatch(green().stdout, /오염된 실측/));
check('red suites fail even with exact floor values', () => assert.notEqual(red().status, 0));
check('contamination is named explicitly', () => assert.match(red().stdout, /오염된 실측/));
check('the unconditional failure count is reported', () => assert.match(red().stdout, /2건/));
check('contamination cannot prescribe increasing floors', () => assert.match(red().stdout, /하한을 올리지 마라/));
const inflated = () => run('[FAIL] 계약 커버리지: SKILL.md — 16건 실패 (하한 14)\n[FAIL] 계약 커버리지: NOTICE — 6건 실패 (하한 4)\n\n45/47 통과\n');
check('inflated contaminated values are not reported as individual slack', () => assert.doesNotMatch(inflated().stdout, /여유 2|선언 14 \/ 실측 16|declared 14, measured 16/));
check('inflated contamination still exits nonzero', () => assert.notEqual(inflated().status, 0));
check('missing verdicts fail', () => assert.notEqual(run(floorLines + '\n').status, 0));
check('missing verdicts are named', () => assert.match(run(floorLines + '\n').stdout, /총평/));
check('contamination is not counted again as zero measured or unregistered population', () => assert.doesNotMatch(red().stdout, /잰 하한 0건|등재되지 않은 스위트|unregistered floor population/));
check('a single suite uses its last verdict', () => { const result = run('12/34 통과\n' + floorLines + '\n\n47/47 통과\n'); assert.equal(result.status, 0, result.stdout); });
check('unittest OK is recognized', () => assert.equal(run(floorLines + '\n\nRan 44 tests in 2.199s\n\nOK\n').status, 0));
check('unittest OK with skips is recognized', () => assert.equal(run(floorLines + '\n\nRan 44 tests in 2.199s\n\nOK (skipped=2)\n').status, 0));
const failedUnittest = () => run(floorLines + '\n\nRan 44 tests in 2.2s\n\nFAILED (failures=2)\n');
check('unittest FAILED is contamination', () => { const result = failedUnittest(); assert.notEqual(result.status, 0); assert.match(result.stdout, /오염된 실측/); });
check('unittest failure details are retained', () => assert.match(failedUnittest().stdout, /failures=2/));
check('unknown verdict formats cannot become green', () => { const result = run(floorLines + '\n\n전부 잘 됐습니다\n'); assert.notEqual(result.status, 0); assert.match(result.stdout, /총평/); });
check('absolute runtime paths map to the canonical label', () => { const result = run(floorLines + '\n\n47/47 통과\n', sourceUi); assert.equal(result.status, 0, result.stdout); });
check('runtime symlink aliases map to the same label', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-root-floor-alias-'));
  try { const alias = join(root, 'runtime'); symlinkSync(realpathSync(ROOT), alias, process.platform === 'win32' ? 'junction' : 'dir'); const result = run(floorLines + '\n\n47/47 통과\n', join(alias, sourceUiRel)); assert.equal(result.status, 0, result.stdout); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
check('the retained verdict population is exactly twenty', () => assert.equal(registered, 20));
