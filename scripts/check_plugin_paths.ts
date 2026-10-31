import { isMain } from '../runtime/entry.js';
/** Resolve package file and command references; preserve reviewed source-scoped exclusions. */
import * as fs from "node:fs";
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import {runProcess} from "../runtime/os.js";
import ts from 'typescript';
import { sourcePath } from '../runtime/skill_catalog.js';

type Rule=[string,string,string|null];
export const IGNORE: Rule[] = [
  ["^tests/test_[a-z_]+\\.py$|^scripts/check_floor_parity\\.py$", "Stable suite labels kept after the TypeScript migration; the runner discovers the compiled files", "^contracts/(?:contract-suite-dependencies|ts-migration/deletion-floors)\\.json$"],
  ["^hooks/stack-viewer\\.tsx$", "File inside the imported mod, named from its floor reason", "^contracts/ts-migration/deletion-floors\\.json$"],
  ["^scripts/korean_spell_check\\.py$|^skills/proof/tests/run_tests\\.py$", "Historical crosswalk of the Python suite that the native suite replaced", "^contracts/ts-migration/proof-suite-crosswalk\\.json$"],
  ["^skills/[a-z-]+/scripts/[a-z_-]+\\.py$", "Historical migration record; the runtime reads only this file's features", "^contracts/ts-migration/specialists\\.json$"],
  ["^\\.agents/skills/upstream-patrol/upstreams\\.json$", "Repository maintenance record that the notice names and the package does not ship", "^NOTICE\\.md$"],
  ["^a/b\\.md$|^plugins/installed_plugins\\.json$", "A sample path and a path under the host's own config directory", "^mods/stack-viewer/hooks/stack\\.ts$"],
  ["^hosts/claude/mods/stack-viewer\\.test\\.ts$", "Source test named by the mod test kit; tests are not packaged", "^mods/claude-code-testing\\.mjs$"],
  ["^artifacts/(?:add-item|find-item)/|^features/README\\.md$", "Files the skill creates in the caller's project", "^skills/create-verification-skill/"],
  ["^coverage/lcov\\.info$", "Coverage report in the caller's project", "^skills/verify/SKILL\\.md$"],
  ["^references/(?:consumer-boundaries|dagster|dagster-expert/INDEX)\\.md$", "Named relative to the vendored dag-it skill folder, as the entry skill states", "^skills/dag-it/SKILL\\.md$"],
  ["^references/render\\.md$|^scripts/statechart\\.ts$", "Named relative to the vendored statechart skill folder, as the entry skill states", "^skills/statechart/SKILL\\.md$"],
  ["^path/to/file\\.test\\.ts$|^/tmp/test\\.log$|^test/quarantine\\.txt$", "Setup examples refer to tests and logs in the caller's project", "^skills/setup/references/testing-guidance\\.md$"],
  ["^path/to/new\\.test\\.(?:ts|js)$|^tests/test_new\\.py$", "Flake diagnosis runs a caller's changed test file", "^skills/verify/references/flaky-tests\\.md$"],
  ["^test/test_helper\\.rb$", "Parallel test setup example belongs to the caller's Ruby project", "^skills/verify/references/test-parallelism\\.md$"],
  ["^tests/session\\.test\\.ts$", "Review receipt example names a test in the caller's project", "^skills/verify/references/self-check\\.md$"],
  ["^docs/CHANGELOG\\.md$", "Hook contract describes an optional changelog in the target repository", "^hooks/CONTRACT\\.md$"],
  ["^internal/(?:detect/(?:engine|detect_test)|config/config|policy/rollout)\\.go$", "Provenance records inspected upstream Go sources; no Go source is imported", "^runtime/review-cycles\\.upstream\\.md$"],
  ["^docs/skill-routing-principles-20260915\\.md$|^r11/workflow/plan/SKILL\\.md$", "Historical observation record and a host-generated aliased path example", "^skills/host-audit/references/host-rules\\.(?:md|json)$"],
  ["^\\.codex-plugin/plugin\\.json$", "Host audit reads the explicitly selected comparison package", "^skills/host-audit/scripts/analyze\\.(?:js|ts)$"],
  ["^/private/observed-(?:environment|user)\\.json$", "SDLC examples name private actual host observations supplied by the caller", "^contracts/sdlc\\.md$"],
  ["^agents/openai\\.yaml$", "Explicit invocation policy is generated beneath each native entry, outside the runtime payload", "^(?:contracts/skill-catalog\\.md|skills/host-audit/scripts/(?:analyze|inventory)\\.(?:js|ts))$"],
  ["^app\\.cjs$", "The SDLC release fixture creates this application in its temporary Git repository", "^runtime/fixtures/sdlc_release\\.(?:js|ts)$"],
  ["^\\.(?:agents/plugins|claude-plugin)/marketplace\\.json$|^/\\.jstack/installation\\.json$|^ysys143-jstack-[0-9.]+(?:-staging)?\\.tgz$", "Installer-generated user registry, installation receipt and GitHub release npm archive", "^README\\.md$"],
  ["^/?\\.disk_cache/(?:disk_history\\.db|refresh\\.sh)$|^/?\\.jstack/state/disk-manager/memory\\.json$|^(?:profiles/disk-manager\\.json|state/disk-manager/(?:history\\.sqlite3|memory\\.json|collection\\.lock/owner\\.json)|logs/disk-manager/collector\\.log)$|^/absolute/backup/disk_history\\.db$|^Library/Containers/com\\.docker\\.docker$", "Disk-manager reads or creates these user state, legacy cache, backup and Docker paths", "^skills/disk-manager/(?:SKILL\\.md|references/installation\\.md|scripts/(?:memory|scheduler|storage)\\.js)$"],
  ["^/private/new-migration-plan\\.json$", "Private migration plan written to the explicit destination outside the package", "^skills/agent-maintenance/references/(?:claude|codex)-migration\\.md$"],
  ["^CODEX_HOME/config\\.toml$", "Selected Codex profile configuration, not a shipped file", "^skills/dashboard/SKILL\\.codex\\.md$"],
  ["^references/(?:migrate-project-sessions|codex-migrate-project-sessions|claude-profile|claude-project-rename|claude-plugin-ghost-entry-cleanup)\\.md$|^scripts/(?:claude|codex)-migrate\\.py$|^tests/test_migrate\\.py$", "Immutable names in the imported source checksum record; adapted execution lives in jstack session-memory", "^skills/agent-maintenance/source-provenance\\.json$"],
  ["^(?:rules/comment-intent\\.js|tests/comment-intent\\.test\\.js)$", "Comment-governance guide examples describe files in the target project", "^skills/setup/references/comment-convention-governance\\.md$"],

  ["^(?:skills/diagram-design/|scripts/|commands/|prompts/)", "Pinned upstream source paths map beneath skills/diagram/repos/diagram-design; the owning suite checks exact population and hashes", "^skills/diagram/UPSTREAM\\.v2\\.6\\.22\\.json$"],
  ["^/absolute/check-output\\.txt$", "Routing result example points to caller-created verification evidence", "^runtime/ROUTING\\.md$"],
  ["^E/(?:timeout|step-[0-9]+)\\.txt$", "Interactive CLI recipe saves screens in the caller's disposable evidence directory", "^skills/verify/references/interactive-cli\\.md$"],
  ["^/absolute/ci-evidence\\.json$", "Caller-owned CI evidence output example", "^skills/verify/references/ci-diagnosis\\.md$"],
  ["^(?:calc|check)\\.cjs$|^(?:progress|sentinel)\\.txt$", "Routing evaluation creates these synthetic files in each disposable worktree", "^scripts/routing_eval\\.(?:js|ts)$"],
  [".", "Test cases and the case module shared by the model-check hook tests contain deliberately missing and generated fixture paths", "(?:^|/)(?:[^/]+\\.test\\.(?:js|ts|mjs)|__tests__/[^/]+|hooks/_model-versions-cases\\.(?:js|ts))$"],
  [".", "Bundled upstream parser literals are covered by vendor provenance and package integrity checks", "^(?:runtime/vendor/|skills/author/references/templates/validation-hook-template/toml\\.mjs$)"],
  ["^/?\\.(?:claude|gemini)/|^HOME/", "Host configuration under the user's home is not a distribution file", null],
  ["^/Applications/|^(?:Google/Chrome/Application/chrome|Microsoft/Edge/Application/msedge|Firefox/firefox)\\.exe$", "Browser discovery probes native installation locations", "^(?:scripts/doctor-work|skills/deck/scripts/ensure_marp)\\.(?:js|ts)$"],
  ["^Scripts/python\\.exe$", "Python executable created by the isolated specialist environment", "^runtime/specialists\\.(?:js|ts)$"],
  ["^\\.(?:claude|codex)-plugin/(?:plugin|marketplace)\\.json$|^agents/openai\\.yaml$|^payload/\\.claude-plugin/plugin\\.json$", "Identity readers and exporters operate on the explicitly supplied target package", "^skills/(?:verify/scripts/(?:package_check|package_identity)|bridge/scripts/export)\\.(?:js|ts)$"],
  ["^@(?:openai/codex/bin/codex|anthropic-ai/claude-code/cli)\\.js$", "Official npm host entrypoints are resolved from the user's selected installation", "^cli/hosts\\.(?:js|ts)$"],
  ["^\\.codex-plugin/plugin\\.json$", "Installer identity checks read the selected deployment package", "^cli/install\\.(?:js|ts)$"],
  ["^package/dist/bundle/jstack\\.tgz$", "Validated npm archive member, not an already extracted file", "^cli/download\\.(?:js|ts)$"],
  ["^plugins/installed_plugins\\.json$", "Host registry under the user's configuration directory", "^skills/prune/scripts/prune\\.(?:js|ts)$"],
  ["^\\.codex-plugin/plugin\\.json$", "Project hook reads the generated manifest at the selected package root", "^hooks/hook-project\\.js$"],
  ["^STYLE_GUIDE\\.md$|^subagents\\.yaml$", "DeepAgents examples explicitly author these user-project inputs", "^skills/deepagents/references/(?:tools-and-skills|api|subagents)\\.md$"],
  ["^/missing-fixture/file\\.json$|^hooks/validation-hook-template/validate_template\\.js$", "Validation template examples exercise a missing input and its copied installation path", "^skills/author/references/templates/validation-hook-template/(?:README\\.md|hooks\\.json)$"],
  ["^/absolute/path/", "Installation example points to the user's supplied candidate tarball", "^README\\.md$"],
  ["^renderers/shared/(?:utils|text-fit)\\.mjs$", "Pinned archify source attribution, not embedded local source", "^skills/diagram/scripts/verify-text-width\\.(?:js|ts)$"],
  ["^scripts/(?:prescan|reconcile)\\.py$", "Immutable upstream taxonomy fixture retains the upstream script names", "^skills/humanize/tests/upstream-0\\.6\\.0/ai-tell-taxonomy\\.md$"],
  [".", "Canonical-library validators deliberately name source files and synthetic deletion fixtures", "^scripts/check_suite_lib_(?:behaviour|parity)\\.(?:js|ts)$"],
  ["^tests/test_repack\\.py$", "Stable suite identity shared with the historical floor register", "^scripts/run_suites\\.(?:js|ts)$"],
  ["\\.test\\.ts$", "Node test grouping names contributor test sources; the installed payload ships their compiled JS", "^scripts/(?:run-node-tests\\.mjs|node-test-groups\\.json)$"],
  ["^tests/test_(?:dev|work)_(?:agents|commands)\\.py$", "Contract selection names the runner's canonical owning-suite labels, not payload files", "^scripts/select_contract_suites\\.(?:js|ts)$"],
  ["^types\\.ts$", "Comment identifies the erased type-only source corresponding to the emitted companion", "^skills/recall/scripts/session_migration/common\\.js$"],
  ["^/dist/index\\.js$|^/skills/dashboard/dist/index\\.js$", "Version-placeholder suffixes in cache layout examples", "^skills/dashboard/scripts/statusline-shim\\.mjs$"],
  ["^scripts/__tests__/ensure-statusline\\.test\\.ts$|^multi-ai-delegate/hooks/council_state\\.py$", "Dashboard test-source annotation and explicitly removed legacy hook provenance", "^hooks/ensure-statusline\\.mjs$"],
  ["^dist/packaging/(?:build|release)\\.js$", "Bridge documents the contributor source checkout build command; the installed payload ships packaging/ without dist/", "(?:^|/)skills/(?:bridge|support/runtime-adaptation)/"],
  ["^skills/support/emoji-policy/SKILL\\.md$", "The emoji procedure and the emoji hook contract name the procedure's contributor source-tree location; the installed payload ships it as skills/emoji", "^(?:hooks/CONTRACT\\.md|skills/emoji/SKILL\\.md)$"],
  ["^user/repo\\.git$", "Example Git remote in the project-info parser", "^skills/dashboard/scripts/widgets/project-info\\.ts$"],
  [
    "^/private/migration-plan\\.json$",
    "Private migration plan generated outside the installed package",
    "^skills/recall/references/session-migration\\.md$"
  ],
  [
    "^references/anthropic-skills-guide/(?:02-planning-and-design|03-skill-structure|04-writing-instructions|07-patterns)\\.md$",
    "Explicit external source pointers to corca-ai/claude-plugins, not embedded files",
    "^skills/author/references/skill\\.md$"
  ],
  [
    ".*",
    "Scanner regex grammar and example literals are not product references",
    "^scripts/check_plugin_paths\\.(?:py|js|ts)$"
  ],
  [
    "^/\\.claude-plugin/plugin\\.json$",
    "Plugin manifest in the user's Git repository, not the installed payload",
    "^hooks/check_marketplace_versions\\.(?:py|js|ts)$"
  ],
  [
    "^/commands$",
    "Prose pairing of skills/commands",
    "^CAPABILITIES\\.md:3$"
  ],
  [
    "^/skill-name$",
    "Example skill placeholder",
    "^skills/team/references/agent-design-patterns\\.md:\\d+$"
  ],
  [
    "^evals/evals\\.json$",
    "Example evaluation input to be authored by the user",
    "^skills/author/references/skill-testing-guide\\.md$"
  ],
  [
    "^input\\.txt$",
    "Example user input filename",
    "^skills/proof/references/character-count\\.md$"
  ],
  [
    "^templates/report/section0\\.xml$",
    "Member path in a hypothetical grader input document",
    "^evals/discriminating/hwpx-format-units/graders/criteria\\.md$"
  ],
  [
    "^\\.claude-plugin/marketplace\\.json$",
    "사용자 작업 저장소의 marketplace 마커 — 설치 payload 파일이 아니다",
    "^hooks/(?:CONTRACT(?:-dev)?\\.md|check_marketplace_versions\\.(?:py|js|ts)|check_readme_version\\.(?:py|js|ts))$"
  ],
  [
    "^/?\\.jstack/",
    "사용자 전용 프로필 또는 프로젝트 상태 경로 — 배포하지 않는다",
    "^(?:runtime/|skills/workspace/references/)"
  ],
  [
    "^application/vnd\\.google-apps\\.folder$",
    "Google Drive 폴더 MIME 유형 — 파일 경로가 아니다",
    "^runtime/profiles\\.(?:py|js|ts)$"
  ],
  [
    ".",
    "명시적 패키징 원장의 source/target 쌍 — build/check가 각 표면에서 전량 대조한다",
    "^packaging/(?:package-files|excluded-aliases)\\.json$"
  ],
  [
    ".",
    "빌드·설치 검사 도구의 생성 대상과 합성 경로 — 패키지 및 실제 설치 검사에서 검증한다",
    "^packaging/(?:build|release|host_probe|interactive_probe|lifecycle_probe|run_contracts)\\.(?:py|js|ts)$"
  ],
  [
    "^security/(?:scope\\.json|findings\\.json|baseline/app\\.(?:py|js|ts)|inputs/F-1/poc\\.json|oracle-review\\.json|oracle\\.(?:py|js|ts))$",
    "보안 task의 입력·생성 파일 예시 — 플러그인 배포 파일이 아니다",
    "^skills/(?:plan/references/security-scope|verify/references/security-verification)\\.md$"
  ],
  [
    "^(?:docs/patching\\.md|harness/artifacts\\.(?:py|js|ts))$",
    "defending-code 고정 상류 링크의 표시 경로 — 로컬 코드 반입 아님",
    "^skills/verify/references/defending-code-upstream\\.md$"
  ],
  [
    "^(_workspace|run|raw|reports?)/|^REPORT_DIR/|^full_path/",
    "실행 시 생성되는 작업 디렉토리·산출물",
    null
  ],
  [
    "^~?/?\\.(config|codex|nvm|oh-my-zsh)/|^~/",
    "사용자 홈 아래 설정·런타임 경로 — 플러그인 트리 밖",
    null
  ],
  [
    "^(private/)?var/folders/|/T/claude-eval-|/tmp/e-[A-Za-z0-9]",
    "eval 실행 시 임시 trace 경로",
    null
  ],
  [
    "급여명세|private-secret/",
    "테스트 픽스처가 런타임에 만드는 경로 — 유출 차단 검증용이지 참조가 아니다",
    null
  ],
  [
    "^\\.\\.(/|$)",
    "상위 경로 탈출 표기 — 플러그인 트리 밖이라 해석 대상이 아니다 (zip-slip 시험 문자열 등)",
    null
  ],
  [
    "^(Contents|META-INF|Preview)/",
    "HWPX/OOXML 컨테이너 내부 항목명 — zip 멤버이지 파일시스템 경로가 아니다",
    null
  ],
  [
    "^(ppt|word|xl)/",
    "OOXML 컨테이너 내부 항목명",
    null
  ],
  [
    "^/(etc|Library|usr|opt|var)/",
    "시스템 절대경로 — 설치 위치 안내",
    null
  ],
  [
    ".",
    "author 픽스처 플러그인 내부 경로 — 픽스처 루트 기준이지 이 트리 기준이 아니다",
    "skills/author/scripts/tests/fixtures/"
  ],
  [
    "^imnotai-web/",
    "상류 저장소(im-not-ai) 내부 경로 — 우리 트리 밖",
    null
  ],
  [
    "^skills/diagram-design/",
    "상류 up:diagram-design 내부 경로 — 흡수 출처 표기",
    null
  ],
  [
    ".",
    "계약 스위트가 축을 시험하려고 만드는 합성 경로 — 참조가 아니라 입력이다",
    "(^|/)tests/[^/]+\\.(?:py|js|ts)$"
  ],
  [
    ".",
    "공용 라이브러리의 예시·시험 경로 — 참조가 아니라 입력이다",
    "(^|/)skills/_suite_lib\\.(?:py|js|ts)$"
  ],
  [
    "-hook-template/|^templates?/",
    "훅 템플릿 이름 — 생성될 것의 이름이지 이 트리의 파일이 아니다",
    "author/references/(hook|placement|deprecated-governance)\\.md$"
  ],
  [
    "^plugin-generator/|^(session-and-git|skill-search|session-search)/",
    "폐기된 레거시 경로를 기록하는 문서 — 실재하지 않는 것이 정상이다",
    "author/references/deprecated-governance\\.md$"
  ],
  [
    "^/?\\.agents/|^agents/openai\\.yaml$|^\\$skill-name",
    "범용 agent-skills 배포면의 경로 — 이 플러그인 트리 밖이다",
    "author/references/placement\\.md$"
  ],
  [
    ".",
    "상류(K-Dense·DeepMind) 문서가 든 예시 경로 — 우리 트리 기준이 아니다",
    "science/references/reproducibility\\.md$"
  ],
  [
    "^(out|output|build|workspace)/",
    "실행 산출 경로 — 돌리면 생기는 것이지 트리에 있는 것이 아니다",
    null
  ],
  [
    "^src/|^skills/a/b/",
    "사용자 프로젝트·합성 예시 경로 — 우리 트리 기준이 아니다",
    null
  ],
  [
    "^references/design-slop\\.md$",
    "소유 스킬을 문장에서 밝히는 인용 — image 스위트가 owner+rel 로 실재를 잰다",
    "image/references/prompts\\.md$"
  ],
  [
    "^/bin/UPSTREAM\\.(?:sh|js|ts)a256$",
    "표면 선언의 글로브 패턴 — 경로가 아니다",
    "author/references/package-surface\\.yaml$"
  ],
  [
    "^hooks/route\\.(?:py|js|ts)$|^gws/",
    "'예정' 으로 밝힌 미실현(check_fill 이 센다)과 레거시 트리 인용",
    "author/references/browser-priority\\.md$"
  ],
  [
    "^docs/",
    "상류 문서의 절 인용 — 우리 트리의 파일이 아니다",
    "(image/references/prompts|research/references/tier-profile)\\.md$"
  ],
  [
    "^references/assumptions_and_diagnostics\\.md$",
    "science/repos 반입 번들 내부 경로 — 상류 스킬이 자기 기준으로 적었다",
    "science/references/stats-corrections\\.md$"
  ],
  [
    "^BinData/",
    "HWPX 컨테이너 내부 항목명 — zip 멤버이지 파일시스템 경로가 아니다",
    null
  ],
  [
    "^skillstead_validate/",
    "상류 저장소(kyungseo/skillstead) 내부 경로 — 흡수 출처 표기",
    null
  ],
  [
    "^SESSIONS_PATH/",
    "셸 변수 전개 — 런타임에 정해지는 위치이지 트리 안의 파일이 아니다",
    "^commands/setup\\.md$"
  ],
  [
    "^/skills/recall/bin/Cargo\\.toml$",
    "find -path 글롭 패턴 — 같은 문서가 실물 경로를 따로 인용한다",
    "^commands/setup\\.md$"
  ],
  [
    "^references/style-guide\\.md$",
    "상류 up:diagram-design 의 파일 — '여기가 아니다' 라는 부정 지시",
    null
  ],
  [
    "^\\d+\\.x/",
    "버전 범위 표기(0.x/1.x) — 경로가 아니다",
    null
  ],
  [
    "^scientific-agent-skills/",
    "상류 up:science-research 하위 저장소 경로 — 갱신 안내",
    null
  ],
  [
    "^/references/_",
    "반입물 스크립트가 자기 기준으로 쓰는 경로 — 그 스크립트의 cwd 기준",
    null
  ],
  [
    "^deliverables/",
    "산출 디렉토리 — 실행 시 만들어진다",
    null
  ],
  [
    "^(hyperresearch/)?core/",
    "상류 up:hyperresearch 패키지 내부 경로 — 근거 인용",
    null
  ],
  [
    "\\{|\\*|\\.\\.\\.",
    "예시 글롭 · 치환 자리표시자",
    null
  ],
  [
    "^(https?|git):",
    "URL",
    null
  ],
  [
    "^(\\.claude|\\.github|node_modules)/",
    "리포 인프라 · 플러그인 트리 밖",
    null
  ],
  [
    "^references/tmpl\\.md$|^skills/CONVENTIONS\\.md$",
    "검사기 주석이 드는 반례 파일명 — 실재하면 안 된다",
    null
  ],
  [
    "^rpath/|\\.dylib$",
    "런타임 파손 스텁의 dylib 경로 — 실재하지 않는다",
    null
  ],
  [
    ".",
    "언어별 관례 경로 — 사용자 프로젝트에 생기는 경로이지 우리 트리 참조가 아니다",
    "^skills/tdd/langs/[a-z]+\\.md$"
  ],
  [
    "NNNN",
    "번호 자리표시자 — 실제 파일명이 아니다",
    null
  ],
  [
    "^commands/(commit-push-pr|design|to-react|setup-mcp|notify-(slack|email|sms|push))\\.md$|^skills/(uppercase|lowercase|base64-encode|json-format|hash-file|commit-message-convention|pr-convention|branch-name-convention)\\.md$|^hooks/check_pr_labels\\.(?:py|js|ts)$",
    "번들 응집도 가이드가 드는 가상 플러그인의 구성요소 — 실재하면 예시가 아니다",
    "^skills/author/references/organizational-guides/bundle-coherence-guide\\.md$"
  ],
  [
    "^hooks/(validate_before_commit|notify_deployment|lint_check|auto_format|notify_slack|audit_log)\\.(?:py|js|ts)$|^src/file\\.ts$",
    "훅 아키텍처 가이드의 예시 훅 스크립트와 예시 편집 대상 — 실재하지 않는 이름이다",
    "^skills/author/references/organizational-guides/hook-architecture\\.md$"
  ],
  [
    "^src/components/Button\\.tsx$|^\\.tmp/agent1-output\\.json$",
    "에이전트 아키텍처 가이드의 예시 — 사용자 코드베이스 파일과 실행 시 만드는 중간 산출물",
    "^skills/author/references/organizational-guides/agent-architecture\\.md$"
  ],
  [
    "^references/(docx-js|redlining)\\.md$",
    "작성 가이드 코드펜스 안의 가상 DOCX 스킬 참조 — 그 스킬은 존재하지 않는다",
    "^skills/author/references/skill-writing-guide\\.md$"
  ],
  [
    "^hooks/(notify|format|format_all)\\.(?:sh|js|ts)$|^hooks/(validate_template|validate_plugin|validate_pr)\\.(?:py|js|ts)$|^hooks/(notification|formatting)-hook-template/(notify|format)\\.(?:sh|js|ts)$|^agents/analyzer-agent\\.md$|^commands/main\\.md$|^tests/test_(validation_hook\\.(?:py|js|ts)|hooks\\.(?:sh|js|ts))$|^scripts/validate\\.(?:py|js|ts)$|^/tmp/(analysis_request\\.md|plugin_notifications\\.log)$",
    "뼈대 템플릿이 드는 설치 후 경로·예시 산출물 — 템플릿을 복사해 간 플러그인 기준이다",
    "^skills/author/references/templates/"
  ],
  [
    "^scripts/worker\\.(?:py|js|ts)$|^tests/test_worker\\.(?:py|js|ts)$|^/path/to/file\\d+\\.(?:py|js|ts)$",
    "위임 프롬프트 예문 안의 가상 경로 — 사용자 저장소를 가리키는 예시다",
    "^skills/delegate/SKILL\\.md$"
  ],
  [
    "^/(\\.\\.|\\.claude-plugin|plugins|docs)/",
    "자리표시자(`<hooks>` · `<repo>` · `<name>`)가 앞에서 잘려 남은 조각 — 자리표시자 기준 경로이지 이 트리 기준이 아니다",
    "^hooks/CONTRACT\\.md$"
  ],
  [
    "^scripts/validate_plugin\\.(?:sh|js|ts)$|^\\.claude-plugin/hooks\\.json$",
    "훅 계약서가 '아직 없다' · '규격에 없다' 고 못박은 경로 — 실재를 요구할 수 없다",
    "^hooks/CONTRACT\\.md$"
  ],
  [
    "^scripts/(register_local|validate_plugin)\\.(?:sh|js|ts)$",
    "훅 발화를 시험하려고 지어낸 Bash 페이로드 문자열 — 실행되지 않으며 실재해서도 안 된다",
    "^tests/test_hooks\\.(?:py|js|ts)$"
  ],
  [
    "^tests/refs/README\\.md\\.lines$",
    "동결본 디렉터리를 왜 나눴는지 적은 주석의 반례 — 셋이 다투면 안 되는 이름이라 실재하지 않는다",
    "^skills/author/tests/run_tests\\.(?:py|js|ts)$"
  ],
  [
    "^href/router\\.push$",
    "`href` 와 `router.push` 를 슬래시로 병기한 표기 — 경로가 아니다",
    "^skills/team/references/qa-agent-guide\\.md$"
  ],
  [
    "^plugins/session-and-git/",
    "승계 출처 표기 — 레거시 `session-and-git` 플러그인 경로이지 이 트리 경로가 아니다",
    "^skills/gitrules/references/"
  ],
  [
    "^SESSIONS/",
    "`$SESSIONS` 변수 아래 런타임 산출 경로 — 세션 내보내기 디렉터리이지 트리 참조가 아니다",
    "^skills/recall/SKILL\\.md$"
  ],
  [
    "^\\.claude-plugin/marketplace\\.json$",
    "마켓플레이스 **저장소 루트**의 마커 파일 — install.py 가 상향탐색하는 대상이지 플러그인 트리 파일이 아니다",
    "^skills/bridge/(SKILL\\.md|tests/run_tests\\.(?:py|js|ts))$"
  ],
  [
    "^skills/gitrules/scripts/check\\.(?:py|js|ts)$",
    "설치 시험용 가짜 SKILL.md 본문 안의 경로 — 치환 규칙이 토큰을 보존하는지 재는 픽스처다",
    "^skills/bridge/tests/run_tests\\.(?:py|js|ts)$"
  ],
  [
    "^src/main\\.rs$",
    "Cargo.toml 의 `path = \"src/main.rs\"` 선언 문자열 — bin/ 기준 상대경로이며 실물은 bin/src/main.rs",
    "^skills/recall/tests/run_tests\\.(?:py|js|ts)$"
  ],
  [
    "^docs/tests/TEST_PLAN\\.md$|^CLAUDE\\.md$",
    "사용자 프로젝트 쪽 런타임 대상 예시 — 로더/가이드가 대상 저장소 기준으로 말한다",
    "^skills/(tdd/(SKILL\\.md|langs/[a-z]+\\.md)|setup/scripts/load_guidelines\\.(?:py|js|ts))$"
  ]
];
export const CMD_IGNORE: Rule[] = [
  ["^(?:stack|context|statechart)$", "Slash commands of the optional stack-viewer mod and of a skill, not package commands", "^(?:(?:CAPABILITIES|CHANGELOG)\\.md|mods/stack-viewer/README\\.md|skills/create-formal-verification-skill/SKILL\\.md)$"],
  ["^(?:context|plugin|name)$", "Built-in host commands and an explicit command-name placeholder", "^skills/host-audit/SKILL\\.md$"],
  ["^sdlc$", "Explicit SDLC activation token documented by its owning procedure and contract", "^(?:contracts/sdlc\\.md|skills/sdlc/(?:SKILL\\.md|references/run-protocol\\.md))$"],
  ["^(?:plugin|plugins|hooks)$", "Built-in host management commands", "^(?:README\\.md|CHANGELOG\\.md|runtime/CLI-PATH\\.md|skills/disk-manager/references/installation\\.md)$"],
  ["^resume$", "Built-in host session continuation command", "^skills/agent-maintenance/references/project-rename\\.md$"],
  ["^(?:status|statusline)$", "Built-in host status commands", "^(?:CAPABILITIES\\.md|skills/dashboard/SKILL(?:\\.codex)?\\.md|commands/dashboard-repair\\.md)$"],
  ["^tmp$", "Absolute temporary directory used in the disk-manager example", "^skills/disk-manager/SKILL\\.md$"],

  [
    "^projects$",
    "Native Claude data-directory suffix, not a slash command",
    "^skills/recall/SKILL\\.md$"
  ],
  [
    "^commands$",
    "Prose pairing skills/commands",
    "^CAPABILITIES\\.md$"
  ],
  [
    "^skill-name$",
    "Example skill placeholder",
    "^skills/team/references/agent-design-patterns\\.md$"
  ],
  [
    "^plugin$",
    "Claude Code 자체의 설정 커맨드 — 우리 것이 아니다",
    "author/references/placement\\.md$"
  ],
  [
    "^create$",
    "프론트엔드 링크 경로 예시(`/dashboard/create` 대 `/create`)이지 커맨드가 아니다",
    "team/references/qa-agent-guide\\.md$"
  ],
  [
    "^edit$",
    "Google Docs URL 접미사(`.../edit`)이지 커맨드가 아니다",
    "workspace/references/report-troubleshooting\\.md$"
  ],
  [
    "^(papers|fda|trials|proteins|clipboard)$",
    "Paperclip CLI 의 가상 파일시스템 경로이지 커맨드가 아니다 — 상류 카탈로그 인용",
    "science/references/_kdense-catalog\\.md$"
  ]
];
const PATHY=/(?<![\p{L}\p{N}_/.-])((?:\.{0,2}\/)?[\p{L}\p{N}_.@-]+(?:\/[\p{L}\p{N}_.@-]+)+\.[A-Za-z][A-Za-z0-9]{0,7})(?![\p{L}\p{N}_.-])/gu;
const WIN_PATHY=/(?<![\p{L}\p{N}_\\])([\p{L}\p{N}_.@-]+(?:\\[\p{L}\p{N}_.@-]+)+\.[A-Za-z][A-Za-z0-9]{0,7})(?![\p{L}\p{N}_.-])/gu;
const SKIP=new Set(['.git','.omc','__pycache__','node_modules','repos','results']);
const SCAN=new Set(['.md','.py','.js','.ts','.mjs','.json','.yaml','.yml']);
function referenceText(text:string,source:string):string {
  if (!/\.(?:js|ts|mjs)$/.test(source)) return text;
  const parsed=ts.createSourceFile(source,text,ts.ScriptTarget.Latest,true), spans:[number,number][]=[];
  const visit=(node:ts.Node)=>{if(node.kind===ts.SyntaxKind.RegularExpressionLiteral)spans.push([node.getStart(parsed),node.end]);ts.forEachChild(node,visit);};visit(parsed);
  const example = /^skills\/host-audit\/scripts\/inventory\.(?:js|ts)$/.test(source) ? /hooks-handlers\/session-start\.sh/g : /^skills\/host-audit\/scripts\/analyze\.(?:js|ts)$/.test(source) ? /r11\/workflow\/plan\/SKILL\.md/g : undefined;
  if (example) {
    const seen=new Set<string>();
    const comment=(start:number,end:number)=>{const key=`${start}:${end}`;if(seen.has(key))return;seen.add(key);for(const match of text.slice(start,end).matchAll(example))spans.push([start+match.index,start+match.index+match[0].length]);};
    const comments=(node:ts.Node)=>{ts.forEachLeadingCommentRange(text,node.pos,comment);ts.forEachTrailingCommentRange(text,node.end,comment);ts.forEachChild(node,comments);};comments(parsed);
  }
  for(const[start,end]of spans.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+' '.repeat(end-start)+text.slice(end);
  return text;
}
const unix=(text:string)=>text.split(path.sep).join('/');
const isDir=(file:string)=>{try{return fs.statSync(file).isDirectory();}catch{return false;}};
function tracked(file:string){return runProcess('git',['check-ignore','-q',file],{cwd:path.dirname(file),timeout:10000}).status!==0;}
export function walk(root:string){const files:string[]=[],dirt:string[]=[];
  const visit=(dir:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory()){if(['.omc','__pycache__'].includes(entry.name)&&tracked(full))dirt.push(unix(path.relative(root,full)));if(!SKIP.has(entry.name))visit(full);}else if(!isDir(full)){if(entry.name.endsWith('.pyc')&&tracked(full))dirt.push(unix(path.relative(root,full)));if(SCAN.has(path.extname(entry.name)))files.push(full);}}};visit(root);return {files,dirt};}
