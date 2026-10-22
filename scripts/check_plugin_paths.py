#!/usr/bin/env python3
"Resolve file and command references in the current package."

import os
import re
import subprocess
import sys

PATHY = re.compile(
    "(?<![\\w/.-])((?:\\.{0,2}/)?[\\w.-]+(?:/[\\w.-]+)+\\.[A-Za-z][A-Za-z0-9]{0,7})(?![\\w.-])"
)
ROOT_VAR = re.compile("\\$\\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\\}/?")
WIN_PATHY = re.compile(
    "(?<![\\w\\\\])([\\w.-]+(?:\\\\[\\w.-]+)+\\.[A-Za-z][A-Za-z0-9]{0,7})(?![\\w.-])"
)
WIN_VAR = re.compile("\\$(?:env:)?\\w+\\\\?")
IGNORE = [
    (
        re.compile(r"^/private/migration-plan\.json$"),
        "Private migration plan generated outside the installed package",
        re.compile(r"^skills/recall/references/session-migration\.md$"),
    ),
    (
        re.compile(
            r"^references/anthropic-skills-guide/(?:02-planning-and-design|03-skill-structure|04-writing-instructions|07-patterns)\.md$"
        ),
        "Explicit external source pointers to corca-ai/claude-plugins, not embedded files",
        re.compile(r"^skills/author/references/skill\.md$"),
    ),
    (
        re.compile(r"\.test\.ts$"),
        "Node test grouping names contributor test sources; the installed payload ships their compiled JS",
        re.compile(r"^scripts/run-node-tests\.mjs$"),
    ),
    (
        re.compile(r"^tests/test_(?:dev|work)_(?:agents|commands)\.py$"),
        "Contract selection names the runner's canonical owning-suite labels, not payload files",
        re.compile(r"^scripts/select_contract_suites\.(?:js|ts)$"),
    ),
    (
        re.compile(r"^dist/packaging/(?:build|release)\.js$"),
        "Bridge documents the contributor source checkout build command; the installed payload ships packaging/ without dist/",
        re.compile(r"(?:^|/)skills/(?:bridge|support/runtime-adaptation)/"),
    ),
    (
        re.compile(r"^skills/support/emoji-policy/SKILL\.md$"),
        "The emoji procedure and the emoji hook contract name the procedure's contributor source-tree location; the installed payload ships it as skills/emoji",
        re.compile(r"^(?:hooks/CONTRACT\.md|skills/emoji/SKILL\.md)$"),
    ),
    (
        re.compile(r".*"),
        "Scanner regex grammar and example literals are not product references",
        re.compile(r"^scripts/check_plugin_paths\.py$"),
    ),
    (
        re.compile("^/\\.claude-plugin/plugin\\.json$"),
        "Plugin manifest in the user's Git repository, not the installed payload",
        re.compile("^hooks/check_marketplace_versions\\.py$"),
    ),
    (
        re.compile("^/commands$"),
        "Prose pairing of skills/commands",
        re.compile("^CAPABILITIES\\.md:3$"),
    ),
    (
        re.compile("^/skill-name$"),
        "Example skill placeholder",
        re.compile("^skills/team/references/agent-design-patterns\\.md:\\d+$"),
    ),
    (
        re.compile("^evals/evals\\.json$"),
        "Example evaluation input to be authored by the user",
        re.compile("^skills/author/references/skill-testing-guide\\.md$"),
    ),
    (
        re.compile("^input\\.txt$"),
        "Example user input filename",
        re.compile("^skills/proof/references/character-count\\.md$"),
    ),
    (
        re.compile("^templates/report/section0\\.xml$"),
        "Member path in a hypothetical grader input document",
        re.compile("^evals/discriminating/hwpx-format-units/graders/criteria\\.md$"),
    ),
    (
        re.compile("^\\.claude-plugin/marketplace\\.json$"),
        "사용자 작업 저장소의 marketplace 마커 — 설치 payload 파일이 아니다",
        re.compile(
            "^hooks/(?:CONTRACT(?:-dev)?\\.md|check_marketplace_versions\\.py|check_readme_version\\.py)$"
        ),
    ),
    (
        re.compile("^/?\\.jstack/"),
        "사용자 전용 프로필 또는 프로젝트 상태 경로 — 배포하지 않는다",
        re.compile("^(?:runtime/|skills/workspace/references/)"),
    ),
    (
        re.compile("^application/vnd\\.google-apps\\.folder$"),
        "Google Drive 폴더 MIME 유형 — 파일 경로가 아니다",
        re.compile("^runtime/profiles\\.py$"),
    ),
    (
        re.compile("."),
        "명시적 패키징 원장의 source/target 쌍 — build/check가 각 표면에서 전량 대조한다",
        re.compile("^packaging/(?:package-files|excluded-aliases)\\.json$"),
    ),
    (
        re.compile("."),
        "빌드·설치 검사 도구의 생성 대상과 합성 경로 — 패키지 및 실제 설치 검사에서 검증한다",
        re.compile(
            "^packaging/(?:build|release|host_probe|lifecycle_probe|run_contracts)\\.py$"
        ),
    ),
    (
        re.compile(
            "^security/(?:scope\\.json|findings\\.json|baseline/app\\.py|inputs/F-1/poc\\.json|oracle-review\\.json|oracle\\.py)$"
        ),
        "보안 task의 입력·생성 파일 예시 — 플러그인 배포 파일이 아니다",
        re.compile(
            "^skills/(?:plan/references/security-scope|verify/references/security-verification)\\.md$"
        ),
    ),
    (
        re.compile("^(?:docs/patching\\.md|harness/artifacts\\.py)$"),
        "defending-code 고정 상류 링크의 표시 경로 — 로컬 코드 반입 아님",
        re.compile("^skills/verify/references/defending-code-upstream\\.md$"),
    ),
    (
        re.compile("^(_workspace|run|raw|reports?)/|^REPORT_DIR/|^full_path/"),
        "실행 시 생성되는 작업 디렉토리·산출물",
    ),
    (
        re.compile("^~?/?\\.(config|codex|nvm|oh-my-zsh)/|^~/"),
        "사용자 홈 아래 설정·런타임 경로 — 플러그인 트리 밖",
    ),
    (
        re.compile("^(private/)?var/folders/|/T/claude-eval-|/tmp/e-[A-Za-z0-9]"),
        "eval 실행 시 임시 trace 경로",
    ),
    (
        re.compile("급여명세|private-secret/"),
        "테스트 픽스처가 런타임에 만드는 경로 — 유출 차단 검증용이지 참조가 아니다",
    ),
    (
        re.compile("^\\.\\.(/|$)"),
        "상위 경로 탈출 표기 — 플러그인 트리 밖이라 해석 대상이 아니다 (zip-slip 시험 문자열 등)",
    ),
    (
        re.compile("^(Contents|META-INF|Preview)/"),
        "HWPX/OOXML 컨테이너 내부 항목명 — zip 멤버이지 파일시스템 경로가 아니다",
    ),
    (re.compile("^(ppt|word|xl)/"), "OOXML 컨테이너 내부 항목명"),
    (re.compile("^/(etc|Library|usr|opt|var)/"), "시스템 절대경로 — 설치 위치 안내"),
    (
        re.compile("."),
        "author 픽스처 플러그인 내부 경로 — 픽스처 루트 기준이지 이 트리 기준이 아니다",
        re.compile("skills/author/scripts/tests/fixtures/"),
    ),
    (re.compile("^imnotai-web/"), "상류 저장소(im-not-ai) 내부 경로 — 우리 트리 밖"),
    (
        re.compile("^skills/diagram-design/"),
        "상류 up:diagram-design 내부 경로 — 흡수 출처 표기",
    ),
    (
        re.compile("."),
        "계약 스위트가 축을 시험하려고 만드는 합성 경로 — 참조가 아니라 입력이다",
        re.compile("(^|/)tests/[^/]+\\.py$"),
    ),
    (
        re.compile("."),
        "공용 라이브러리의 예시·시험 경로 — 참조가 아니라 입력이다",
        re.compile("(^|/)skills/_suite_lib\\.py$"),
    ),
    (
        re.compile("-hook-template/|^templates?/"),
        "훅 템플릿 이름 — 생성될 것의 이름이지 이 트리의 파일이 아니다",
        re.compile("author/references/(hook|placement|deprecated-governance)\\.md$"),
    ),
    (
        re.compile(
            "^plugin-generator/|^(session-and-git|skill-search|session-search)/"
        ),
        "폐기된 레거시 경로를 기록하는 문서 — 실재하지 않는 것이 정상이다",
        re.compile("author/references/deprecated-governance\\.md$"),
    ),
    (
        re.compile("^/?\\.agents/|^agents/openai\\.yaml$|^\\$skill-name"),
        "범용 agent-skills 배포면의 경로 — 이 플러그인 트리 밖이다",
        re.compile("author/references/placement\\.md$"),
    ),
    (
        re.compile("."),
        "상류(K-Dense·DeepMind) 문서가 든 예시 경로 — 우리 트리 기준이 아니다",
        re.compile("science/references/reproducibility\\.md$"),
    ),
    (
        re.compile("^(out|output|build|workspace)/"),
        "실행 산출 경로 — 돌리면 생기는 것이지 트리에 있는 것이 아니다",
        None,
    ),
    (
        re.compile("^src/|^skills/a/b/"),
        "사용자 프로젝트·합성 예시 경로 — 우리 트리 기준이 아니다",
        None,
    ),
    (
        re.compile("^references/design-slop\\.md$"),
        "소유 스킬을 문장에서 밝히는 인용 — image 스위트가 owner+rel 로 실재를 잰다",
        re.compile("image/references/prompts\\.md$"),
    ),
    (
        re.compile("^/bin/UPSTREAM\\.sha256$"),
        "표면 선언의 글로브 패턴 — 경로가 아니다",
        re.compile("author/references/package-surface\\.yaml$"),
    ),
    (
        re.compile("^hooks/route\\.py$|^gws/"),
        "'예정' 으로 밝힌 미실현(check_fill 이 센다)과 레거시 트리 인용",
        re.compile("author/references/browser-priority\\.md$"),
    ),
    (
        re.compile("^docs/"),
        "상류 문서의 절 인용 — 우리 트리의 파일이 아니다",
        re.compile("(image/references/prompts|research/references/tier-profile)\\.md$"),
    ),
    (
        re.compile("^references/assumptions_and_diagnostics\\.md$"),
        "science/repos 반입 번들 내부 경로 — 상류 스킬이 자기 기준으로 적었다",
        re.compile("science/references/stats-corrections\\.md$"),
    ),
    (
        re.compile("^BinData/"),
        "HWPX 컨테이너 내부 항목명 — zip 멤버이지 파일시스템 경로가 아니다",
        None,
    ),
    (
        re.compile("^skillstead_validate/"),
        "상류 저장소(kyungseo/skillstead) 내부 경로 — 흡수 출처 표기",
        None,
    ),
    (
        re.compile("^SESSIONS_PATH/"),
        "셸 변수 전개 — 런타임에 정해지는 위치이지 트리 안의 파일이 아니다",
        re.compile("^commands/setup\\.md$"),
    ),
    (
        re.compile("^/skills/recall/bin/Cargo\\.toml$"),
        "find -path 글롭 패턴 — 같은 문서가 실물 경로를 따로 인용한다",
        re.compile("^commands/setup\\.md$"),
    ),
    (
        re.compile("^references/style-guide\\.md$"),
        "상류 up:diagram-design 의 파일 — '여기가 아니다' 라는 부정 지시",
    ),
    (re.compile("^\\d+\\.x/"), "버전 범위 표기(0.x/1.x) — 경로가 아니다"),
    (
        re.compile("^scientific-agent-skills/"),
        "상류 up:science-research 하위 저장소 경로 — 갱신 안내",
    ),
    (
        re.compile("^/references/_"),
        "반입물 스크립트가 자기 기준으로 쓰는 경로 — 그 스크립트의 cwd 기준",
    ),
    (re.compile("^deliverables/"), "산출 디렉토리 — 실행 시 만들어진다"),
    (
        re.compile("^(hyperresearch/)?core/"),
        "상류 up:hyperresearch 패키지 내부 경로 — 근거 인용",
    ),
    (re.compile("\\{|\\*|\\.\\.\\."), "예시 글롭 · 치환 자리표시자"),
    (re.compile("^(https?|git):"), "URL"),
    (
        re.compile("^(\\.claude|\\.github|node_modules)/"),
        "리포 인프라 · 플러그인 트리 밖",
    ),
    (
        re.compile("^references/tmpl\\.md$|^skills/CONVENTIONS\\.md$"),
        "검사기 주석이 드는 반례 파일명 — 실재하면 안 된다",
    ),
    (
        re.compile("^rpath/|\\.dylib$"),
        "런타임 파손 스텁의 dylib 경로 — 실재하지 않는다",
    ),
    (
        re.compile("."),
        "언어별 관례 경로 — 사용자 프로젝트에 생기는 경로이지 우리 트리 참조가 아니다",
        re.compile("^skills/tdd/langs/[a-z]+\\.md$"),
    ),
    (re.compile("NNNN"), "번호 자리표시자 — 실제 파일명이 아니다"),
    (
        re.compile(
            "^commands/(commit-push-pr|design|to-react|setup-mcp|notify-(slack|email|sms|push))\\.md$|^skills/(uppercase|lowercase|base64-encode|json-format|hash-file|commit-message-convention|pr-convention|branch-name-convention)\\.md$|^hooks/check_pr_labels\\.py$"
        ),
        "번들 응집도 가이드가 드는 가상 플러그인의 구성요소 — 실재하면 예시가 아니다",
        re.compile(
            "^skills/author/references/organizational-guides/bundle-coherence-guide\\.md$"
        ),
    ),
    (
        re.compile(
            "^hooks/(validate_before_commit|notify_deployment|lint_check|auto_format|notify_slack|audit_log)\\.py$|^src/file\\.ts$"
        ),
        "훅 아키텍처 가이드의 예시 훅 스크립트와 예시 편집 대상 — 실재하지 않는 이름이다",
        re.compile(
            "^skills/author/references/organizational-guides/hook-architecture\\.md$"
        ),
    ),
    (
        re.compile("^src/components/Button\\.tsx$|^\\.tmp/agent1-output\\.json$"),
        "에이전트 아키텍처 가이드의 예시 — 사용자 코드베이스 파일과 실행 시 만드는 중간 산출물",
        re.compile(
            "^skills/author/references/organizational-guides/agent-architecture\\.md$"
        ),
    ),
    (
        re.compile("^references/(docx-js|redlining)\\.md$"),
        "작성 가이드 코드펜스 안의 가상 DOCX 스킬 참조 — 그 스킬은 존재하지 않는다",
        re.compile("^skills/author/references/skill-writing-guide\\.md$"),
    ),
    (
        re.compile(
            "^hooks/(notify|format|format_all)\\.sh$|^hooks/(validate_template|validate_plugin|validate_pr)\\.py$|^hooks/(notification|formatting)-hook-template/(notify|format)\\.sh$|^agents/analyzer-agent\\.md$|^commands/main\\.md$|^tests/test_(validation_hook\\.py|hooks\\.sh)$|^scripts/validate\\.py$|^/tmp/(analysis_request\\.md|plugin_notifications\\.log)$"
        ),
        "뼈대 템플릿이 드는 설치 후 경로·예시 산출물 — 템플릿을 복사해 간 플러그인 기준이다",
        re.compile("^skills/author/references/templates/"),
    ),
    (
        re.compile(
            "^scripts/worker\\.py$|^tests/test_worker\\.py$|^/path/to/file\\d+\\.py$"
        ),
        "위임 프롬프트 예문 안의 가상 경로 — 사용자 저장소를 가리키는 예시다",
        re.compile("^skills/delegate/SKILL\\.md$"),
    ),
    (
        re.compile("^/(\\.\\.|\\.claude-plugin|plugins|docs)/"),
        "자리표시자(`<hooks>` · `<repo>` · `<name>`)가 앞에서 잘려 남은 조각 — 자리표시자 기준 경로이지 이 트리 기준이 아니다",
        re.compile("^hooks/CONTRACT\\.md$"),
    ),
    (
        re.compile("^scripts/validate_plugin\\.sh$|^\\.claude-plugin/hooks\\.json$"),
        "훅 계약서가 '아직 없다' · '규격에 없다' 고 못박은 경로 — 실재를 요구할 수 없다",
        re.compile("^hooks/CONTRACT\\.md$"),
    ),
    (
        re.compile("^scripts/(register_local|validate_plugin)\\.sh$"),
        "훅 발화를 시험하려고 지어낸 Bash 페이로드 문자열 — 실행되지 않으며 실재해서도 안 된다",
        re.compile("^tests/test_hooks\\.py$"),
    ),
    (
        re.compile("^tests/refs/README\\.md\\.lines$"),
        "동결본 디렉터리를 왜 나눴는지 적은 주석의 반례 — 셋이 다투면 안 되는 이름이라 실재하지 않는다",
        re.compile("^skills/author/tests/run_tests\\.py$"),
    ),
    (
        re.compile("^href/router\\.push$"),
        "`href` 와 `router.push` 를 슬래시로 병기한 표기 — 경로가 아니다",
        re.compile("^skills/team/references/qa-agent-guide\\.md$"),
    ),
    (
        re.compile("^plugins/session-and-git/"),
        "승계 출처 표기 — 레거시 `session-and-git` 플러그인 경로이지 이 트리 경로가 아니다",
        re.compile("^skills/gitrules/references/"),
    ),
    (
        re.compile("^/path/to/file\\d+\\.(md|py)$"),
        "gemini 위임 예문의 인자 자리표시자 — 사용자 파일을 가리키는 예시다",
        re.compile("^skills/consult/references/gemini\\.md$"),
    ),
    (
        re.compile("^SESSIONS/"),
        "`$SESSIONS` 변수 아래 런타임 산출 경로 — 세션 내보내기 디렉터리이지 트리 참조가 아니다",
        re.compile("^skills/recall/SKILL\\.md$"),
    ),
    (
        re.compile("^\\.claude-plugin/marketplace\\.json$"),
        "마켓플레이스 **저장소 루트**의 마커 파일 — install.py 가 상향탐색하는 대상이지 플러그인 트리 파일이 아니다",
        re.compile("^skills/bridge/(SKILL\\.md|tests/run_tests\\.py)$"),
    ),
    (
        re.compile("^skills/gitrules/scripts/check\\.py$"),
        "설치 시험용 가짜 SKILL.md 본문 안의 경로 — 치환 규칙이 토큰을 보존하는지 재는 픽스처다",
        re.compile("^skills/bridge/tests/run_tests\\.py$"),
    ),
    (
        re.compile("^src/main\\.rs$"),
        'Cargo.toml 의 `path = "src/main.rs"` 선언 문자열 — bin/ 기준 상대경로이며 실물은 bin/src/main.rs',
        re.compile("^skills/recall/tests/run_tests\\.py$"),
    ),
    (
        re.compile("^docs/tests/TEST_PLAN\\.md$|^CLAUDE\\.md$"),
        "사용자 프로젝트 쪽 런타임 대상 예시 — 로더/가이드가 대상 저장소 기준으로 말한다",
        re.compile(
            "^skills/(tdd/(SKILL\\.md|langs/[a-z]+\\.md)|setup/scripts/load_guidelines\\.py)$"
        ),
    ),
]
SKIP_DIRS = {".git", ".omc", "__pycache__", "node_modules", "repos", "results"}
DIRT_DIRS = {".omc", "__pycache__"}
SCAN_EXT = {".md", ".py", ".json", ".yaml", ".yml"}


