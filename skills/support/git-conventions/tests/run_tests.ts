/** Git conventions owning contracts: actual checker decisions and exact document direction/structure. */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runProcess } from '../../../../runtime/os.js';
import { check_no_constant_assertions, check_total, check_skill_body, check_ref_contracts, split_frontmatter, check_body_deletion, check_contract_coverage, check_script_contracts, type Result } from '../../../_suite_lib.js';
import { truth, length, contains, unique, sorted, repr, at, slice, strip, lstrip, rstrip, split, lines, count, starts, ends, lower, joinText, replace, findall, finditer, search, match, group, sub, isdir, isinstance, temporaryDirectory, removeTree, range, isdigit, enumerate } from '../../../_suite_lib_native.js';
const SUITE_FILE=fileURLToPath(import.meta.url),ROOT=dirname(dirname(SUITE_FILE)),CHECK=join(ROOT,'scripts','check_commit.js');
const results:Result[]=[];
function check(name:string,ok:boolean,detail=''):void{results.push([name,ok,detail]);console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);}
const read=(p:string)=>readFileSync(p,'utf8'),write=(p:string,text:string)=>writeFileSync(p,text);
function run(...args:string[]):[number,string]{return run_at(process.cwd(),...args);}
// The checker reads the caller's default profile; a temporary home keeps a developer's own conventions out of these verdicts.
const CHECK_HOME=temporaryDirectory(),CHECK_ENV:NodeJS.ProcessEnv={...process.env,HOME:CHECK_HOME,USERPROFILE:CHECK_HOME};delete CHECK_ENV.JSTACK_PROFILE;delete CHECK_ENV.JSTACK_CONVENTIONS_FILE;process.on("exit",()=>removeTree(CHECK_HOME));
function run_at(cwd:string,...args:string[]):[number,string]{const r=runProcess(process.execPath,[CHECK,...args],{cwd,env:CHECK_ENV});return [r.status??-1,r.stdout+r.stderr];}
function git(cwd:string,...args:string[]){const hooks=join(cwd,'.jstack-empty-hooks');mkdirSync(hooks,{recursive:true});return runProcess('git',['-c','commit.gpgsign=false','-c','core.hooksPath='+hooks,...args],{cwd});}
function cells(line:string):string[]{return strip(line.trim(),'|').split('|').map(c=>c.trim());}
function md_tables(text:string):[string[],string[][]][]{const measured=lines(text),out:[string[],string[][]][]=[];for(let i=0;i<measured.length;i++){const ln=measured[i];if(i===0||!/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(ln))continue;const head=measured[i-1];if(!head.trimStart().startsWith('|'))continue;const prev=i>=2?measured[i-2]:'';if(i>=2&&prev.trim()&&!/^\s*(?:#{1,6}\s|```)/.test(prev))continue;const cols=cells(head);if(cells(ln).length!==cols.length)continue;const rows:string[][]=[];for(let j=i+1;j<measured.length;j++){if(!measured[j].trimStart().startsWith('|'))break;rows.push(cells(measured[j]));}out.push([cols,rows]);}return out;}
function section(text:string,header:string):string{const escaped=header.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('^'+escaped+'\\s*$\\n(.*?)(?=^## |$(?![\\s\\S]))','ms').exec(text)?.[1]??'';}
function doc_sections(input:string):[string,number][]{const text=input.replaceAll('${JSTACK_PLUGIN_ROOT}','${CLAUDE_PLUGIN_ROOT}'),heads=[...text.matchAll(/^## (.+?)\s*$/gm)];return heads.map((m,i)=>[m[1].trim(),Buffer.byteLength(text.slice(m.index,heads[i+1]?.index??text.length),'utf8')]);}
function check_section_lengths(rel:string,text:string):void{const got=doc_sections(text),want=SECTIONS[rel];let detail:string;if(!isDeepStrictEqual(got.map(([h])=>h),want.map(([h]:any)=>h)))detail='section structure differs — '+JSON.stringify(got.map(([h])=>h));else{const diff=got.filter(([,value],i)=>value!==want[i][1]).map(([h,value])=>`${h} ${value}B (expected ${want.find(([head]:any)=>head===h)[1]}B)`);detail=diff.length?diff.join(' · '):`${got.length} sections`;}check(`Structure: ${rel} preserves ${want.length} sections and byte counts`,isDeepStrictEqual(got,want),detail);}
function check_markdown_structure(rel:string,text:string):void{const [blanks,fences]=LAYOUT[rel],got_blank=lines(text).filter(ln=>!ln.trim()).length,got_fence=count(text,'```');check(`Structure: ${rel} paragraph boundaries (${blanks} blank lines, ${fences} fences)`,got_blank===blanks&&got_fence===fences,`blank lines ${got_blank}, code fences ${got_fence}`);const parsed=md_tables(text),want=TABLES[rel];check(`Structure: ${rel} parses ${want.length} tables`,parsed.length===want.length,`${parsed.length} blocks with valid header, separator, and column count`);for(const [i,[cols,rows]] of want.entries()){const got=parsed[i]??null;check(`Structure: ${rel} table ${i+1} \`${cols[0]||'(blank)'}\` row mapping`,isDeepStrictEqual(got,[cols,rows]),got===null?'table missing':`header ${JSON.stringify(got[0])}, ${got[1].length} rows`);}}
const TABLES:any={"SKILL.md": [[["Type", "When"], [["`feat`", "New feature"], ["`fix`", "Bug fix"], ["`refactor`", "Structure changes with no behaviour change"], ["`docs`", "Documentation"], ["`test`", "Tests"], ["`chore`", "Build, config, dependencies"]]], [["The file says", "Then"], [["Required label groups", "Missing one blocks the PR"], ["`rules: []`", "Nothing is enforced; this repository does not label"], ["`enforced: false`", "The evidence was weak — it warns and lets the PR through"]]], [["Task", "Owner"], [["Session wrap-up, retrospective, next steps", "`/wrap` command"], ["Running the commit itself", "`/commit` command"], ["Opening the PR", "`/pr` command"], ["A credential that is already in the repository", "`secrets` skill"], ["Registering the PR policy in a new repository", "`setup` skill"], ["`gh` missing or signed out", "`bridge` skill"]]]], "references/branch.md": [[["Folder", "Description"], [["infra", "Infrastructure work"], ["server", "Backend work"], ["web", "Frontend work"]]], [["Category", "Description"], [["feature", "Add new feature"], ["refactor", "Modify existing code"], ["bug", "Fix bugs"], ["test", "Add or modify tests"], ["docs", "Documentation work"], ["chore", "Non-code changes (build, config, etc.)"], ["hotfix", "Urgent fixes (direct to master)"]]]], "references/commit.md": [[["Type", "Description"], [["feat", "Add new feature"], ["fix", "Fix a bug"], ["refactor", "Improve code structure without changing functionality"], ["test", "Add or update tests"], ["docs", "Update documentation"], ["chore", "Non-code changes (build, package management, etc.)"], ["style", "Code formatting, style changes"], ["remove", "Remove unused code or files"], ["perf", "Performance improvements"]]]], "references/pr.md": [[["Label", "Description"], [["@web", "Web/Frontend related work"], ["@server", "Backend feature addition or modification"], ["@infra", "Infrastructure related work"], ["@database", "Database related work"], ["@agent", "AI Agent related work"], ["@docs", "Documentation related work"]]], [["Label", "Description"], [["feature", "Add new feature"], ["bug", "Fix functional errors"], ["remove", "Remove unnecessary code or files"], ["performance", "Performance improvement"], ["refactoring", "Code refactoring"], ["ci/cd", "CI/CD related work"], ["testing", "Add or modify test code"], ["dependencies", "Dependency management"], ["security", "Security fixes"], ["development", "Development environment setup"], ["documentation", "Add or modify documentation"], ["ignore-for-release", "Exclude from release changelog"]]]], "references/secrets.md": [[["", "`.gitignore`", "`.git/info/exclude`"], [["Scope", "**Whole repository** — committed", "**Local only** — not committed"], ["Use for", "Build artifacts, dependencies, shared secret paths", "Personal editor settings, local scratch files"]]], [["What Git can do", "What Git cannot do"], [["Remove a blob from history (`git filter-repo`, BFG)", "Remove it from existing clones"], ["Rewrite local refs", "Rewrite refs in forks, PRs, or mirrors"], ["Move remote refs with a force push", "Immediately expire commits cached by the forge"]]], [["Tool", "Purpose", "When"], [["**gitleaks**", "**Detect** secrets before commit and in CI", "Start here in most cases"], ["**SOPS**", "**Encrypt and commit** files", "When configuration must contain secrets (k8s, Terraform)"], ["**git-secret**", "Encrypt files with GPG", "Older than SOPS and requires GPG key management"]]]]};
const LAYOUT:any={"SKILL.md": [40, 8], "references/branch.md": [6, 0], "references/commit.md": [20, 10], "references/pr.md": [18, 6], "references/secrets.md": [15, 0]};
const SECTIONS:any={"SKILL.md": [["Why these four together", 286], ["Branches — `<type>/<kebab-case>`", 1289], ["Commits — Conventional Commits", 1686], ["PRs — the repository owns the label rule", 1788], ["Secrets — stop them before the commit", 332], ["Checking", 1658], ["Boundaries", 376], ["Limits (stated)", 689]], "references/branch.md": [["Format", 132], ["Folder (Work Area)", 155], ["Category", 309], ["Examples", 247]], "references/commit.md": [["Constraints (CRITICAL)", 132], ["Format", 130], ["Types", 419], ["Title Rules", 125], ["Body Rules", 204], ["Examples", 216], ["Full Example with Body", 375]], "references/pr.md": [["Constraints (CRITICAL)", 231], ["Format", 346], ["Labels — current repository values (example, not authoritative)", 961], ["Command Usage", 245]], "references/secrets.md": [["`.gitignore` vs `.git/info/exclude`", 437], ["Secrets already committed", 802], ["Toolset — what to choose", 537], ["This repository's rules", 364]]};
const COMMIT_TYPES:any=["feat", "fix", "refactor", "test", "docs", "chore", "style", "remove", "perf"];
const BRANCH_TYPES:any=["feat", "fix", "refactor", "docs", "test", "chore"];
const BANNED:any=["Generated with Claude Code", "Generated with [Claude Code]", "Co-Authored-By: Claude", "Co-authored-by: Claude", "Claude-Session:", "co-authored-by :  claude"];
const L0_SENTENCES:any=["git conventions in one place — branch names, commit messages, PRs, and secret handling.", "A checker verifies the format before you commit and says what is wrong and why.", "Session wrap-up and retrospective belong to the wrap command."];
const L0_TRIGGERS:any=["커밋", "커밋 메시지", "브랜치 만들어", "브랜치명", "PR 올려", "풀리퀘", "PR 설명", "gitignore", "비밀키 커밋", "시크릿 관리", "commit", "branch", "pull request"];
const SKILL_DIRECTION:any=[["branch names omit usernames", "**No usernames** (`jaesol-shin/...` is out). Type and name are separated by a\n**slash** (not `feature-new-plugin`).", ["(?i)usernames are (?:allowed|fine|ok)", "(?i)\\*\\*Usernames\\*\\*"]], ["keeps the two-part form canonical and the three-part form reference-only", "Work branches use the two-part `<type>/<desc>` form that `CLAUDE.md` names as\nthis repository's convention", ["(?i)create new branches in the three-part form", "(?i)the upstream is the canon"]], ["exempts the default branch from type prefixes", "**The default branch is exempt.** `master` carries no type prefix because the\nrule is about *work* branches — there is nothing to name it after.", ["(?i)`master` must carry a type prefix", "(?i)no branch is exempt"]], ["names itself the one owner of the subject length", "This is the one place the subject\nlength is set; other skills and commands point here instead of restating it.", ["(?i)merge commits? may use 72", "(?i)each skill sets its own subject length"]], ["subject is at most 50 characters with no trailing period", "**Subject** — 50 characters or fewer, no trailing period, ends with an action\nverb (add, modify, change, or remove).", ["(?i)50 characters or more", "(?i)at least 50 characters", "(?i)ends with a trailing period", "(?i)a trailing period is fine"]], ["body gives why, then how, wrapped at 72", "**Body** — separated from the subject by a blank line; the first paragraph is\n**why** (problem, motivation), the second is **how** (approach). Wrap at 72.", ["\\*\\*how\\*\\* \\(approach\\), the second is \\*\\*why\\*\\*", "(?i)wrap at 50", "(?i)wrap at 80"]], ["forbids tool advertising and false co-authorship", "**Never advertise the tool, and never add an AI co-author trailer.**\n`Generated with Claude Code` and `Co-Authored-By: Claude ...` are both out,", ["(?i)\\*\\*Always include\\*\\*", "(?i)always include `Generated with Claude Code`", "(?i)advertise the tool freely"]], ["bans harness-added attribution trailers", "including a trailer a harness adds on its own; remove it before committing.", ["(?i)harness requires is exempt", "(?i)the attribution trailer[\\s\\S]{0,40}is exempt"]], ["discloses rules broader than checker behavior", "- The default-branch exemption is stated wider than the checker implements: `--branch` still calls `master` malformed. The gap is in the checker; the rule is what this document says", ["(?i)the checker implements every rule"]], ["does not claim authority over label rules", "**The rule is not written here.**", ["\\*\\*The rule is written here"]], ["distinguishes an absent policy file from an empty one", "**The file must exist before a PR can be opened**, even empty. Empty means\nsomeone decided this repository has no label policy; absent means nobody has\nlooked.", ["(?i)the file may be absent", "(?i)absent means someone decided", "(?i)the two are the same"]], ["gitignore is repository-wide and info/exclude is local", "`.gitignore` is a **repository-wide** rule; `.git/info/exclude` is **local only**.", ["`\\.gitignore` is a? ?\\*\\*local", "`\\.git/info/exclude` is a? ?\\*\\*repository-wide"]], ["history rewriting does not repair a committed secret", "**A secret already committed is not fixed by rewriting history** — revoke and\nreissue it immediately.", ["is fixed by rewriting history", "(?i)rewriting history is enough"]], ["checker evaluates format only", "**The checker sees format** — type, length, banned phrases, branch shape.\nWhether the body actually explains *why* is read by a person.", ["(?i)the checker (?:also )?(?:sees|measures|judges) whether the body"]]];
const REF_DIRECTION:any=[["branch.md", "records the corrected count of three-part branches", "**7 of this repository's 79 remote branches actually use it** (the newest is\nfrom 2026-03-15). An earlier version incorrectly said there were none.", ["(?i)none of this repository's branches use it"]], ["commit.md", "preserves upstream text while applying the same ban", "**The forbidden-phrase rule under `## Constraints` remains verbatim upstream\ntext.** This repository applies the same ban, including to trailers a harness\nadds on its own.", ["(?i)authoritative rule is narrower", "(?i)upstream text was changed", "(?i)trailers required by a harness are exempt"]], ["secrets.md", "preserves the repository's three credential rules", "- **Do not put credentials** (`client_secret.json`, tokens) in the repository.\n  Store them under `~/.config/<tool>-<account>/`.\n- Put API keys in `~/.claude/.env.*` or shell environment variables. `.env`\n  files are covered by `.gitignore`.\n- If a key was committed, follow the `secrets` skill; do not duplicate that\n  procedure here.", ["(?im)^- Put credentials.*in the repository", "(?i)\\.env.*not.*gitignore"]], ["branch.md", "identifies SKILL.md as authoritative", "**`SKILL.md` is authoritative.**", ["(?i)this reference is authoritative"]], ["branch.md", "preserves upstream three-part format and kebab-case", "- All branch names must be in English\n- Use kebab-case for description", ["(?i)must (?:not|never) be in English", "(?i)Use snake_case for description"]], ["commit.md", "preserves the banned-phrase clause", "- NEVER include phrases like `Generated with Claude Code` or `Co-Authored-By: Claude` in commit messages", ["(?i)- ALWAYS include phrases like"]], ["commit.md", "preserves the direction of all three title rules", "- Maximum 50 characters\n- End with an action verb (add, modify, change, remove, etc.)\n- No period at the end", ["(?i)- Maximum 72 characters", "(?i)- Minimum 50 characters", "(?i)- Period at the end", "(?i)- End with a period"]], ["commit.md", "preserves all four body rules in order", "- Separate from title with a blank line\n- First paragraph: WHY (explain the problem or motivation)\n- Second paragraph: HOW (describe the solution approach)\n- Wrap at 72 characters per line", ["(?i)- First paragraph: HOW", "(?i)- Second paragraph: WHY", "(?i)- Wrap at 50 characters", "(?i)- Wrap at 100 characters"]], ["pr.md", "requires both label categories", "- MUST include at least one position label AND one category label via `--label` flag when creating PRs", ["(?i)MUST NOT include at least one", "(?i)at most one position label", "(?i)one position label OR one category label"]], ["pr.md", "states that this document is not authoritative for labels", "**This document is not authoritative for label rules.**", ["(?i)this document is authoritative for label rules"]], ["pr.md", "records why @package was removed", "**`@package` was removed.**", ["(?i)`@package` was retained", "(?i)`@package` was restored"]], ["secrets.md", "does not duplicate the response procedure", "**The response procedure is not duplicated here.**", ["(?i)the response procedure is authoritative here"]], ["secrets.md", "requires revocation before history rewriting", "Because the right column is not empty, **credential revocation comes first**.", ["(?i)history rewriting comes first"]], ["secrets.md", "distinguishes detection from encryption", "**Detection and encryption solve different problems.**", ["(?i)detection and encryption solve the same problem"]], ["secrets.md", "keeps personal settings out of gitignore", "**Do not put personal settings that others do not need in `.gitignore`.**", ["(?im)^\\*\\*Put personal settings.*in `\\.gitignore`"]]];
const COMMIT_ONLY=COMMIT_TYPES.filter((type:string)=>!BRANCH_TYPES.includes(type));
function check_checker_execution():void {
let br:any, lead:any, leaked:any, msg:any, out:any, pad:any, phrase:any, rc:any, refused:any, refused_br:any, st:any, t:any, want:any, why:any, width:any;

(refused=Array.from(COMMIT_TYPES).filter((t: any) => truth((at(run("--message", (repr(t) + ": 무엇을 추가")), 0) !== 0))).map((t: any) => (t)));
check(("Checker: accepts all " + repr(length(COMMIT_TYPES)) + " commit types"), !truth(refused), ("rejected " + repr(refused)));
(refused_br=Array.from(BRANCH_TYPES).filter((t: any) => truth((at(run("--branch-name", (repr(t) + "/x")), 0) !== 0))).map((t: any) => (t)));
check(("Checker: accepts all " + repr(length(BRANCH_TYPES)) + " branch types"), !truth(refused_br), ("rejected " + repr(refused_br)));
(leaked=Array.from(COMMIT_ONLY).filter((t: any) => truth((at(run("--branch-name", (repr(t) + "/x")), 0) !== 1))).map((t: any) => (t)));
check(("Checker: rejects commit-only types " + repr(COMMIT_ONLY) + " as branches"), !truth(leaked), ("accepted " + repr(leaked)));
for (const [pad, want] of [[44, 0], [45, 1]]) {
([rc, out]=run("--message", ("feat: " + "a".repeat(pad))));
check(("Checker: subject-length boundary at " + repr((pad + 6))), (rc === want), ("rc=" + repr(rc) + " (expected " + repr(want) + ")"));
}
([rc, out]=run("--message", ("feat: " + "a".repeat(45))));
check("checker: reveals upper limit 50 when title exceeds", (truth((rc === 1)) && truth((contains(out, "subject is 51 characters; maximum 50 characters")))), slice(strip(out), 0, 70));
for (const [width, want] of [[71, 0], [72, 0], [73, 1]]) {
([rc, out]=run("--message", ("feat: 제목\n\n" + "a".repeat(width))));
check(("Checker: body-line boundary at " + repr(width)), (rc === want), ("rc=" + repr(rc) + " (expected " + repr(want) + ")"));
}
([rc, out]=run("--message", ("feat: 제목\n\n" + "a".repeat(73))));
check("Inspector: Reveals fold width 72 when text exceeds", (truth((rc === 1)) && truth((contains(out, "wrap body text at 72")))), slice(strip(out), 0, 70));
for (const [lead, why] of [["```", "code block"], ["|", "table"], ["http://a.example/", "URL"]]) {
([rc, out]=run("--message", (("feat: 제목\n\n" + lead) + "a".repeat(90))));
check(("Checker: excludes " + repr(why) + " lines from wrapping"), (rc === 0), ("rc=" + repr(rc)));
}
([rc, out]=run("--message", "feat:공백이 없다"));
check("Checker: Catches missing spaces after colons", (truth((rc === 1)) && truth((contains(out, "subject does not match")))), ("rc=" + repr(rc)));
([rc, out]=run("--message", "feat(plugins): 무엇을 추가"));
check("Inspector: Passes normal titles with scope", (rc === 0), ("rc=" + repr(rc)));
for (const phrase of BANNED) {
([rc, out]=run("--message", ("feat: 추가\n\n본문\n\n" + phrase)));
check(("Checker: rejects banned phrase " + repr(phrase)), (truth((rc === 1)) && truth((contains(out, "banned phrase")))), ("rc=" + repr(rc)));
}
([rc, out]=run("--message", "feat: 추가\n\n본문\n\n문서가 Co-Authored-By: Claude 줄과 Generated with Claude Code 푸터를 인용한다"));
check("Checker: a banned phrase quoted mid-line is not a trailer or footer", (rc === 0), ("rc=" + repr(rc)));
for (const person of ["Claude Monet <claude@example.com>", "Claude Debussy <cd@example.com>", "Claude Shannon <cs@example.com>", "Claudette <c@example.com>", "Claude-Louis Navier <cl@example.com>"]) {
([rc, out]=run("--message", ("feat: 추가\n\n본문\n\nCo-authored-by: " + person)));
check(("Checker: a human co-author named Claude is not an AI trailer: " + repr(person)), (rc === 0), ("rc=" + repr(rc)));
}
([rc, out]=run("--message", "feat: 추가\n\n본문\n\nCo-Authored-By: Monet <x@anthropic.com>"));
check("Checker: an anthropic.com address makes any co-author name an AI trailer", (truth((rc === 1)) && truth((contains(out, "banned phrase")))), ("rc=" + repr(rc)));
([rc, out]=run("--message", "feat: 추가\n\n본문\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)"));
check("Checker: rejects the default footer with its leading emoji", (truth((rc === 1)) && truth((contains(out, "banned phrase")))), ("rc=" + repr(rc)));
(st=temporaryDirectory());
try {
([rc, out]=run_at(st, "--staged"));
check("Inspector: --staged breaks COMMIT_EDITMSG absence (rc=2)", (truth((rc === 2)) && truth((contains(out, "no commit is being prepared")))), ("rc=" + repr(rc)));
mkdirSync(join(st, ".git"),{recursive:true});
(msg=join(st, ".git", "COMMIT_EDITMSG"));
write(msg, "feat: 무엇을 추가\n# 이 줄은 주석이다\n");
([rc, out]=run_at(st, "--staged"));
check("checker: --staged passes correct messages", (truth((rc === 0)) && truth((contains(out, "[pass]")))), ("rc=" + repr(rc)));
write(msg, "Feat: 대문자 타입\n");
([rc, out]=run_at(st, "--staged"));
check("Checker: --staged catches format violations", (truth((rc === 1)) && truth((contains(out, "[convention violation]")))), ("rc=" + repr(rc)));
write(msg, "feat: 추가\n\n본문\n\nCo-authored-by: Claude\n");
([rc, out]=run_at(st, "--staged"));
check("Inspector: --staged catches prohibited phrases", (truth((rc === 1)) && truth((contains(out, "banned phrase")))), ("rc=" + repr(rc)));
write(msg, (("feat: 무엇을 추가\n\n본문\n# " + "가".repeat(90)) + "\n"));
([rc, out]=run_at(st, "--staged"));
check("Inspector: --staged excludes `#` comment lines from inspection", (rc === 0), ("rc=" + repr(rc)));
} finally {
removeTree(st, {ignore_errors: true});
}
(br=temporaryDirectory());
try {
([rc, out]=run_at(br, "--branch"));
check("Checker: --branch breaks outside the repository with a break (rc=2)", (truth((rc === 2)) && truth((contains(out, "not a Git repository")))), ("rc=" + repr(rc)));
git(br, "init", "-q", ".");
git(br, "checkout", "-q", "-b", "feat/ok");
([rc, out]=run_at(br, "--branch"));
check("checker: --branch passes the current branch that conforms to the convention", (truth((rc === 0)) && truth((contains(out, "feat/ok")))), ("rc=" + repr(rc)));
git(br, "checkout", "-q", "-b", "Bad_Branch");
([rc, out]=run_at(br, "--branch"));
check("Checker: --branch catches current branch violations", (truth((rc === 1)) && truth((contains(out, "use hyphens instead of underscores"))) && truth((contains(out, "do not use uppercase letters")))), ("rc=" + repr(rc)));
git(br, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "chore: 빈 커밋");
git(br, "checkout", "-q", "--detach", "HEAD");
([rc, out]=run_at(br, "--branch"));
check("checker: --branch breaks detached HEAD into a break (rc=2)", (truth((rc === 2)) && truth((contains(out, "detached HEAD")))), ("rc=" + repr(rc)));
} finally {
removeTree(br, {ignore_errors: true});
}
([rc, out]=run());
check("Checker: If you do not select a branch, it stops with a usage error (rc=2)", (truth((rc === 2)) && truth((contains(out, "--branch-name")))), ("rc=" + repr(rc)));
}
function main():number {
let META:any, NAME:any, _:any, br:any, fm:any, fn:any, ghost:any, gone:any, header:any, hits:any, label:any, live_ran:any, missing:any, msg:any, n:any, negatives:any, ok:any, ok_want:any, out3:any, out4:any, part:any, passed:any, positive:any, quoted:any, r:any, rc:any, rc2:any, rc3:any, rc4:any, rc5:any, rcb:any, referred:any, refs:any, s:any, sec:any, skill:any, skills_dir:any, src:any, t:any, text:any, trace:any, why:any;
([fm, skill]=split_frontmatter(read(join(ROOT, "SKILL.md"))));
(refs=Object.fromEntries(Array.from(["secrets.md", "branch.md", "commit.md", "pr.md"]).map((n: any) => ([n, read(join(ROOT, "references", n))]))));
(sec=at(refs, "secrets.md"));
([rc, _]=run("--message", "feat: 모델 검사기 추가"));
check("Checker: Pass the correct commit message", (rc === 0), ("rc=" + repr(rc)));
for (const [msg, why] of [["Feat: 대문자 타입", "format violation"], ["feat 콜론 없음", "missing separator"], ["feat: 마침표로 끝난다.", "trailing period"], ["nope: 없는 타입", "unknown type"], [("chore: " + "가".repeat(60)), "subject length"]]) {
([rc2, _]=run("--message", msg));
check(("Checker: rejects " + repr(why)), (rc2 === 1), ("rc=" + repr(rc2)));
}
([rc3, out3]=run("--message", "feat: 추가\n\n본문\n\nCo-Authored-By: Claude"));
check("Checker: Catch prohibited phrases (Co-Authored-By)", (truth((rc3 === 1)) && truth((contains(out3, "banned phrase")))));
([rc4, out4]=run("--message", "feat: 추가\n\n본문\n\nGenerated with Claude Code"));
check("Checker: Catch prohibited phrases (Generated with)", (truth((rc4 === 1)) && truth((contains(out4, "banned phrase")))));
([rc5, _]=run("--message", "feat: 추가\n바로 본문"));
check("Inspector: Catches missing blank lines between title and body", (rc5 === 1));
for (const [br, ok_want, why] of [["feat/add-thing", 0, "valid"], ["jaesol-shin/jstack-plugin", 1, "username"], ["feature-new-plugin", 1, "missing slash"], ["Feat/Upper", 1, "uppercase"], ["nope/x", 1, "unknown type"]]) {
([rcb, _]=run("--branch-name", String(br)));
check(("Checker: branch verdict for " + repr(why)), (rcb === ok_want), ("rc=" + repr(rcb) + " (expected " + repr(ok_want) + ")"));
}
check_checker_execution();
check("Protocol: There are 6 branch types in the document", (Array.from(["feat", "fix", "refactor", "docs", "test", "chore"]).map((t: any) => ((contains(skill, ("`" + repr(t) + "`")))))).every((value:any)=>truth(value)));
check("Protocol: Revealing the fact that there was a split with the upper stream", (truth((contains(skill, "Work branches use the two-part"))) && truth((contains(skill, "references/branch.md")))), "the two-part form is canonical; the upstream three-part form is reference-only");
check("Protocol: Specifies that usernames are prohibited", (contains(skill, "**No usernames**")));
check("Protocol: Specifies no-commit statements", (truth((contains(skill, "Generated with Claude Code"))) && truth((contains(skill, "Co-Authored-By")))));
check("Protocol: Explain why and how the text is in order", (truth((contains(skill, "**why** (problem, motivation)"))) && truth((contains(skill, "**how** (approach)")))));
check("Protocol: Reveals that the authentic source of the label rule is the repo policy file", (truth((contains(skill, ".claude/pr-policy.json"))) && truth((contains(skill, "not written here")))));
check("protocol: states that PR cannot be opened without policy file", (contains(skill, "must exist before a PR can be opened")));
check("Protocol: Identify the difference between an empty file and an absent file", (truth((contains(skill, "Empty means"))) && truth((contains(skill, "absent means")))));
check("Convention: Do not embed label values in the text", (!contains(at(split(at(split(skill, "The upstream original — the full label tables"), 0), "## PRs"), -(1)), "@package")), "label list reappeared in prose; policy file and gh label list own the values");
(src=read(CHECK));
const defaults=read(join(dirname(dirname(ROOT)),"runtime","conventions.js"));
check("Conformity: Title length upper limit is the same in document and validator", (truth((contains(src, "SUBJECT_MAX = DEFAULT_CONVENTIONS.subjectMax"))) && truth((contains(defaults, "subjectMax: 50"))) && truth((contains(skill, "50 characters")))));
check("Match: Body fold width is the same", (truth((contains(src, "BODY_WRAP = DEFAULT_CONVENTIONS.bodyWrap"))) && truth((contains(defaults, "bodyWrap: 72"))) && truth((contains(skill, "Wrap at 72")))));
for (const [label, positive, negatives] of SKILL_DIRECTION) {
(trace=Array.from(negatives).filter((n: any) => truth(search(n, skill))).map((n: any) => (n)));
check(("Direction: " + repr(label)), (truth((contains(skill, positive))) && truth(!truth(trace))), (truth((!contains(skill, positive))) ? "sentence missing" : ("inversion traces " + repr(trace))));
}
for (const header of ["## Branches — `<type>/<kebab-case>`", "## Commits — Conventional Commits", "## PRs — the repository owns the label rule", "## Secrets — stop them before the commit"]) {
(part=section(skill, header));
(hits=sorted(unique(findall("however|unless|except when|does not apply|no longer required",part))));
check(("Direction: " + repr(strip(at(split(header, "—"), 0))) + " section has no exception-injection marker"), (truth(truth(part)) && truth(!truth(hits))), (truth(!truth(part)) ? "section missing" : ("markers " + repr(hits))));
}
(gone=Array.from(L0_SENTENCES).filter((s: any) => truth((!contains(fm, s)))).map((s: any) => (s)));
check("L0: The definition, role, and boundary sentences of description remain the same.", !truth(gone), ("missing " + repr(gone)));
(quoted=Array.from(findall("\"([^\"]+)\"", fm)));
check(("L0: all " + repr(length(L0_TRIGGERS)) + " trigger terms remain in order"), isDeepStrictEqual(quoted,L0_TRIGGERS), (repr(quoted)));
check("L0: The skill name is gitrules", truth(search("(?m)^name: gitrules$", fm)));
check("Secret: We state that we do not have response procedures here.", (contains(sec, "The response procedure is not duplicated here")));
check("Secret: Point out that the original is a secrets skill", (contains(sec, "`secrets`")));
check("Secret: Revealing why you shouldn't have the same procedure in two places", (contains(sec, "one could change while the\nother did not")));
check("Secret: What works with git and what doesn’t", (truth((contains(sec, "What Git can do"))) && truth((contains(sec, "What Git cannot do")))));
check("Secret: Reveals that copies, forks, and caches are outside of git", (truth((contains(sec, "existing clones"))) && truth((contains(sec, "forks"))) && truth((contains(sec, "cached")))));
check("Secret: So we conclude that disposal comes first", (contains(sec, "credential revocation comes first")));
check("Secret: The secrets skill to be returned is real.", isdir(join(dirname(ROOT), "secrets")));
check("Secret: Reveal the difference between gitignore and info/exclude", (truth((contains(sec, "Whole repository"))) && truth((contains(sec, "Local only")))));
check("Secret: Reveals that detection and encryption are different problems", (contains(sec, "Detection and encryption solve different problems")));
for (const [fn, label, positive, negatives] of REF_DIRECTION) {
(text=at(refs, fn));
(trace=Array.from(negatives).filter((n: any) => truth(search(n, text))).map((n: any) => (n)));
check(("Reference direction: " + repr(fn) + " — " + repr(label)), (truth((contains(text, positive))) && truth(!truth(trace))), (truth((!contains(text, positive))) ? "sentence missing" : ("inversion traces " + repr(trace))));
}
check_markdown_structure("SKILL.md", skill);
check_section_lengths("SKILL.md", skill);
for (const fn of ["branch.md", "commit.md", "pr.md", "secrets.md"]) {
check_markdown_structure(("references/" + repr(fn)), at(refs, fn));
check_section_lengths(("references/" + repr(fn)), at(refs, fn));
}
(ghost=search("\\|\\s*@package\\b", at(refs, "pr.md")));
check("No ghost label @package row in pr.md labels table", (ghost === null), (truth(ghost) ? (repr(group(ghost, 0)) + "  exists") : ""));
(skills_dir=dirname(ROOT));
(NAME="`([a-z][a-z-]{2,})`\\s+skill\\b");
(referred=sorted(unique(findall(NAME, skill))));
(missing=Array.from(referred).filter((n: any) => truth(!truth(isdir(join(skills_dir, n))))).map((n: any) => (n)));
check("Alert: All return objects are real", !truth(missing), ("missing " + repr(missing)));
check("Boundary: Identifies passing to command", (truth((contains(skill, "/wrap"))) && truth((contains(skill, "/commit"))) && truth((contains(skill, "/pr")))));
check("Limitations: Reveal that only the format is visible", (contains(skill, "The checker sees **format**")));
check_skill_body(check, ROOT, {needles: ["feat/add-model-version-checker", "Generated with Claude Code", "Work branches use the two-part", "the repository owns the label rule", "revoke and\nreissue it immediately"], floor: 4606});
check_ref_contracts(check, ROOT, [["secrets.md", "gitignore distinction, revocation order, and tool selection", ["`.git/info/exclude`", "The response procedure is not duplicated here", "credential revocation comes first", "gitleaks", "SOPS"], 1614], ["branch.md", "upstream three-part form and evidence for local divergence", ["`<folder>/<category>/<description-in-kebab-case>`", "email-verification-workflow", "board-query-performance"], 1212], ["commit.md", "upstream type table, title/body rules, and full example", ["FlyToCart", "loginUser", "Resolves: #105"], 1836], ["pr.md", "upstream label table as example and rationale for excluding @package", ["phantom_labels", "ignore-for-release", "closed #123"], 2091]]);
(META=["자기검사:", "계약 커버리지:", "스크립트 계약:"]);
(live_ran=(Array.from(results).filter((r: any) => truth(!truth(starts(at(r, 0), META)))).map((r: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
check_contract_coverage(check, SUITE_FILE, ROOT, {per_file: {"SKILL.md": 44, "references/secrets.md": 22, "references/branch.md": 11, "references/commit.md": 11, "references/pr.md": 11}, live_ran: live_ran});
check_body_deletion(check, SUITE_FILE, ROOT, {minimum: 44, live_ran: live_ran});
check_script_contracts(check, SUITE_FILE, ROOT, {scripts: {"scripts/check_commit.js": 37}, live_ran: live_ran});
check_no_constant_assertions(check, SUITE_FILE);
check_total(check, results, 168);
(passed=(Array.from(results).filter(([_name, ok, _detail]: any) => truth(ok)).map(([_name, ok, _detail]: any) => (1))).reduce((total:number,value:any)=>total+Number(value),0));
console.log(("\n" + repr(passed) + "/" + repr(length(results)) + " 통과"));
return (truth((passed === length(results))) ? 0 : 1);
}
process.exitCode=main();