function reason(rules:Rule[],ref:string,src:string){return rules.find(([pattern,,scope])=>new RegExp(pattern,'u').test(ref)&&(!scope||new RegExp(scope,'u').test(src)))?.[1];}
function unused(rules:Rule[],fired:Set<string>,sources:string[]){return rules.filter(([,name,scope])=>!fired.has(name)&&(!scope||sources.some(source=>new RegExp(scope,'u').test(source)))).map(([,name])=>name);}
function read(file:string):string|undefined{try{return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)).replace(/\r\n/g,'\n').replace(/\r/g,'\n');}catch{return undefined;}}
export function commandRefs(root:string,files:string[]){
  const fired=new Set<string>();const commandDir=path.join(root,'commands');const have=new Set(isDir(commandDir)?fs.readdirSync(commandDir).filter(name=>name.endsWith('.md')).map(name=>name.slice(0,-3)):[]);const misses:[string,string][]=[];let total=0;
  for(const file of files){if(!file.endsWith('.md'))continue;const text=read(file);if(text===undefined)continue;const src=unix(path.relative(root,file));
    for(const match of text.matchAll(/`\/([a-z][a-z0-9-]{1,24})`/g)){const name=match[1]!;if(have.has(name)){total++;continue;}const ignored=reason(CMD_IGNORE,name,src);if(ignored){fired.add(ignored);continue;}total++;misses.push([name,`${src}:${text.slice(0,match.index).split('\n').length}`]);}}
  return {total,misses,have:[...have].sort(),unused:unused(CMD_IGNORE,fired,files.map(file=>unix(path.relative(root,file))))};
}
export function checkPluginPaths(root:string,contributorRoot?:string,packageRoot?:string){
  root=path.resolve(root);if(!isDir(root))return {code:2,lines:[`[ERROR] directory missing: ${root}`],total:0,misses:[] as [string,string][],dirt:[] as string[]};
  const {files,dirt}=walk(root);let total=0,ignored=0;const misses:[string,string][]=[],fired=new Set<string>();
  for(const file of files){const text=read(file);if(text===undefined)continue;const src=unix(path.relative(root,file)),here=path.dirname(file),components=src.split('/'),skill=components[0]==='skills'&&components.length>=2?path.join(root,'skills',components[1]!):root;
    const cleaned=referenceText(text,src).replace(/https?:\/\/[^\s"'<>`]+/g,'').replace(/\$(?:\{(?:(?:JSTACK|CLAUDE)_PLUGIN_ROOT|process\.env\.JSTACK_PLUGIN_ROOT)\}|(?:JSTACK|CLAUDE)_PLUGIN_ROOT)\/?/g,''),win=cleaned.replace(/\$(?:env:)?[\p{L}\p{N}_]+\\?/gu,'');const refs=[...cleaned.matchAll(PATHY)].map(m=>m[1]!).concat([...win.matchAll(WIN_PATHY)].map(m=>m[1]!.replaceAll('\\','/')));const seen=new Set<string>();
    for(let ref of refs) {
      if(ref.startsWith('./'))ref=ref.slice(2);
      if(seen.has(ref))continue;
      seen.add(ref);
      const why=reason(IGNORE,ref,src);
      if(why){ignored++;fired.add(why);continue;}
      total++;
      const hostRules=/^skills\/host-audit\/references\/host-rules\.(?:md|json)$/.test(src);
      const contributorReference=!!contributorRoot&&(
        /^(?:contracts\/|packaging\/source-package(?:-lock)?\.json$)/.test(src)||
        /^(?:AGENTS\.md|README\.md|packaging\/AGENTS\.package\.md)$/.test(src)&&ref.startsWith('dist/')||
        /UPSTREAM\.json$/.test(src)&&ref.endsWith('.ts')||
        /^scripts\/test_budget\.(?:js|ts)$/.test(src)&&ref==='dist/scripts/test_budget.js'||
        hostRules&&ref.startsWith('dist/')||
        src==='runtime/review-cycles.upstream.md'&&/^runtime\/review_cycles(?:\.test)?\.ts$/.test(ref)
      );
      let scopedBases:string[]=[];
      if(contributorRoot&&hostRules&&/^scripts\/(?:analyze|rules|types)\.ts$/.test(ref))scopedBases.push(sourcePath(contributorRoot,'skills/host-audit'));
      if(packageRoot&&/^(?:README\.md|skills\/host-audit\/SKILL\.md)$/.test(src)) {
        const mounted=/^\/(?:jstack-marketplace\/)?plugins\/jstack\/(payload\/.+)$/.exec(ref);
        if(mounted&&fs.existsSync(path.join(packageRoot,mounted[1]!)))continue;
      }
      if(src==='contracts/ts-migration/proof-suite-crosswalk.json') {
        try {
          const suite=JSON.parse(text).baselineSuite;
          if(typeof suite==='string'&&/^skills\/[a-z-]+\/tests\/[^/]+$/.test(suite)) {
            const owner=path.dirname(path.dirname(suite));
            scopedBases=[path.join(root,owner),...(contributorRoot?[sourcePath(contributorRoot,owner)]:[])];
          }
        }catch{}
      }
      const bases=[here,skill,root,path.dirname(skill),...scopedBases,...(contributorReference?[contributorRoot!]:[]),...(packageRoot&&ref.startsWith('payload/')?[packageRoot]:[])];
      if(!bases.some(base=>fs.existsSync(base===contributorRoot?sourcePath(base,ref):path.resolve(base,ref))||src.endsWith('.ts')&&ref.endsWith('.js')&&fs.existsSync(path.resolve(base,ref.slice(0,-3)+'.ts'))))misses.push([ref,src]);
    }
  }
  const commands=commandRefs(root,files),inactive=unused(IGNORE,fired,files.map(file=>unix(path.relative(root,file))));
  const lines=[`참조 ${total}건 / 실재 ${total-misses.length}건 / MISS ${misses.length}건 (무시 ${ignored}건 / 미발화 배제규칙 ${inactive.length}건)`];
  if(inactive.length)lines.push('  미발화 배제규칙 — 쓰이지 않는 배제는 장차 진짜 결함을 가린다:',...inactive.map(value=>`    · ${value}`));
  if(misses.length)lines.push('\nMISS:',...misses.map(([ref,src])=>`  ${ref}\n    <- ${src}`));
  lines.push(`커맨드 참조 ${commands.total}건 / 실재 ${commands.total-commands.misses.length}건 / MISS ${commands.misses.length}건 (이 플러그인의 커맨드 ${commands.have.length}종)`);
  if(commands.unused.length)lines.push('  미발화 커맨드 배제규칙 — 안 쓰이는 배제는 장차 진짜 결함을 가린다:',...commands.unused.map(value=>`    · ${value}`));
  if(commands.misses.length)lines.push('\n커맨드 MISS — 문서가 없는 커맨드를 가리킨다:',...commands.misses.map(([name,where])=>`  /${name}\n    <- ${where}`));
  if(dirt.length)lines.push(`\n위생 위반 ${dirt.length}건 — git-tracked .omc / __pycache__ / *.pyc:`,...dirt.sort().slice(0,10).map(file=>`  ${file}`));
  return {code:misses.length||dirt.length||commands.misses.length?1:0,lines,total,misses,dirt};
}
if(isMain(import.meta.url)){if(process.argv.length<3||process.argv.length>4){console.error('usage: check_plugin_paths <plugin-dir>');process.exitCode=2;}else{const result=checkPluginPaths(process.argv[2]!,process.argv[3],process.env.JSTACK_PACKAGE_ROOT);console.log(result.lines.join('\n'));process.exitCode=result.code;}}