def _tracked(path):
    r = subprocess.run(
        ["git", "check-ignore", "-q", path],
        capture_output=True,
        cwd=os.path.dirname(path) or ".",
    )
    return r.returncode != 0


def walk(root):
    files, dirt = ([], [])
    for dirpath, dirnames, filenames in os.walk(root):
        for d in list(dirnames):
            full = os.path.join(dirpath, d)
            if d in DIRT_DIRS and _tracked(full):
                dirt.append(os.path.relpath(full, root))
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if fn.endswith(".pyc") and _tracked(full):
                dirt.append(os.path.relpath(full, root))
            if os.path.splitext(fn)[1] in SCAN_EXT:
                files.append(full)
    return (files, dirt)


def skill_root(path, root):
    rel = os.path.relpath(path, root).split(os.sep)
    if len(rel) >= 2 and rel[0] == "skills":
        return os.path.join(root, "skills", rel[1])
    return root


CMDY = re.compile("`/([a-z][a-z0-9-]{1,24})`")
CMD_IGNORE = [
    (
        re.compile(r"^projects$"),
        "Native Claude data-directory suffix, not a slash command",
        re.compile(r"^skills/recall/SKILL\.md$"),
    ),
    (
        re.compile("^commands$"),
        "Prose pairing skills/commands",
        re.compile("^CAPABILITIES\\.md$"),
    ),
    (
        re.compile("^skill-name$"),
        "Example skill placeholder",
        re.compile("^skills/team/references/agent-design-patterns\\.md$"),
    ),
    (
        re.compile("^plugin$"),
        "Claude Code 자체의 설정 커맨드 — 우리 것이 아니다",
        re.compile("author/references/placement\\.md$"),
    ),
    (
        re.compile("^create$"),
        "프론트엔드 링크 경로 예시(`/dashboard/create` 대 `/create`)이지 커맨드가 아니다",
        re.compile("team/references/qa-agent-guide\\.md$"),
    ),
    (
        re.compile("^edit$"),
        "Google Docs URL 접미사(`.../edit`)이지 커맨드가 아니다",
        re.compile("workspace/references/report-troubleshooting\\.md$"),
    ),
    (
        re.compile("^(papers|fda|trials|proteins|clipboard)$"),
        "Paperclip CLI 의 가상 파일시스템 경로이지 커맨드가 아니다 — 상류 카탈로그 인용",
        re.compile("science/references/_kdense-catalog\\.md$"),
    ),
]


