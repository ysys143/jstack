#!/usr/bin/env node
/** Read-only Git convention checker. Content quality still needs human review. */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isMain } from '../../../../runtime/entry.js';
import { DEFAULT_CONVENTIONS, ConventionsError, effectiveConventions, describeConflict, recordChoice, loadConventions, type Conventions, type Effective, type Loaded } from '../../../../runtime/conventions.js';

export const SUBJECT_MAX = DEFAULT_CONVENTIONS.subjectMax;
export const BODY_WRAP = DEFAULT_CONVENTIONS.bodyWrap;
export const TYPES = [...DEFAULT_CONVENTIONS.commitTypes];
export const BRANCH_TYPES = [...DEFAULT_CONVENTIONS.branchTypes];
/** Endings a Korean subject takes when the organization asks for an action noun. */
export const KOREAN_ENDINGS = ['추가', '수정', '변경', '제거', '삭제', '개선', '정리', '분리', '이동', '도입', '구현', '적용', '갱신', '반영', '지원', '통합', '작성', '보완', '교체', '최적화', '복구', '해결', '전환', '확장', '처리'];
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
/** Tool advertising and AI co-author lines this repository bans in commits and PR bodies. */
export const BANNED = ['Generated with Claude Code', 'Generated with [Claude Code]', 'Co-Authored-By: Claude', 'Claude-Session:'];
// Git trailer keys are case-insensitive and GitHub honors `Co-authored-by`, so matching
// ignores case and tolerates spaces or tabs around the colon or between words. A phrase
// counts only when it starts a line, after indentation or an emoji (the default footer is
// `<robot emoji> Generated with [Claude Code](...)`), so a message that quotes it mid-line passes.
const LINE_START = '(?:^|\\n)[ \\t\\uFE0F\\u200D\\u2600-\\u27BF\\u2B00-\\u2BFF\\u{1F300}-\\u{1FAFF}]*';
// A `Co-Authored-By` trailer names an AI when its address is at anthropic.com, or when its name is `Claude` alone or
// `Claude` followed only by model words and version numbers. `Claude Monet`, `Claude Shannon` and `Claudette` are people
// and pass. Explicit lookaheads and [0-9] rather than `\b` and `\d` keep this identical to the Python checker.
const AI_NAME = 'Claude(?:[ \\t]+(?:Code|Opus|Sonnet|Haiku|Fable|Instant|[0-9]+(?:\\.[0-9]+)*))*(?=[ \\t]*(?:<|\\r?\\n|\\r?$))';
const AI_ADDRESS = '[^\\n]*?<[^<>\\n]*@anthropic\\.com>';
const AI_CO_AUTHOR = `Co-Authored-By[ \\t]*:[ \\t]*(?:${AI_NAME}|${AI_ADDRESS})`;
const regexEscape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseSource = (phrase: string) => phrase.split(':').map(part => part.trim().split(/ +/).map(regexEscape).join('[ \\t]+')).join('[ \\t]*:[ \\t]*') + (/\w$/.test(phrase) ? '(?![A-Za-z0-9_])' : '');
const PATTERNS = BANNED.map(phrase => new RegExp(LINE_START + (phrase.startsWith('Co-Authored-By') ? AI_CO_AUTHOR : phraseSource(phrase)), 'iu'));
export function bannedPhrases(text: string): string[] { return BANNED.filter((_, index) => PATTERNS[index]!.test(text)); }
const length = (value: string) => [...value].length;
// Python's repr chooses double quotes only when that avoids escaping single quotes.
const repr = (value: string) => {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  return quote + value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replaceAll(quote, '\\' + quote) + quote;
};
const lines = (value: string) => value.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
export function checkMessage(message: string, conventions: Conventions = DEFAULT_CONVENTIONS): string[] {
  const { commitTypes, subjectMax, bodyWrap } = conventions;
  const output: string[] = [], rows = lines(message.trimEnd());
  if (!rows[0]?.trim()) return ['subject is empty'];
  const head = rows[0], match = /^([a-z]+)(?:\(([^)]+)\))?: (.+)$/.exec(head);
  if (!match) output.push(`subject does not match \`<type>(<scope>): <subject>\` — ${repr([...head].slice(0, 60).join(''))}`);
  else {
    if (!commitTypes.includes(match[1]!)) output.push(`type \`${match[1]}\` is outside the convention (allowed: ${commitTypes.join(', ')})`);
    if (length(head) > subjectMax) output.push(`subject is ${length(head)} characters; maximum ${subjectMax} characters`);
    if (match[3]!.endsWith('.')) output.push('subject ends with a period');
    const description = match[3]!.trim();
    if (conventions.commitLanguage === 'ko' && !HANGUL.test(description)) output.push('description is not Korean (commitLanguage=ko)');
    if (conventions.subjectVerbEnding === 'korean' && HANGUL.test(description) && !KOREAN_ENDINGS.some(ending => description.endsWith(ending))) output.push(`Korean description does not end in an action noun such as ${KOREAN_ENDINGS.slice(0, 4).join(', ')}`);
  }
  if (rows.length > 1 && rows[1]!.trim()) output.push('no blank line separates the subject and body');
  for (let index = 2; index < rows.length; index++) {
    const line = rows[index]!;
    if (length(line) > bodyWrap && !/^(```|\||http)/.test(line.trimStart()) && !line.includes('http')) {
      output.push(`line ${index + 1} is ${length(line)} characters; wrap body text at ${bodyWrap}`); break;
    }
  }
  if (conventions.footerStyle === 'resolves') for (const line of rows.slice(2)) if (/^(fixes|closes|resolves)\b:?\s*#\d+/i.test(line.trim()) && !/^Resolves: #\d+/.test(line.trim())) { output.push(`issue footer \`${line.trim()}\` should be written \`Resolves: #<n>\``); break; }
  for (const phrase of bannedPhrases(message)) output.push(`banned phrase: ${repr(phrase)}`);
  return output;
}
export function checkBranch(name: string, conventions: Conventions = DEFAULT_CONVENTIONS): string[] {
  const branchTypes = conventions.branchTypes;
  const output: string[] = [], match = /^([a-z]+)\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9-]+)*)$/.exec(name);
  if (!match) {
    output.push(`branch does not match \`<type>/<kebab-case>\` — ${repr(name)}`);
    if (name.includes('_')) output.push('  use hyphens instead of underscores');
    if (/[A-Z]/.test(name)) output.push('  do not use uppercase letters');
  } else if (!branchTypes.includes(match[1]!)) output.push(`branch type \`${match[1]}\` is outside the convention (allowed: ${branchTypes.join(', ')})`);
  return output;
}
const label = (effective: Effective) => effective.loaded.source === 'default' ? 'default' : `${effective.loaded.source}${effective.loaded.revision ? ` r${effective.loaded.revision}` : ''}${effective.choice ? `, ${effective.choice.choice} chosen here` : ''}`;
export function main(argv = process.argv.slice(2), root = process.cwd()): number {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) {
    console.log('Usage: check_commit [--defaults] --message TEXT | --staged | --branch | --branch-name NAME | --conventions | --choose repository|profile'); return 0;
  }
  const defaults = argv[0] === '--defaults'; if (defaults) argv = argv.slice(1);
  const [mode, value] = argv;
  if (!((['--message', '--branch-name', '--choose'].includes(mode!) && argv.length === 2) || (['--staged', '--branch', '--conventions'].includes(mode!) && argv.length === 1))) {
    console.error('[blocked] choose exactly one of --message, --staged, --branch, --branch-name, --conventions, or --choose'); return 2;
  }
  let loaded: Loaded;
  try { loaded = defaults ? { values: { ...DEFAULT_CONVENTIONS }, source: 'default', warnings: [] } : loadConventions(); }
  catch (error) { if (error instanceof ConventionsError) { console.error(`[blocked] ${error.message}`); return 2; } throw error; }
  for (const warning of loaded.warnings) console.error(`[warn] ${warning}`);
  const effective = effectiveConventions(root, loaded);
  if (mode === '--choose') {
    if (!['repository', 'profile'].includes(value!)) { console.error('[blocked] --choose takes repository or profile'); return 2; }
    try { const record = recordChoice(root, value as 'repository' | 'profile', effective); console.log(`[recorded] ${record.choice} for the commit language in this repository (profile ${record.profile})`); return 0; }
    catch (error) { console.error(`[blocked] ${(error as Error).message}`); return 2; }
  }
  // Only the commit language is in dispute: a message check waits for the user's decision, a branch check does not.
  if (effective.conflict && ['--message', '--staged'].includes(mode!)) { for (const line of describeConflict(effective)) console.log(line); return 3; }
  if (mode === '--conventions') {
    const v = effective.values;
    console.log(`conventions: ${label(effective)}`);
    console.log(`  commit: language ${v.commitLanguage}, types ${v.commitTypes.join(', ')}, subject <= ${v.subjectMax}, body wrap ${v.bodyWrap}, verb ending ${v.subjectVerbEnding}, footer ${v.footerStyle}`);
    console.log(`  branch: <type>/<desc> with ${v.branchTypes.join(', ')}${v.branchScheme === 'folder-category-desc' ? `; the legacy <folder>/<category>/<desc> scheme (${v.branchFolders.join(', ')}) is recorded, not enforced` : ''}`);
    console.log(`  automatic session commits: ${v.autocommitLanguage}`);
    if (effective.conflict) { for (const line of describeConflict(effective)) console.log(line); return 3; }
    return 0;
  }
  const conventions = effective.values;
  let problems: string[], what: string;
  if (mode === '--message') { problems = checkMessage(value!, conventions); what = 'commit message'; }
  else if (mode === '--staged') {
    if (!existsSync('.git/COMMIT_EDITMSG')) { console.error('[blocked] .git/COMMIT_EDITMSG does not exist; no commit is being prepared'); return 2; }
    problems = checkMessage(lines(readFileSync('.git/COMMIT_EDITMSG', 'utf8')).filter(line => !line.startsWith('#')).join('\n'), conventions); what = 'commit message';
  } else {
    let name = value!;
    if (mode === '--branch') {
      const result = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
      if (result.status !== 0) { console.error('[blocked] not a Git repository'); return 2; }
      name = result.stdout.trim();
      if (!name) { console.error('[blocked] no branch (detached HEAD)'); return 2; }
    }
    problems = checkBranch(name, conventions); what = `branch ${name}`;
  }
  // The default output stays byte-identical to the original checker; a profile adds where the rules came from.
  const suffix = effective.loaded.source === 'default' ? '' : ` (conventions: ${label(effective)})`;
  if (problems.length) { console.log(`[convention violation] ${what}${suffix}`); for (const problem of problems) console.log(`  ${problem}`); return 1; }
  console.log(`[pass] ${what}${suffix}`); return 0;
}
if (isMain(import.meta.url)) process.exitCode = main();
