/**
 * Pure checker selection from changed paths and the nearest owning subproject.
 * Configuration existence alone never selects a language: only changed files do.
 * All paths are root-relative with forward slashes; the view is injected.
 */

export interface ProjectView {
  exists(relative: string): boolean;
  /** UTF-8 contents of a small configuration file, or undefined when absent/unreadable. */
  read(relative: string): string | undefined;
}
export type Language = 'python' | 'javascript' | 'go' | 'rust';
export type CheckerId = 'ruff' | 'eslint' | 'biome' | 'package-script' | 'go-vet' | 'clippy';
export type ActionKind = 'lint' | 'format' | 'typecheck' | 'test';
export interface Selection {
  /** Stable key `<subproject>#<checker>#<kind>` used for batching and deduplication. */
  id: string; subproject: string; language: Language; checker: CheckerId; kind: ActionKind;
  /** Executable the dispatcher must find before running; absence is an unknown result. */
  tool: string;
  /** Command with argv semantics (no shell), run with cwd = subproject. Paths are subproject-relative. */
  argv: string[];
  paths: string[];
  /** False when the tool cannot be restricted to paths (package scripts, clippy). */
  pathScoped: boolean;
  source: 'project-script' | 'project-config' | 'ecosystem-default';
}
export type GapKind = 'missing-manifest' | 'no-configured-checker' | 'standalone-script' | 'uncertain-path';
export interface Gap {
  kind: GapKind; language?: Language; subproject?: string; paths: string[]; message: string;
  /** A proposal that needs separate user authorization before any file is created. */
  offer?: 'create-pyproject' | 'create-package-json' | 'configure-linter';
}
export interface SelectionResult { selections: Selection[]; gaps: Gap[]; ignored: string[]; }
export interface SelectOptions { formatOptIn?: boolean; }

const EXTENSIONS: Record<string, Language> = {
  '.py': 'python', '.pyi': 'python',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'javascript', '.tsx': 'javascript', '.mts': 'javascript', '.cts': 'javascript',
  '.go': 'go', '.rs': 'rust',
};
const MANIFESTS: Record<Language, readonly string[]> = {
  python: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  javascript: ['package.json'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
};
const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml'];
const BIOME_CONFIGS = ['biome.json', 'biome.jsonc'];
const PYTHON_PROJECT_SIGNS = ['requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg', 'uv.lock', 'poetry.lock'];

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirname = (rel: string) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
const extname = (rel: string) => { const base = rel.slice(rel.lastIndexOf('/') + 1); const i = base.lastIndexOf('.'); return i <= 0 ? '' : base.slice(i).toLowerCase(); };
function ancestors(dir: string): string[] {
  const out = [dir]; while (dir) { dir = dirname(dir); out.push(dir); } return out;
}
const relativeTo = (sub: string, rel: string) => (sub ? rel.slice(sub.length + 1) : rel);

/** Normalize a root-relative path; undefined when it is absolute, escapes, or is unclear. */
export function normalizeRelative(input: string): string | undefined {
  if (!input || input.includes('\0') || /^[A-Za-z]:/.test(input) || input.startsWith('/') || input.startsWith('\\')) return undefined;
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return undefined;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : undefined;
}
export function classifyPath(relative: string): Language | undefined { return EXTENSIONS[extname(relative)]; }

/** Nearest ancestor directory (including the file's own directory) holding a manifest for the language. */
export function findSubproject(relative: string, language: Language, view: ProjectView): string | undefined {
  for (const dir of ancestors(dirname(relative))) if (MANIFESTS[language].some(m => view.exists(join(dir, m)))) return dir;
  return undefined;
}
/** Search from the subproject up to the root; monorepos often keep lint config at the root. */
function findUp(start: string, names: readonly string[], view: ProjectView): string | undefined {
  for (const dir of ancestors(start)) for (const name of names) if (view.exists(join(dir, name))) return join(dir, name);
  return undefined;
}
function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined; } catch { return undefined; }
}
function packageRunner(sub: string, view: ProjectView): string {
  if (findUp(sub, ['pnpm-lock.yaml'], view)) return 'pnpm';
  if (findUp(sub, ['yarn.lock'], view)) return 'yarn';
  if (findUp(sub, ['bun.lock', 'bun.lockb'], view)) return 'bun';
  return 'npm';
}

