import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { c as archive } from 'tar';
import { unpackBundle } from '../cli/download.js';
import { buildPackage, checkPackage, digestFiles, discoverMembership, safeRelative, validatePortableTargets, writeJson } from './build.js';
import { sourcePath } from '../runtime/skill_catalog.js';
import { initializeSnapshot } from './run_contracts.js';
import { inspectPublic } from './check_public.js';

function fixture() {
  const box = mkdtempSync(join(tmpdir(), 'jstack-builder-')), source = join(box, 'source');
  mkdirSync(join(source, 'skills/example'), { recursive: true });
  writeFileSync(join(source, 'skills/example/SKILL.md'), '---\nname: example\ndescription: Example capability\n---\n\nExample\n');
  writeJson(join(source, 'packaging/product.json'), { name: 'jstack', version: '0.0.1', description: 'Example', author: { name: 'jstack' } });
  mkdirSync(join(source, 'runtime')); writeFileSync(join(source, 'runtime/profiles.ts'), 'export const present: boolean = true;\n');
  writeJson(join(source, 'packaging/package-files.json'), discoverMembership(source));
  return { box, source, output: join(box, 'output') };
}
test('dashboard installs the native Codex body and preserves the Claude renderer entry', async () => {
  const f = fixture();
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  try {
    for (const path of ['skills/dashboard/SKILL.md', 'hosts/codex/skills/dashboard/SKILL.md']) {
      const target = join(f.source, path);
      mkdirSync(join(target, '..'), { recursive: true });
      const original = readFileSync(sourcePath(repository, path), 'utf8');
      writeFileSync(target, original);
    }
    writeJson(join(f.source, 'packaging/package-files.json'), discoverMembership(f.source));
    await buildPackage(f.source, f.output);
    const claude = readFileSync(join(f.output, 'entries/claude/dashboard/SKILL.md'), 'utf8');
    const codex = readFileSync(join(f.output, 'entries/codex/dashboard/SKILL.md'), 'utf8');
    assert.match(claude, /scripts\/install-statusline\.mjs install/);
    assert.match(codex, /# Dashboard — Codex native statusline/);
    assert.match(codex, /\$CODEX_HOME\/config\.toml/);
    assert.match(codex, /status_line = \["model", "context-remaining", "git-branch"\]/);
    assert.doesNotMatch(codex, /scripts\/install-statusline\.mjs install|Codex has no\s+statusline/);
    assert.equal(JSON.parse(readFileSync(join(f.output, '.codex-plugin/plugin.json'), 'utf8')).skills, './entries/codex');
    assert.deepEqual(JSON.parse(readFileSync(join(f.output, '.claude-plugin/plugin.json'), 'utf8')).skills, ['./entries/claude']);
    assert.equal(checkPackage(f.output).passed, true);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('built portable package contains compiled runtime and runnable Node-only inspectors', async () => {
  const f = fixture();
  try {
    const result = await buildPackage(f.source, f.output);
    assert.equal(result.publicSkills, 1); assert.equal(checkPackage(f.output).passed, true);
    const probe = spawnSync(process.execPath, [join(f.output, 'entries/claude/example/scripts/inspect-root.mjs')], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const observed = JSON.parse(probe.stdout); assert.equal(observed.runtimePresent, true); assert.equal(observed.sourcePresent, true);
    const vendors = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const yaml = await import(pathToFileURL(root + '/yaml.mjs'));
      if (!yaml.isMap(yaml.parseDocument('key: value').contents)) throw new Error('YAML named exports are unavailable');
      const ts = await import(pathToFileURL(root + '/typescript.mjs'));
      if (!ts.default.createSourceFile('test.ts', 'export const x = 1;', ts.default.ScriptTarget.Latest).statements.length) throw new Error('TypeScript parser unavailable');
      for (const name of ['tar', 'fflate', '@xmldom/xmldom']) await import(pathToFileURL(root + '/' + name + '.mjs'));
    `, join(f.output, 'payload/runtime/vendor')], { encoding: 'utf8' });
    assert.equal(vendors.status, 0, vendors.stderr);
    assert.equal(existsSync(join(f.output,'payload/runtime/profiles.ts')),false);
    const receiptPath=join(f.output,'package-receipt.json'),receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    assert.equal(receipt.runtimeSourcePolicy,'compiled-only');
    // Earlier v2 bundles included their TS sources and did not have this flag.
    cpSync(join(f.source,'runtime/profiles.ts'),join(f.output,'payload/runtime/profiles.ts'));delete receipt.runtimeSourcePolicy;receipt.files=digestFiles(f.output);writeJson(receiptPath,receipt);assert.equal(checkPackage(f.output).passed,true);
    receipt.runtimeSourcePolicy='unrecognized';writeJson(receiptPath,receipt);assert.throws(()=>checkPackage(f.output),/runtime source policy/);delete receipt.runtimeSourcePolicy;writeJson(receiptPath,receipt);
    chmodSync(join(f.output, 'payload/runtime/profiles.js'), 0o600);
    assert.equal(checkPackage(f.output).passed, true, 'v2 receipt must be independent of host permissions');
    writeFileSync(join(f.output, 'payload/runtime/profiles.js'), 'tampered');
    assert.throws(() => checkPackage(f.output), /receipt/);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('membership drift, missing members and privacy fail before publication', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, 'runtime/undeclared.txt'), 'new');
    await assert.rejects(buildPackage(f.source, f.output), /Membership drift/);
    assert.equal(existsSync(f.output), false);
    rmSync(join(f.source, 'runtime/undeclared.txt'));
    writeFileSync(join(f.source, 'runtime/profiles.ts'), 'export const secret = "synthetic-private-comparison";');
    await assert.rejects(buildPackage(f.source, f.output, ['synthetic-private-comparison']), /Publication boundary/);
    assert.equal(existsSync(f.output), false);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('an authored JavaScript replacement excludes its legacy Python control from native delivery', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, 'runtime/count.py'), 'raise RuntimeError("legacy only")\n');
    writeFileSync(join(f.source, 'runtime/count.js'), 'export const count = text => [...text].length;\n');
    writeJson(join(f.source, 'packaging/package-files.json'), discoverMembership(f.source));
    await buildPackage(f.source, f.output);
    assert.equal(existsSync(join(f.output, 'payload/runtime/count.py')), false);
    const runtime = await import(pathToFileURL(join(f.output, 'payload/runtime/count.js')).href);
    assert.equal(runtime.count('가😀'), 2);
    assert.equal(checkPackage(f.output).passed, true);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('unsafe paths, escaping links and duplicate portable names fail closed', async () => {
  for (const path of ['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'a/./b', '']) assert.throws(() => safeRelative(path));
  const f = fixture();
  try {
    assert.throws(() => validatePortableTargets([{source:'a',target:'runtime/profiles.ts'}, {source:'b',target:'runtime/Profiles.ts'}]), /Duplicate or nonportable/);
    assert.throws(() => validatePortableTargets([{source:'runtime/a.ts',target:'runtime/a.ts'}, {source:'runtime/a.js',target:'runtime/a.js'}]), /shadows/);
    if (process.platform !== 'win32') {
      symlinkSync(f.box, join(f.source, 'runtime/outside'));
      assert.throws(() => discoverMembership(f.source), /source link/);
    }
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('public scanner reports only categories, never matched secrets', () => {
  const box = mkdtempSync(join(tmpdir(), 'jstack-public-'));
  try {
    assert.equal(inspectPublic(box).passed, false);
    const value = 'synthetic-' + 'private-value'; writeFileSync(join(box, 'data.txt'), value);
    const result = inspectPublic(box, [value]);
    assert.equal(result.passed, false); assert.equal(JSON.stringify(result).includes(value), false);
    rmSync(join(box, 'data.txt'));
    writeFileSync(join(box, 'credentials.json'), '{}'); assert.equal(inspectPublic(box).passed, false);
  } finally { rmSync(box, { recursive: true, force: true }); }
});

test('copied validation template carries its standalone parser and license', async () => {
  const f = fixture();
  try {
    const template = 'skills/author/references/templates/validation-hook-template';
    const sourceTemplate = sourcePath(fileURLToPath(new URL('../../', import.meta.url)), template);
    cpSync(sourceTemplate, join(f.source, template), { recursive: true });
    writeFileSync(join(f.source, 'skills/author/SKILL.md'), '---\nname: author\ndescription: Author template fixture\n---\nUse the validation template.\n');
    writeJson(join(f.source, 'packaging/package-files.json'), discoverMembership(f.source));
    await buildPackage(f.source, f.output);
    const standalone = join(f.box, 'standalone');
    cpSync(join(f.output, 'payload', template), standalone, { recursive: true });
    rmSync(f.output, { recursive: true }); rmSync(f.source, { recursive: true });
    assert.equal(existsSync(join(standalone, 'toml.LICENSE')), true);
    writeFileSync(join(standalone, 'pyproject.toml'), '[tool.claude-hooks]\nseverity="warning"\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', 'const m = await import(process.argv[1]); console.log(m.load_hook_config().severity);', pathToFileURL(join(standalone, 'validate_template.js')).href], { cwd: standalone, encoding: 'utf8', env: { ...process.env, HOOK_SEVERITY: '' } });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), 'warning');
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});

test('disposable snapshot disables inherited automatic maintenance before worker copies', () => {
  const box = mkdtempSync(join(tmpdir(), 'jstack-snapshot-gc-')), runtime = join(box, 'jstack');
  try {
    mkdirSync(runtime); writeFileSync(join(runtime, 'example'), 'immutable input');
    const config = join(box, 'global.gitconfig'); writeFileSync(config, '[gc]\n  auto = 1\n[maintenance]\n  auto = true\n');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: config };
    const head = initializeSnapshot(runtime, env, join(box, 'empty-hooks'));
    assert.match(head, /^[a-f0-9]{40}$/);
    const value = (name: string) => spawnSync('git', ['config', '--get', name], { cwd: runtime, env, encoding: 'utf8' }).stdout.trim();
    assert.equal(value('gc.auto'), '0'); assert.equal(value('maintenance.auto'), 'false');
    assert.equal(readFileSync(config, 'utf8'), '[gc]\n  auto = 1\n[maintenance]\n  auto = true\n');
  } finally { rmSync(box, { recursive: true, force: true }); }
});
/** A fixture with the payload launcher, the three hook files and both PATH hook modules. */
function launcherFixture(codexCommand = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/link-jst.js"', claudeCommand = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/jst-path.js"') {
  const f = fixture();
  for (const dir of ['hosts/claude/bin', 'hosts/claude/hooks', 'hosts/codex/hooks']) mkdirSync(join(f.source, dir), { recursive: true });
  writeFileSync(join(f.source, 'hosts/claude/bin/jst'), '#!/bin/sh\n'); chmodSync(join(f.source, 'hosts/claude/bin/jst'), 0o755);
  writeJson(join(f.source, 'hosts/claude/hooks/hooks.json'), { hooks: {} });
  writeFileSync(join(f.source, 'hosts/codex/hooks/link-jst.ts'), 'export const linked: boolean = true;\n');
  writeFileSync(join(f.source, 'hosts/claude/hooks/jst-path.ts'), 'export const persisted: boolean = true;\n');
  writeJson(join(f.source, 'hosts/claude/hooks/claude-hooks.json'), { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: claudeCommand }] }] } });
  writeJson(join(f.source, 'hosts/codex/hooks/codex-hooks.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: codexCommand }] }] } });
  writeJson(join(f.source, 'packaging/package-files.json'), discoverMembership(f.source));
  return f;
}
test('the payload launcher keeps its execute bit, the root has no bin/, and Codex names both hook files', async () => {
  const f = launcherFixture();
  try {
    await buildPackage(f.source, f.output);
    // Windows reports no execute bits, so the check must not fail a package checked there.
    assert.equal(checkPackage(f.output).passed, true);
    assert.equal(existsSync(join(f.output, 'bin')), false, 'claude.ai and Cowork refuse a plugin with a top-level bin/');
    assert.equal(existsSync(join(f.output, 'payload/bin/jst')), true);
    assert.deepEqual(JSON.parse(readFileSync(join(f.output, '.codex-plugin/plugin.json'), 'utf8')).hooks, ['./hooks/hooks.json', './hooks/codex-hooks.json']);
    // Claude merges its manifest's hook file with hooks/hooks.json; Codex reads only the files its own manifest names.
    assert.equal(JSON.parse(readFileSync(join(f.output, '.claude-plugin/plugin.json'), 'utf8')).hooks, './hooks/claude-hooks.json');
    assert.match(readFileSync(join(f.output, 'hooks/claude-hooks.json'), 'utf8'), /\$\{CLAUDE_PLUGIN_ROOT\}\/payload\/hooks\/jst-path\.js/);
    assert.match(readFileSync(join(f.output, 'hooks/codex-hooks.json'), 'utf8'), /\$\{CLAUDE_PLUGIN_ROOT\}\/payload\/hooks\/link-jst\.js/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(f.output, 'payload/bin/jst')).mode & 0o777, 0o755);
      // An npm bundle unpacks without chmod, so the umask decides the group and other bits.
      const stage = join(f.box, 'npm'), archived = join(f.box, 'jstack.tgz');
      cpSync(f.output, join(stage, 'package/dist/bundle/jstack'), { recursive: true });
      await archive({ cwd: stage, file: archived, gzip: true, portable: true }, ['package/dist/bundle/jstack']);
      const bytes = readFileSync(archived), integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      for (const [mask, mode] of [[0o027, 0o750], [0o077, 0o700]]) {
        const previous = process.umask(mask);
        try {
          const unpacked = await unpackBundle(bytes, integrity, false);
          try { assert.equal(statSync(join(unpacked.sourceRoot, 'payload/bin/jst')).mode & 0o777, mode); } finally { unpacked.dispose(); }
        } finally { process.umask(previous); }
      }
      chmodSync(join(f.output, 'payload/bin/jst'), 0o644);
      assert.throws(() => checkPackage(f.output), /payload\/bin\/jst is missing or not executable/);
      chmodSync(join(f.output, 'payload/bin/jst'), 0o755);
    }
    mkdirSync(join(f.output, 'bin')); writeFileSync(join(f.output, 'bin', 'jst'), '#!/bin/sh\n');
    assert.throws(() => checkPackage(f.output), /top-level bin\/ directory, which claude\.ai and Cowork refuse/);
    rmSync(join(f.output, 'bin'), { recursive: true });
    rmSync(join(f.output, 'payload/bin/jst'));
    assert.throws(() => checkPackage(f.output), /payload\/bin\/jst is missing or not executable/);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('a plugin hook command that runs no shipped module fails the build', async () => {
  // Only ${CLAUDE_PLUGIN_ROOT} is rewritten to the payload, so a ${PLUGIN_ROOT} command would point at nothing.
  const cases: [string | undefined, string | undefined, string][] = [
    ['node "${CLAUDE_PLUGIN_ROOT}/hooks/renamed.js"', undefined, 'Codex'], ['python3 "${CLAUDE_PLUGIN_ROOT}/hooks/link-jst.js"', undefined, 'Codex'],
    ['node "${PLUGIN_ROOT}/hooks/link-jst.js"', undefined, 'Codex'], [undefined, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/renamed.js"', 'Claude'],
  ];
  for (const [codex, claude, host] of cases) {
    const f = launcherFixture(codex, claude);
    try { await assert.rejects(buildPackage(f.source, f.output), new RegExp(`Registered ${host} hook does not run a shipped module`)); }
    finally { rmSync(f.box, { recursive: true, force: true }); }
  }
});
/** launcherFixture plus a mod under hosts/claude/mods and module lists for the three hook files. */
function modFixture(claude: unknown, shared?: unknown, codex?: unknown) {
  const f = launcherFixture();
  mkdirSync(join(f.source, 'hosts/claude/mods/viewer/hooks'), { recursive: true });
  writeFileSync(join(f.source, 'hosts/claude/mods/viewer/hooks/viewer.tsx'), "import { helper } from './helper.ts'\nexport const register = () => helper\n");
  writeFileSync(join(f.source, 'hosts/claude/mods/viewer/hooks/helper.ts'), 'export const helper: number = 1\n');
  writeJson(join(f.source, 'hosts/claude/mods/viewer/hooks/hooks.json'), { modules: ['./viewer.tsx'] });
  const add = (rel: string, modules: unknown) => { const path = join(f.source, rel); writeJson(path, { ...JSON.parse(readFileSync(path, 'utf8')), modules }); };
  add('hosts/claude/hooks/claude-hooks.json', claude);
  if (shared !== undefined) add('hosts/claude/hooks/hooks.json', shared);
  if (codex !== undefined) add('hosts/codex/hooks/codex-hooks.json', codex);
  writeJson(join(f.source, 'packaging/package-files.json'), discoverMembership(f.source));
  return f;
}
test('a mod ships uncompiled in the payload and the Claude hook file loads it', async () => {
  const f = modFixture(['../payload/mods/viewer/hooks/viewer.tsx']);
  try {
    await buildPackage(f.source, f.output);
    assert.equal(checkPackage(f.output).passed, true);
    // The engine loads a mod's TypeScript itself; a compiled sibling would be a second, unreviewed copy.
    assert.equal(readFileSync(join(f.output, 'payload/mods/viewer/hooks/helper.ts'), 'utf8'), 'export const helper: number = 1\n');
    assert.equal(existsSync(join(f.output, 'payload/mods/viewer/hooks/helper.js')), false);
    assert.equal(existsSync(join(f.output, 'mods')), false, 'mods stay in the payload');
    // Module paths resolve from the package-root hooks/ directory that Claude reads.
    assert.deepEqual(JSON.parse(readFileSync(join(f.output, 'hooks/claude-hooks.json'), 'utf8')).modules, ['../payload/mods/viewer/hooks/viewer.tsx']);
  } finally { rmSync(f.box, { recursive: true, force: true }); }
});
test('a hook module that is not a shipped mod file, or one that a Codex-read file declares, fails the build', async () => {
  const viewer = ['../payload/mods/viewer/hooks/viewer.tsx'];
  const cases: [unknown, unknown, unknown, RegExp][] = [
    [['../payload/mods/viewer/hooks/missing.tsx'], undefined, undefined, /Claude hook module is not a shipped mod file/],
    [['../payload/hooks/jst-path.ts'], undefined, undefined, /Claude hook module is not a shipped mod file/],
    [['../payload/mods/viewer/../../runtime/profiles.ts'], undefined, undefined, /Claude hook module is not a shipped mod file/],
    // A shipped file the mod does not declare as its entry point, such as a library it imports.
    [['../payload/mods/viewer/hooks/helper.ts'], undefined, undefined, /not the entry point its mod declares/],
    // Claude Code refuses a second hooks module in one plugin.
    [[...viewer, '../payload/mods/viewer/hooks/helper.ts'], undefined, undefined, /one hooks module per plugin/],
    [[], undefined, undefined, /one hooks module per plugin/],
    [undefined, viewer, undefined, /shared with Codex/],
    [undefined, undefined, viewer, /Only the Claude hook file may declare function-hook modules/],
  ];
  for (const [claude, shared, codex, error] of cases) {
    const f = modFixture(claude, shared, codex);
    try { await assert.rejects(buildPackage(f.source, f.output), error); }
    finally { rmSync(f.box, { recursive: true, force: true }); }
  }
});
