#!/usr/bin/env python3
"""Run one repository task from an immutable contract to fresh receipts.

All state is local to .jstack/tasks/TASK. This program does not spawn agents or
contact providers. A harness may use the generated brief and later attach a
coordinator receipt for a native independent or human review.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import signal
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

PACKAGE_ROOT = Path(__file__).resolve().parents[3]
LINTER = PACKAGE_ROOT / "skills/plan/scripts/contract_lint.py"
PACKAGE_IDENTITY = Path(__file__).resolve().with_name("package_identity.py")
SECURITY_CONTRACT = Path(__file__).resolve().with_name("security_contract.py")
TASK_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class Error(Exception):
    pass


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest_file(path):
    return digest_bytes(path.read_bytes())


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)


def run_git(repo, *args):
    run = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if run.returncode:
        raise Error(run.stderr.strip() or "git command failed")
    return run.stdout.strip()


def repository():
    run = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if run.returncode:
        raise Error("run this inside a Git repository")
    return Path(run.stdout.strip()).resolve()


def repo_identity(repo):
    common = Path(run_git(repo, "rev-parse", "--git-common-dir"))
    if not common.is_absolute():
        common = repo / common
    return {"root": str(repo), "gitCommonDir": str(common.resolve())}


def task_root(repo, task):
    if not TASK_RE.fullmatch(task):
        raise Error("invalid task ID format")
    return repo / ".jstack/tasks" / task


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Error(f"{path} cannot be read: {exc}") from exc


def linter_module():
    spec = importlib.util.spec_from_file_location("jstack_contract_lint", LINTER)
    if spec is None or spec.loader is None:
        raise Error("cannot load contract_lint.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def security_module():
    spec = importlib.util.spec_from_file_location("jstack_security_contract",
                                                  SECURITY_CONTRACT)
    if spec is None or spec.loader is None:
        raise Error("cannot load security_contract.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def security_at(root, repo, contract, validate_initial=False):
    module = security_module()
    try:
        return module.load(root, repo, contract, validate_initial=validate_initial)
    except module.SecurityError as exc:
        raise Error(f"invalid security verification specification: {exc}") from exc


def coordinator_identity():
    spec = importlib.util.spec_from_file_location("jstack_package_identity",
                                                  PACKAGE_IDENTITY)
    if spec is None or spec.loader is None:
        raise Error("cannot load package_identity.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        identity = module.compute_identity(PACKAGE_ROOT)
    except module.IdentityError as exc:
        raise Error(f"cannot compute coordinator package identity: {exc}") from exc
    return {"schema": identity["schema"], "algorithm": identity["algorithm"],
            "package": identity["package"],
            "runtimeDigest": identity["digests"]["runtime"]}


def contract_at(root):
    path = root / "contract.yaml"
    loaded, error = linter_module().load_contract(str(path))
    if error:
        raise Error(error)
    data, _source = loaded
    return data, digest_file(path)


def lint_contract(root, repo):
    command = [sys.executable, str(LINTER), str(root / "contract.yaml")]
    run = subprocess.run(command, cwd=repo, capture_output=True, text=True)
    return {"command": command, "exitCode": run.returncode,
            "stdout": run.stdout, "stderr": run.stderr}


def argv(command):
    try:
        result = shlex.split(command)
    except ValueError as exc:
        raise Error(f"command syntax error: {exc}") from exc
    if not result:
        raise Error("cannot execute an empty command")
    return result


def executable(command, repo):
    first = argv(command)[0]
    if "/" in first:
        path = Path(first)
        if not path.is_absolute():
            path = repo / path
        return path.is_file(), str(path)
    found = shutil.which(first)
    return found is not None, found or first


def tool_fingerprints(contract, repo):
    commands = [x["확인명령"] for x in contract.get("준비", [])]
    for req in requirements(contract):
        commands.extend((req["명령"]["실행"],
                         req["반증"]["실행"].replace("{RED_ROOT}", ".")))
    result = {}
    for command in commands:
        available, resolved = executable(command, repo)
        path = Path(resolved)
        result[argv(command)[0]] = {
            "available": available, "resolved": resolved,
            "sha256": hash_path(path.resolve()) if available and path.exists() else None,
        }
    return result


def readiness(contract, repo, timeout_seconds=120.0):
    ok, probes = True, []
    for item in contract.get("준비", []):
        found = shutil.which(item["도구"])
        probe = run_command(item["확인명령"], repo,
                            timeout_seconds=timeout_seconds) if found else {
            "command": item["확인명령"], "exitCode": 127,
            "stdout": "", "stderr": f"tool not found: {item['도구']}"}
        probes.append({"tool": item["도구"], "resolved": found, "probe": probe})
        ok = ok and bool(found) and probe["exitCode"] == 0
    commands = []
    for req in requirements(contract):
        for kind in ("명령", "반증"):
            command = req[kind]["실행"].replace("{RED_ROOT}", ".")
            available, resolved = executable(command, repo)
            commands.append({"requirementId": req["요구ID"], "kind": kind,
                             "available": available, "resolved": resolved})
            ok = ok and available
    return probes, commands, ok


def run_command(command, cwd, env=None, timeout_seconds=120.0):
    if timeout_seconds <= 0:
        raise Error("command timeout must be greater than zero")
    started = time.time()
    timed_out = False
    try:
        proc = subprocess.Popen(argv(command), cwd=cwd, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, errors="replace",
                                start_new_session=True)
        pid = proc.pid
        try:
            out, err = proc.communicate(timeout=timeout_seconds)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                out, err = proc.communicate(timeout=1.0)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                out, err = proc.communicate()
            rc = 124
    except OSError as exc:
        out, err, rc, pid = "", str(exc), 127, None
    return {"command": command, "exitCode": rc, "processPid": pid,
            "timedOut": timed_out, "timeoutSeconds": timeout_seconds,
            "stdout": out, "stderr": err,
            "outputSha256": digest_bytes((out + "\0" + err).encode()),
            "durationSeconds": round(time.time() - started, 6)}


def safe_path(repo, value):
    path = (repo / value).resolve()
    try:
        path.relative_to(repo)
    except ValueError as exc:
        raise Error(f"paths outside the repository are not allowed: {value}") from exc
    git_dirs = {(repo / ".git").resolve(),
                Path(repo_identity(repo)["gitCommonDir"]).resolve()}
    if any(path == marker or marker in path.parents for marker in git_dirs):
        raise Error(f"paths inside Git metadata cannot be evidence or targets: {value}")
    return path


def hash_path(path):
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink():
        return digest_bytes(("link\0" + os.readlink(path)).encode())
    if path.is_file():
        return digest_bytes(b"file\0" + path.read_bytes())
    rows = []
    for child in sorted(path.rglob("*")):
        if ".git" in child.parts:
            continue
        rel = child.relative_to(path).as_posix()
        if child.is_symlink():
            rows.append((rel, "link", os.readlink(child)))
        elif child.is_file():
            rows.append((rel, "file", digest_file(child)))
    return digest_bytes(canonical(rows))


def requirements(contract):
    result = contract.get("검증")
    if not isinstance(result, list) or not result:
        raise Error("verification requirements are empty")
    return result


def target_hashes(repo, contract):
    values = sorted({p for item in requirements(contract)
                     for p in item.get("관련파일", [])})
    return {value: hash_path(safe_path(repo, value)) for value in values}


def git_state_hash(repo, root):
    run = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd=repo, capture_output=True)
    if run.returncode:
        raise Error(run.stderr.decode(errors="replace"))
    prefix = root.relative_to(repo).as_posix() + "/"
    kept = []
    for record in run.stdout.split(b"\0"):
        if not record:
            continue
        text = record.decode(errors="surrogateescape")
        path = text[3:] if len(text) >= 3 else text
        if path == prefix[:-1] or path.startswith(prefix):
            continue
        kept.append(record)
    return digest_bytes(b"\0".join(sorted(kept)))


def open_task(repo, task):
    root = task_root(repo, task)
    meta = read_json(root / "task.json")
    if meta.get("taskId") != task:
        raise Error("task.json has a different task ID")
    if meta.get("repository") != repo_identity(repo):
        raise Error("task is bound to a different repository identity")
    contract, current = contract_at(root)
    if current != meta.get("contractSha256"):
        raise Error("the contract changed after initialization; existing evidence is invalid")
    if contract.get("작업ID") != task:
        raise Error("contract has a different task ID")
    return root, meta, contract, current


def init(args):
    repo = repository()
    root = task_root(repo, args.task)
    if root.exists():
        raise Error(f"task already exists: {root}")
    source = Path(args.contract).resolve()
    if not source.is_file():
        raise Error("contract file does not exist")
    root.mkdir(parents=True)
    shutil.copyfile(source, root / "contract.yaml")
    # Security evidence is immutable task input.  Copy only the explicitly
    # named task-local tree; never execute or discover commands while copying.
    try:
        copied_contract, _copied_hash = contract_at(root)
    except Error:
        shutil.rmtree(root)
        raise
    source_security = source.parent / "security"
    if copied_contract.get("보안검증") is not None and source_security.exists():
        if source_security.is_symlink() or not source_security.is_dir():
            shutil.rmtree(root)
            raise Error("security input must be a directory, not a symlink")
        shutil.copytree(source_security, root / "security", symlinks=True)
    lint = lint_contract(root, repo)
    if lint["exitCode"]:
        shutil.rmtree(root)
        print(lint["stderr"], file=sys.stderr, end="")
        return 1
    contract, contract_hash = contract_at(root)
    if contract.get("계약버전") != 2 or contract.get("작업ID") != args.task:
        shutil.rmtree(root)
        raise Error("workflow requires contract version 2 with the same task ID")
    # Resolve every path and hash before accepting the task.  A copied symlink
    # or stale source therefore cannot become a later execution input.
    try:
        security_at(root, repo, contract, validate_initial=True)
    except Error:
        shutil.rmtree(root)
        raise
    write_json(root / "task.json", {
        "schemaVersion": 1, "taskId": args.task, "createdAt": utcnow(),
        "repository": repo_identity(repo), "contractSha256": contract_hash})
    write_json(root / "state.json", {
        "schemaVersion": 1, "phase": "planned", "needsVerification": True,
        "updatedAt": utcnow(), "cursor": None, "evidence": []})
    print(json.dumps({"task": args.task, "phase": "planned",
                      "contractSha256": contract_hash}, ensure_ascii=False))
    return 0


def preflight(args):
    repo = repository()
    root, _meta, contract, contract_hash = open_task(repo, args.task)
    lint = lint_contract(root, repo)
    security = security_at(root, repo, contract)
    security_preflight = (security_module().preflight(security, run_command)
                          if security else None)
    security_ready = security_preflight is None or security_preflight["passed"]
    if security_ready:
        probes, commands, ready_now = readiness(contract, repo, args.timeout_seconds)
    else:
        probes, commands, ready_now = [], [], False
    ok = (lint["exitCode"] == 0 and ready_now
          and security_ready)
    receipt = {"schemaVersion": 1, "taskId": args.task, "recordedAt": utcnow(),
               "contractSha256": contract_hash, "repository": repo_identity(repo),
               "linter": lint, "probes": probes, "commands": commands,
               "toolFingerprints": tool_fingerprints(contract, repo),
               "securityFingerprints": security["fingerprints"] if security else None,
               "securityPreflight": security_preflight,
               "passed": ok}
    write_json(root / "preflight.json", receipt)
    state = read_json(root / "state.json")
    state.update({"phase": "ready" if ok else "blocked",
                  "needsVerification": True, "updatedAt": utcnow()})
    write_json(root / "state.json", state)
    print(json.dumps({"task": args.task, "preflight": ok}, ensure_ascii=False))
    return 0 if ok else 1


def brief(args):
    repo = repository()
    root, _meta, contract, contract_hash = open_task(repo, args.task)
    ready = read_json(root / "preflight.json")
    if not ready.get("passed") or ready.get("contractSha256") != contract_hash:
        raise Error("a passing preflight for the current contract is required")
    result = {"schemaVersion": 1, "taskId": args.task, "createdAt": utcnow(),
              "contractSha256": contract_hash, "delegation": contract["위임"],
              "requirements": brief_projection(contract),
              "boundary": "Local brief only; the native harness owns agent operations."}
    write_json(root / "brief.json", result)
    state = read_json(root / "state.json")
    state.update({"phase": "delegated" if contract["위임"] == "필요" else "working",
                  "needsVerification": True, "updatedAt": utcnow()})
    write_json(root / "state.json", state)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def brief_projection(contract):
    return [
        {"requirementId": x["요구ID"], "userBehavior": x["사용자행동"],
         "ownedFiles": x["관련파일"], "positive": x["명령"],
         "negativeControl": x["반증"],
         "additionalReviews": x.get("추가검토", [])}
        for x in requirements(contract)
    ]


def evidence(repo, values):
    result = []
    for value in values:
        digest = hash_path(safe_path(repo, value))
        if digest is None:
            raise Error(f"evidence file does not exist: {value}")
        result.append({"path": value, "sha256": digest})
    return result


def interrupt(args):
    repo = repository()
    root, _meta, _contract, contract_hash = open_task(repo, args.task)
    cursor = evidence(repo, [args.cursor_file])[0]
    state = read_json(root / "state.json")
    state.update({"phase": "interrupted", "needsVerification": True,
                  "updatedAt": utcnow(), "contractSha256": contract_hash,
                  "cursor": cursor, "evidence": evidence(repo, args.evidence),
                  "live": {"head": run_git(repo, "rev-parse", "HEAD"),
                           "gitStateSha256": git_state_hash(repo, root)}})
    write_json(root / "state.json", state)
    print(json.dumps({"task": args.task, "phase": "interrupted"}, ensure_ascii=False))
    return 0


def resume(args):
    repo = repository()
    root, _meta, _contract, _contract_hash = open_task(repo, args.task)
    state = read_json(root / "state.json")
    if state.get("phase") != "interrupted":
        raise Error("task is not interrupted")
    rows = [state.get("cursor")] + list(state.get("evidence", []))
    stale = [x.get("path") for x in rows if not x or
             hash_path(safe_path(repo, x.get("path", ""))) != x.get("sha256")]
    live = {"repository": repo_identity(repo),
            "head": run_git(repo, "rev-parse", "HEAD"),
            "gitStateSha256": git_state_hash(repo, root)}
    if stale:
        print(json.dumps({"task": args.task, "resumed": False,
                          "staleEvidence": stale, "live": live}, ensure_ascii=False))
        return 1
    state.update({"phase": "working", "needsVerification": True,
                  "updatedAt": utcnow(), "liveAtResume": live})
    write_json(root / "state.json", state)
    print(json.dumps({"task": args.task, "resumed": True,
                      "cursor": state["cursor"], "evidence": state["evidence"],
                      "live": live}, ensure_ascii=False))
    return 0


def record_review(args):
    repo = repository()
    root, _meta, contract, contract_hash = open_task(repo, args.task)
    req = next((x for x in requirements(contract)
                if x["요구ID"] == args.requirement), None)
    if req is None:
        raise Error("unknown requirement ID")
    expected = {"human"} if req["인간검토"] == "필요" else set()
    expected.update(x["종류"] for x in req.get("추가검토", [])
                    if x["적용"] == "필요")
    if args.kind not in expected:
        raise Error("the contract does not require this review kind")
    raw = safe_path(repo, args.raw_output)
    if not raw.is_file() or not raw.read_bytes():
        raise Error("a nonempty raw review result is required")
    selected = args.reviewed_file or req["관련파일"]
    omitted = sorted(set(req["관련파일"]) - set(selected))
    if omitted:
        raise Error(f"all files associated with the requirement must be reviewed: {', '.join(omitted)}")
    reviewed = evidence(repo, selected)
    receipt = {"schemaVersion": 1, "taskId": args.task,
               "requirementId": args.requirement, "kind": args.kind,
               "recordedAt": utcnow(), "contractSha256": contract_hash,
               "verdict": args.verdict,
               "rawOutput": {"path": args.raw_output, "sha256": digest_file(raw)},
               "reviewedFiles": reviewed,
               "trustBoundary": (
                   "This coordinator receipt binds bytes and a verdict. It does "
                   "not prove reviewer identity or independence by itself.")}
    path = root / "reviews" / f"{args.requirement}--{args.kind}.json"
    write_json(path, receipt)
    print(json.dumps({"recorded": str(path.relative_to(repo)),
                      "verdict": args.verdict}, ensure_ascii=False))
    return 0


def required_reviews(contract):
    result = []
    for req in requirements(contract):
        if req["인간검토"] == "필요":
            result.append((req, "human"))
        result.extend((req, x["종류"]) for x in req.get("추가검토", [])
                      if x["적용"] == "필요")
    return result


def review_evidence(repo, root, contract, contract_hash):
    rows, missing = [], []
    for req, kind in required_reviews(contract):
        path = root / "reviews" / f"{req['요구ID']}--{kind}.json"
        if not path.is_file():
            missing.append(f"{req['요구ID']}:{kind}")
            continue
        item = read_json(path)
        covered = {x.get("path") for x in item.get("reviewedFiles", [])
                   if isinstance(x, dict)}
        valid = (item.get("contractSha256") == contract_hash and
                 item.get("verdict") == "pass" and
                 set(req["관련파일"]) <= covered)
        raw = item.get("rawOutput", {})
        try:
            valid = valid and digest_file(safe_path(repo, raw["path"])) == raw["sha256"]
            for bound in item.get("reviewedFiles", []):
                valid = valid and hash_path(safe_path(repo, bound["path"])) == bound["sha256"]
        except (Error, KeyError, OSError):
            valid = False
        if valid:
            rows.append({"path": str(path.relative_to(root)),
                         "sha256": digest_file(path)})
        else:
            missing.append(f"{req['요구ID']}:{kind}")
    return rows, missing


def red_copy(repo, req):
    tmp = tempfile.TemporaryDirectory(prefix="jstack-red-")
    root = Path(tmp.name)
    for value in req["관련파일"]:
        source = safe_path(repo, value)
        target = root / value
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target, symlinks=True)
        elif source.is_symlink():
            target.symlink_to(os.readlink(source))
        elif source.is_file():
            shutil.copy2(source, target)
    return tmp, root


def verify(args):
    repo = repository()
    # The contract linter is the first verifier. Do not trust even the task
    # metadata or a previous receipt before the current contract parses.
    root = task_root(repo, args.task)
    lint = lint_contract(root, repo)
    if lint["exitCode"]:
        print(json.dumps({"task": args.task, "verified": False,
                          "reason": "contract-lint", "linter": lint},
                         ensure_ascii=False))
        return 1
    root, _meta, contract, contract_hash = open_task(repo, args.task)
    # This gate precedes all project commands.  Security tasks cannot use the
    # generic positive command as an unchecked route to execute an untrusted target.
    security = security_at(root, repo, contract)
    ready = read_json(root / "preflight.json")
    if not ready.get("passed") or ready.get("contractSha256") != contract_hash:
        raise Error("there is no preflight for the current contract")
    security_preflight = (security_module().preflight(security, run_command)
                          if security else None)
    security_ready = security_preflight is None or security_preflight["passed"]
    if security_ready:
        probes, commands, ready_now = readiness(contract, repo, args.timeout_seconds)
    else:
        probes, commands, ready_now = [], [], False
    if contract["위임"] == "필요":
        delegated = read_json(root / "brief.json")
        if (delegated.get("contractSha256") != contract_hash or
                delegated.get("requirements") != brief_projection(contract)):
            raise Error("there is no delegation brief for the current contract")
    before = target_hashes(repo, contract)
    results, passed = [], ready_now
    security_result = None
    if ready_now:
        if security:
            security_result = security_module().execute(security, run_command)
            passed = passed and security_result["passed"]
        for req in requirements(contract):
            positive = run_command(req["명령"]["실행"], repo,
                                   timeout_seconds=args.timeout_seconds)
            temp, red_root = red_copy(repo, req)
            try:
                red_command = req["반증"]["실행"].replace("{RED_ROOT}", str(red_root))
                negative = run_command(red_command, repo,
                                       timeout_seconds=args.timeout_seconds)
            finally:
                temp.cleanup()
            one = (positive["exitCode"] == req["명령"]["기대종료"] and
                   negative["exitCode"] == req["반증"]["기대종료"])
            results.append({"requirementId": req["요구ID"], "positive": positive,
                            "negativeControl": negative, "passed": one})
            passed = passed and one
    after = target_hashes(repo, contract)
    stable = before == after and all(x is not None for x in after.values())
    security_after = security_at(root, repo, contract)
    security_stable = ((security_after["fingerprints"] if security_after else None)
                       == (security["fingerprints"] if security else None))
    reviews, missing = review_evidence(repo, root, contract, contract_hash)
    passed = passed and stable and security_stable and not missing
    receipt = {"schemaVersion": 1, "taskId": args.task, "recordedAt": utcnow(),
               "contractSha256": contract_hash, "repository": repo_identity(repo),
               "head": run_git(repo, "rev-parse", "HEAD"),
               "gitStateSha256": git_state_hash(repo, root),
               "runtime": {"python": sys.version, "executable": sys.executable,
                           "platform": platform.platform(),
                           "coordinatorPid": os.getpid()},
               "coordinatorPackage": coordinator_identity(),
               "linter": lint, "preflightSha256": digest_file(root / "preflight.json"),
               "readiness": {"probes": probes, "commands": commands,
                             "toolFingerprints": tool_fingerprints(contract, repo),
                             "passed": ready_now},
               "briefSha256": digest_file(root / "brief.json")
                   if (root / "brief.json").is_file() else None,
               "requirements": results, "targetsBefore": before,
               "targetsAfter": after, "targetsStable": stable,
               "security": security_result,
               "securityPreflight": security_preflight,
               "securityFingerprints": security_after["fingerprints"] if security_after else None,
               "securityStable": security_stable,
               "reviews": reviews, "missingReviews": missing, "passed": passed}
    name = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ.json")
    receipt_path = root / "receipts" / name
    write_json(receipt_path, receipt)
    state = read_json(root / "state.json")
    state.update({"phase": "complete" if passed else "blocked",
                  "needsVerification": not passed, "updatedAt": utcnow(),
                  "latestReceipt": str(receipt_path.relative_to(root)),
                  "latestReceiptSha256": digest_file(receipt_path)})
    write_json(root / "state.json", state)
    print(json.dumps({"task": args.task, "verified": passed,
                      "receipt": str(receipt_path.relative_to(repo)),
                      "missingReviews": missing, "targetsStable": stable},
                     ensure_ascii=False))
    return 0 if passed else 1


def assess(repo, root, contract, contract_hash):
    state = read_json(root / "state.json")
    problems = []
    if state.get("phase") != "complete" or state.get("needsVerification"):
        problems.append("verification-required")
    rel = state.get("latestReceipt")
    if not rel:
        return {"complete": False, "problems": problems + ["missing-receipt"]}
    path = root / rel
    receipt = read_json(path)
    if digest_file(path) != state.get("latestReceiptSha256"):
        problems.append("receipt-digest")
    if not receipt.get("passed"):
        problems.append("receipt-failed")
    if receipt.get("contractSha256") != contract_hash:
        problems.append("contract-stale")
    if receipt.get("repository") != repo_identity(repo):
        problems.append("repository-stale")
    if receipt.get("coordinatorPackage") != coordinator_identity():
        problems.append("coordinator-package-stale")
    if receipt.get("head") != run_git(repo, "rev-parse", "HEAD"):
        problems.append("head-stale")
    if receipt.get("gitStateSha256") != git_state_hash(repo, root):
        problems.append("git-state-stale")
    preflight_path = root / "preflight.json"
    if (not preflight_path.is_file() or
            receipt.get("preflightSha256") != digest_file(preflight_path)):
        problems.append("preflight-stale")
    brief_path = root / "brief.json"
    if contract["위임"] == "필요":
        if (not brief_path.is_file() or
                receipt.get("briefSha256") != digest_file(brief_path)):
            problems.append("brief-stale")
    elif receipt.get("briefSha256") is not None:
        if (not brief_path.is_file() or
                receipt.get("briefSha256") != digest_file(brief_path)):
            problems.append("brief-stale")
    if receipt.get("targetsAfter") != target_hashes(repo, contract):
        problems.append("target-stale")
    try:
        security = security_at(root, repo, contract)
        current_security = security["fingerprints"] if security else None
        if receipt.get("securityFingerprints") != current_security:
            problems.append("security-stale")
        if security and not (receipt.get("security") or {}).get("passed"):
            problems.append("security-failed")
    except Error:
        problems.append("security-stale")
    if (receipt.get("readiness") or {}).get(
            "toolFingerprints") != tool_fingerprints(contract, repo):
        problems.append("tool-stale")
    _reviews, missing = review_evidence(repo, root, contract, contract_hash)
    problems.extend(f"review-stale:{x}" for x in missing)
    return {"complete": not problems, "problems": problems,
            "receipt": str(path.relative_to(repo))}


def status(args):
    repo = repository()
    try:
        root, _meta, contract, contract_hash = open_task(repo, args.task)
        result = assess(repo, root, contract, contract_hash)
    except Error as exc:
        result = {"complete": False, "problems": [str(exc)]}
    result["task"] = args.task
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["complete"] else 1


def make_parser():
    parser = argparse.ArgumentParser(description="Bind one task from plan through verification")
    sub = parser.add_subparsers(dest="action", required=True)
    first = sub.add_parser("init")
    first.add_argument("task")
    first.add_argument("contract")
    first.set_defaults(function=init)
    for name, function in (("preflight", preflight), ("brief", brief),
                           ("resume", resume), ("verify", verify),
                           ("status", status)):
        item = sub.add_parser(name)
        item.add_argument("task")
        if name in ("preflight", "verify"):
            item.add_argument("--timeout-seconds", type=float, default=120.0,
                              help="Timeout for each command; default: 120 seconds")
        item.set_defaults(function=function)
    stop = sub.add_parser("interrupt")
    stop.add_argument("task")
    stop.add_argument("--cursor-file", required=True)
    stop.add_argument("--evidence", action="append", default=[])
    stop.set_defaults(function=interrupt)
    review = sub.add_parser("record-review")
    review.add_argument("task")
    review.add_argument("requirement")
    review.add_argument("kind")
    review.add_argument("--raw-output", required=True)
    review.add_argument("--reviewed-file", action="append")
    review.add_argument("--verdict", choices=("pass", "fail"), required=True)
    review.set_defaults(function=record_review)
    return parser


def main():
    args = make_parser().parse_args()
    try:
        return args.function(args)
    except Error as exc:
        print(f"workflow: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