interface Group { language: Language; subproject: string; paths: string[]; }
type Choose = (group: Group, view: ProjectView, options: SelectOptions) => { selections: Omit<Selection, 'id'>[]; gaps: Gap[] };

const choosePython: Choose = ({ subproject, paths }, view, options) => {
  const rel = paths.map(p => relativeTo(subproject, p));
  const pyproject = view.read(join(subproject, 'pyproject.toml'));
  const ruffConfig = findUp(subproject, ['ruff.toml', '.ruff.toml'], view)
    ?? (pyproject !== undefined && /^\s*\[tool\.ruff(\.|\])/m.test(pyproject) ? join(subproject, 'pyproject.toml') : undefined);
  const gaps: Gap[] = [];
  if (pyproject === undefined) gaps.push({ kind: 'missing-manifest', language: 'python', subproject, paths, offer: 'create-pyproject',
    message: `Python subproject '${subproject || '.'}' has no pyproject.toml; offer to create one after examining its Python version, dependencies, and layout` });
  if (!ruffConfig) {
    gaps.push({ kind: 'no-configured-checker', language: 'python', subproject, paths, offer: 'configure-linter',
      message: `no Ruff configuration found for '${subproject || '.'}'; lint result is unknown, not a pass` });
    return { selections: [], gaps };
  }
  const selections: Omit<Selection, 'id'>[] = [{ subproject, language: 'python', checker: 'ruff', kind: 'lint', tool: 'ruff', argv: ['ruff', 'check', '--', ...rel], paths, pathScoped: true, source: 'project-config' }];
  if (options.formatOptIn) selections.push({ subproject, language: 'python', checker: 'ruff', kind: 'format', tool: 'ruff', argv: ['ruff', 'format', '--', ...rel], paths, pathScoped: true, source: 'project-config' });
  return { selections, gaps };
};

const chooseJavaScript: Choose = ({ subproject, paths }, view, options) => {
  const rel = paths.map(p => relativeTo(subproject, p));
  const pkg = parseJson(view.read(join(subproject, 'package.json')));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts as Record<string, unknown> : {};
  const runner = packageRunner(subproject, view);
  const selections: Omit<Selection, 'id'>[] = [];
  if (typeof scripts.lint === 'string') {
    selections.push({ subproject, language: 'javascript', checker: 'package-script', kind: 'lint', tool: runner, argv: [runner, 'run', 'lint'], paths, pathScoped: false, source: 'project-script' });
  } else if (findUp(subproject, BIOME_CONFIGS, view)) {
    selections.push({ subproject, language: 'javascript', checker: 'biome', kind: 'lint', tool: 'npx', argv: ['npx', '--no-install', 'biome', 'lint', '--', ...rel], paths, pathScoped: true, source: 'project-config' });
  } else if (findUp(subproject, ESLINT_CONFIGS, view) || (pkg && 'eslintConfig' in pkg)) {
    selections.push({ subproject, language: 'javascript', checker: 'eslint', kind: 'lint', tool: 'npx', argv: ['npx', '--no-install', 'eslint', '--', ...rel], paths, pathScoped: true, source: 'project-config' });
  }
  if (typeof scripts.typecheck === 'string') selections.push({ subproject, language: 'javascript', checker: 'package-script', kind: 'typecheck', tool: runner, argv: [runner, 'run', 'typecheck'], paths, pathScoped: false, source: 'project-script' });
  if (options.formatOptIn && typeof scripts.format === 'string') selections.push({ subproject, language: 'javascript', checker: 'package-script', kind: 'format', tool: runner, argv: [runner, 'run', 'format'], paths, pathScoped: false, source: 'project-script' });
  const gaps: Gap[] = selections.some(s => s.kind === 'lint') ? [] : [{ kind: 'no-configured-checker', language: 'javascript', subproject, paths, offer: 'configure-linter',
    message: `no lint script, Biome, or ESLint configuration found for '${subproject || '.'}'; lint result is unknown, not a pass` }];
  return { selections, gaps };
};

const chooseGo: Choose = ({ subproject, paths }) => {
  const packages = [...new Set(paths.map(p => dirname(relativeTo(subproject, p))))].sort().map(d => (d ? `./${d}` : '.'));
  return { selections: [{ subproject, language: 'go', checker: 'go-vet', kind: 'lint', tool: 'go', argv: ['go', 'vet', ...packages], paths, pathScoped: true, source: 'ecosystem-default' }], gaps: [] };
};

