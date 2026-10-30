/** Owning suite executes behavior fixtures against the delivered implementation. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { check_contract_coverage } from '../../../../_suite_lib.js';
const file = fileURLToPath(import.meta.url), root = dirname(dirname(file));
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const contracts: Record<string, RegExp[]> = {
  'SKILL.md': [/before destructive action/, /failed\s+measurement is unknown/, /either host and any capable model/, /never schedules cleanup/, /installation fault/, /Do not\s+substitute a Node absolute path/, /present the\s+migration proposal/, /`snapshotTimeoutSeconds`/, /listed under `unmeasured`/, /`partial`[^.]*lower\s+bound/, /vanishes or moves while du walks/, /listed under `notPresent`/, /references\/worktrees\.md/],
  'references/macos.md': [/allocated\s+blocks/, /Deleting a synced\s+file may propagate/, /Do not bypass/],
  'references/containers.md': [/not a verified last-use/, /Named and anonymous volumes can/, /not host space reclaimed/],
  'references/development-caches.md': [/mtime is not last access/, /manifest alone is not a recovery test/, /not substitute raw deletion/],
  'references/installation.md': [/source opens read-only/, /second import is refused/, /aborts the import unchanged/, /No schedule is enabled by plugin installation/, /## CLI on PATH/, /takes precedence when it is on PATH/, /JSTACK_NO_PATH_LINK=1/, /Codex there needs the CLI\s+package/, /link into a jstack\s+plugin cache, its own or one made by hand/, /refuses the plugin launcher/, /not a substitute/, /lists `legacyCollectors`/, /not\s+permission to run them/, /snapshotTimeoutSeconds \(per-category du limit/, /jstack never requests or escalates it/, /owner on this machine has exited/],
  'references/worktrees.md': [/read-only/, /`candidateForUserReview` is `true` only when/, /never\s+"delete this one"/, /Merged by ancestry misses squash and rebase merges/, /Ignored files are not listed/, /without `--force`/, /Do not unlock a locked worktree/],
  'NOTICE': [/explicit request/, /not redistributed/, /rewritten in TypeScript/],
};
for (const [path, patterns] of Object.entries(contracts)) {
  const content = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '';
  check(`${path} preserves its behavior contract`, patterns.every(pattern => pattern.test(content)));
}
// Inside a directory of its own: every SQLite open lists the cache's parent, and the temp directory can be large.
const cacheParent = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-disk-suite-native-')), cache = join(cacheParent, 'sqlite3');
const files = ['measure', 'history', 'snapshot', 'cli', 'cli-history', 'cli-snapshot', 'worktree-audit'].map(name => fileURLToPath(new URL(`./${name}.test.js`, import.meta.url)));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', env: { ...process.env, JSTACK_DISK_TEST_CACHE: cache } });
rmSync(cacheParent, { recursive: true, force: true });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) console.error(result.error.message);
check('disk execution fixtures pass', result.status === 0);
check_contract_coverage(check, file, root, { per_file: Object.fromEntries(Object.keys(contracts).map(path => [path, path === 'SKILL.md' ? 2 : 1])) });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