def command_refs(root, files):
    fired_cmd = set()
    cmd_dir = os.path.join(root, "commands")
    have = set()
    if os.path.isdir(cmd_dir):
        have = {n[:-3] for n in os.listdir(cmd_dir) if n.endswith(".md")}
    out, n = ([], 0)
    for path in files:
        if not path.endswith(".md"):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        src = os.path.relpath(path, root)
        for m in CMDY.finditer(text):
            name = m.group(1)
            if name in have:
                n += 1
                continue
            reason = next(
                (
                    e[1]
                    for e in CMD_IGNORE
                    if e[0].search(name) and (e[2] is None or e[2].search(src))
                ),
                None,
            )
            if reason:
                fired_cmd.add(reason)
                continue
            n += 1
            line = text[: m.start()].count("\n") + 1
            out.append((name, f"{src}:{line}"))
    _srcs = [os.path.relpath(f, root) for f in files]
    unused_cmd = [
        e[1]
        for e in CMD_IGNORE
        if e[1] not in fired_cmd
        and (e[2] is None or any((e[2].search(s) for s in _srcs)))
    ]
    return (n, out, sorted(have), unused_cmd)


def main():
    if len(sys.argv) < 2:
        print("usage: check_plugin_paths.py <plugin-dir>", file=sys.stderr)
        return 2
    root = os.path.abspath(sys.argv[1])
    if not os.path.isdir(root):
        print(f"[ERROR] 디렉토리 부재: {root}", file=sys.stderr)
        return 2
    files, dirt = walk(root)
    total = 0
    misses = []
    total = 0
    misses = []
    ignored = 0
    fired = set()
    for path in files:
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        src = os.path.relpath(path, root)
        here = os.path.dirname(path)
        sroot = skill_root(path, root)
        seen = set()
        cleaned = ROOT_VAR.sub("", text)
        win = WIN_VAR.sub("", cleaned)
        refs = [m.group(1) for m in PATHY.finditer(cleaned)]
        refs += [m.group(1).replace("\\", "/") for m in WIN_PATHY.finditer(win)]
        for ref in refs:
            if ref.startswith("./"):
                ref = ref[2:]
            key = (ref, src)
            if key in seen:
                continue
            seen.add(key)
            reason = next(
                (
                    e[1]
                    for e in IGNORE
                    if e[0].search(ref)
                    and (len(e) < 3 or e[2] is None or e[2].search(src))
                ),
                None,
            )
            if reason:
                ignored += 1
                fired.add(reason)
                continue
            total += 1
            cands = [
                os.path.join(here, ref),
                os.path.join(sroot, ref),
                os.path.join(root, ref),
                os.path.join(os.path.dirname(sroot), ref),
            ]
            if not any((os.path.exists(c) for c in cands)):
                misses.append((ref, src))
    cmd_total, cmd_miss, cmd_have, cmd_unused = command_refs(root, files)
    _srcs = [os.path.relpath(f, root) for f in files]
    unused = [
        e[1]
        for e in IGNORE
        if e[1] not in fired
        and (len(e) < 3 or e[2] is None or any((e[2].search(s) for s in _srcs)))
    ]
    print(
        f"참조 {total}건 / 실재 {total - len(misses)}건 / MISS {len(misses)}건 (무시 {ignored}건 / 미발화 배제규칙 {len(unused)}건)"
    )
    if unused:
        print("  미발화 배제규칙 — 쓰이지 않는 배제는 장차 진짜 결함을 가린다:")
        for r in unused:
            print(f"    · {r}")
    if misses:
        print("\nMISS:")
        for ref, src in misses:
            print(f"  {ref}\n    <- {src}")
    print(
        f"커맨드 참조 {cmd_total}건 / 실재 {cmd_total - len(cmd_miss)}건 / MISS {len(cmd_miss)}건 (이 플러그인의 커맨드 {len(cmd_have)}종)"
    )
    if cmd_unused:
        print("  미발화 커맨드 배제규칙 — 안 쓰이는 배제는 장차 진짜 결함을 가린다:")
        for r in cmd_unused:
            print(f"    · {r}")
    if cmd_miss:
        print("\n커맨드 MISS — 문서가 없는 커맨드를 가리킨다:")
        for name, where in cmd_miss:
            print(f"  /{name}\n    <- {where}")
    if dirt:
        print(
            f"\n위생 위반 {len(dirt)}건 — **git 이 추적하는** .omc / __pycache__ / *.pyc:"
        )
        for d in sorted(dirt)[:10]:
            print(f"  {d}")
    return 1 if misses or dirt or cmd_miss else 0


if __name__ == "__main__":
    sys.exit(main())