const chooseRust: Choose = ({ subproject, paths }) => ({
  selections: [{ subproject, language: 'rust', checker: 'clippy', kind: 'lint', tool: 'cargo', argv: ['cargo', 'clippy', '--no-deps', '--quiet'], paths, pathScoped: false, source: 'ecosystem-default' }], gaps: [],
});

const CHOOSERS: Record<Language, Choose> = { python: choosePython, javascript: chooseJavaScript, go: chooseGo, rust: chooseRust };

/** Missing manifest: a Python file with project signs is a project; a lone script is not. */
function orphanGap(language: Language, paths: string[], view: ProjectView): Gap {
  if (language === 'python') {
    const dir = dirname(paths[0]!);
    const projectLike = PYTHON_PROJECT_SIGNS.some(name => findUp(dir, [name], view) !== undefined) || paths.some(p => view.exists(join(dirname(p), '__init__.py')));
    return projectLike
      ? { kind: 'missing-manifest', language, paths, offer: 'create-pyproject', message: 'Python files without pyproject.toml; offer to create one after examining the existing Python version, packages, dependencies, and layout' }
      : { kind: 'standalone-script', language, paths, message: 'standalone Python script without a project manifest; no package scaffolding is required and no lint result is claimed' };
  }
  const manifest = MANIFESTS[language][0]!;
  return { kind: 'missing-manifest', language, paths, ...(language === 'javascript' ? { offer: 'create-package-json' as const } : {}),
    message: `${language} files without ${manifest}; configured checks cannot be selected and no lint result is claimed` };
}

export function selectCheckers(changedPaths: readonly string[], view: ProjectView, options: SelectOptions = {}): SelectionResult {
  const groups = new Map<string, Group>(); const orphans = new Map<Language, string[]>();
  const gaps: Gap[] = []; const ignored: string[] = []; const uncertain: string[] = [];
  for (const input of changedPaths) {
    const rel = normalizeRelative(input);
    if (!rel) { uncertain.push(input); continue; }
    const language = classifyPath(rel);
    if (!language) { ignored.push(rel); continue; }
    const subproject = findSubproject(rel, language, view);
    if (subproject === undefined) { orphans.set(language, [...(orphans.get(language) ?? []), rel]); continue; }
    const key = `${language}\0${subproject}`;
    const group = groups.get(key) ?? { language, subproject, paths: [] };
    if (!group.paths.includes(rel)) group.paths.push(rel);
    groups.set(key, group);
  }
  if (uncertain.length) gaps.push({ kind: 'uncertain-path', paths: uncertain, message: 'some changed paths could not be resolved inside the project; no check is claimed for them' });
  const selections: Selection[] = [];
  for (const group of [...groups.values()].sort((a, b) => a.subproject.localeCompare(b.subproject) || a.language.localeCompare(b.language))) {
    group.paths.sort();
    const chosen = CHOOSERS[group.language](group, view, options);
    for (const s of chosen.selections) selections.push({ ...s, id: `${s.subproject || '.'}#${s.checker}#${s.kind}` });
    gaps.push(...chosen.gaps);
  }
  for (const [language, paths] of orphans) gaps.push(orphanGap(language, paths.sort(), view));
  return { selections, gaps, ignored: ignored.sort() };
}

/** Root-relative configuration and lock paths relevant to the selected subprojects, for fingerprinting. */
export function relevantConfigPaths(result: SelectionResult, view: ProjectView): string[] {
  const names = ['pyproject.toml', 'setup.cfg', 'setup.py', 'ruff.toml', '.ruff.toml', 'package.json', ...BIOME_CONFIGS, ...ESLINT_CONFIGS,
    'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'clippy.toml', 'uv.lock', 'poetry.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'];
  const out = new Set<string>();
  const subs = new Set([...result.selections.map(s => s.subproject), ...result.gaps.flatMap(g => (g.subproject !== undefined ? [g.subproject] : []))]);
  for (const sub of subs) for (const dir of ancestors(sub)) for (const name of names) if (view.exists(join(dir, name))) out.add(join(dir, name));
  return [...out].sort();
}
