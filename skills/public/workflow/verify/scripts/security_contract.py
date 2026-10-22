#!/usr/bin/env python3
"""Validate and evaluate the optional task security contract.

This module deliberately does not start processes.  ``workflow.py`` remains the
only process owner and supplies its existing ``run_command`` implementation.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil


class SecurityError(Exception):
    pass


ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FINDING_STATES = {"candidate", "confirmed", "refuted", "inconclusive"}
EVIDENCE_LEVELS = {"static", "execution"}
STAGES = {"reproduce", "fix-reproduce", "regression", "variant"}
BOUNDARIES = {"trusted-local", "isolated"}


def _sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _inside(base, value, *, file=True):
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise SecurityError(f"relative path required: {value!r}")
    candidate = base / value
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(base.resolve())
    except (OSError, ValueError) as exc:
        raise SecurityError(f"path is missing or escapes its boundary: {value}") from exc
    relative = candidate.relative_to(base)
    walked = base
    has_link = False
    for part in relative.parts:
        walked = walked / part
        has_link = has_link or walked.is_symlink()
    if has_link:
        raise SecurityError(f"symlinks are not allowed in security evidence: {value}")
    if file and not resolved.is_file():
        raise SecurityError(f"not a file: {value}")
    return resolved


def _json(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SecurityError(f"cannot read JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SecurityError(f"top-level JSON value is not an object: {path}")
    return value


def lint_link(contract):
    """Return optional-link schema violations without reading task files."""
    link = contract.get("보안검증")
    if link is None:
        return []
    bad = []
    if contract.get("계약버전") != 2:
        return ["security verification is available only in contract version 2"]
    if not isinstance(link, dict):
        return ["security verification is not a mapping"]
    path = link.get("명세")
    if (not isinstance(path, str) or not path.startswith("security/")
            or Path(path).is_absolute() or ".." in Path(path).parts):
        bad.append("security verification specification must be a relative path under security/")
    ids = link.get("요구ID")
    if not isinstance(ids, list) or not ids:
        bad.append("security verification requirement IDs are empty")
    elif len(ids) != len(set(ids)) or not all(isinstance(x, str) and ID_RE.fullmatch(x)
                                               for x in ids):
        bad.append("security verification requirement IDs have invalid format or duplicates")
    known = {x.get("요구ID") for x in contract.get("검증", []) if isinstance(x, dict)}
    for rid in ids if isinstance(ids, list) else []:
        if rid not in known:
            bad.append(f"security requirement ID does not link to a verification requirement: {rid}")
        req = next((x for x in contract.get("검증", [])
                    if isinstance(x, dict) and x.get("요구ID") == rid), {})
        independent = [x for x in req.get("추가검토", []) if isinstance(x, dict)
                       and x.get("종류") == "평가독립성" and x.get("적용") == "필요"]
        if not independent:
            bad.append(f"security requirement ID needs a required evaluation-independence review: {rid}")
    return bad


def load(task_root, repo, contract, validate_initial=False):
    """Load, validate, and fingerprint an optional security specification."""
    link = contract.get("보안검증")
    if link is None:
        return None
    errors = lint_link(contract)
    if errors:
        raise SecurityError("; ".join(errors))
    spec_path = _inside(task_root, link["명세"])
    spec = _json(spec_path)
    if spec.get("schemaVersion") != 1 or spec.get("taskId") != contract.get("작업ID"):
        raise SecurityError("security specification schemaVersion/taskId does not match the contract")
    target = spec.get("target")
    if not isinstance(target, dict) or not str(target.get("ref", "")).strip():
        raise SecurityError("target.ref is empty")
    target_files = target.get("files")
    if not isinstance(target_files, list) or not target_files:
        raise SecurityError("target.files is empty")
    target_hashes, target_paths = {}, []
    for row in target_files:
        if not isinstance(row, dict) or not isinstance(row.get("sha256"), str):
            raise SecurityError("invalid target.files entry")
        path = _inside(repo, row.get("path"))
        actual = _sha256(path)
        if validate_initial and actual != row["sha256"]:
            raise SecurityError(f"initial target hash differs from the specification: {row.get('path')}")
        target_hashes[row["path"]] = actual
        target_paths.append(path)
    baseline = target.get("baseline")
    if not isinstance(baseline, dict) or not str(baseline.get("ref", "")).strip():
        raise SecurityError("target.baseline.ref is empty")
    baseline_hashes, baseline_paths = {}, []
    if not isinstance(baseline.get("files"), list) or not baseline["files"]:
        raise SecurityError("target.baseline.files is empty")
    for row in baseline["files"]:
        if not isinstance(row, dict) or not isinstance(row.get("sha256"), str):
            raise SecurityError("invalid baseline.files entry")
        path = _inside(task_root, row.get("path"))
        actual = _sha256(path)
        if actual != row["sha256"]:
            raise SecurityError(f"baseline hash differs from the specification: {row.get('path')}")
        baseline_hashes[row["path"]] = actual
        baseline_paths.append(path)
    threat = spec.get("threatModel")
    if not isinstance(threat, dict) or any(not threat.get(k) for k in
                                           ("assets", "entryPoints", "attacker",
                                            "boundaries", "assumptions")):
        raise SecurityError("required threat-model dimension is empty")
    findings_path = _inside(task_root, spec.get("findingsPath"))
    findings = _json(findings_path)
    if findings.get("schemaVersion") != 1 or findings.get("taskId") != spec["taskId"]:
        raise SecurityError("invalid findings schemaVersion/taskId")
    rows = findings.get("findings")
    if not isinstance(rows, list) or not rows:
        raise SecurityError("findings contains zero entries")
    finding_ids, findings_by_id = set(), {}
    linked = set(link["요구ID"])
    for row in rows:
        if not isinstance(row, dict) or not ID_RE.fullmatch(str(row.get("id", ""))):
            raise SecurityError("invalid finding ID")
        if row["id"] in finding_ids:
            raise SecurityError(f"duplicate finding ID: {row['id']}")
        finding_ids.add(row["id"])
        findings_by_id[row["id"]] = row
        if row.get("status") not in FINDING_STATES or row.get("evidenceLevel") not in EVIDENCE_LEVELS:
            raise SecurityError(f"invalid finding status/evidence level: {row['id']}")
        if row.get("status") != "candidate" or row.get("evidenceLevel") != "static":
            raise SecurityError(
                f"fix workflow input must be candidate/static: {row['id']}")
        if row.get("requirementId") not in linked:
            raise SecurityError(f"finding requirement ID is outside the security link: {row['id']}")
    executions = spec.get("executions")
    if not isinstance(executions, list) or not executions:
        raise SecurityError("security executions contains zero entries")
    seen, prepared, coverage = set(), [], {}
    for item in executions:
        if not isinstance(item, dict) or not ID_RE.fullmatch(str(item.get("id", ""))):
            raise SecurityError("invalid execution ID")
        if item["id"] in seen:
            raise SecurityError(f"duplicate execution ID: {item['id']}")
        seen.add(item["id"])
        if item.get("findingId") not in finding_ids or item.get("requirementId") not in linked:
            raise SecurityError(f"invalid execution linkage: {item['id']}")
        if item.get("requirementId") != findings_by_id[item["findingId"]].get("requirementId"):
            raise SecurityError(f"execution and finding use different requirement IDs: {item['id']}")
        if item.get("stage") not in STAGES:
            raise SecurityError(f"invalid execution stage: {item['id']}")
        target_state = item.get("targetState")
        if target_state not in ("original", "current"):
            raise SecurityError(f"invalid targetState: {item['id']}")
        if ((item["stage"] == "reproduce") != (target_state == "original")
                or (item["stage"] != "reproduce" and target_state != "current")):
            raise SecurityError(f"reproduce must use original; fix verification must use current: {item['id']}")
        coverage.setdefault(item["findingId"], set()).add((item["stage"], target_state))
        if item.get("executionBoundary") not in BOUNDARIES:
            raise SecurityError(f"invalid executionBoundary: {item['id']}")
        if item.get("executionBoundary") == "isolated":
            raise SecurityError(
                f"isolated execution is blocked because this version has no adapter: {item['id']}")
        cwd_base = task_root if target_state == "original" else repo
        cwd = _inside(cwd_base, item.get("cwd"), file=False)
        bound_paths = baseline_paths if target_state == "original" else target_paths
        if not any(path == cwd or cwd in path.parents for path in bound_paths):
            raise SecurityError(
                f"execution cwd does not contain a bound target for this state: {item['id']}")
        timeout = item.get("timeoutSeconds")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0 or timeout > 3600:
            raise SecurityError(f"timeoutSeconds is out of range: {item['id']}")
        for key in ("prerequisites", "environmentRequirements"):
            probes = item.get(key)
            if not isinstance(probes, list) or not probes:
                raise SecurityError(f"{key} is empty: {item['id']}")
            for probe in probes:
                if (not isinstance(probe, dict) or not str(probe.get("name", "")).strip()
                        or not isinstance(probe.get("argv"), list) or not probe["argv"]
                        or not all(isinstance(x, str) and x for x in probe["argv"])
                        or isinstance(probe.get("expectedExit"), bool)
                        or not isinstance(probe.get("expectedExit"), int)):
                    raise SecurityError(f"{key} probe has invalid format: {item['id']}")
        inp = item.get("input")
        if not isinstance(inp, dict) or not isinstance(inp.get("sha256"), str):
            raise SecurityError(f"invalid input format: {item['id']}")
        input_path = _inside(task_root, inp.get("path"))
        if _sha256(input_path) != inp["sha256"]:
            raise SecurityError(f"input hash differs: {item['id']}")
        oracle = item.get("oracle")
        if not isinstance(oracle, dict) or not isinstance(oracle.get("sha256"), str):
            raise SecurityError(f"invalid oracle format: {item['id']}")
        oracle_path = _inside(repo, oracle.get("path"))
        if _sha256(oracle_path) != oracle["sha256"]:
            raise SecurityError(f"oracle hash differs: {item['id']}")
        oracle_argv = oracle.get("argv")
        if not isinstance(oracle_argv, list) or not all(isinstance(x, str) for x in oracle_argv):
            raise SecurityError(f"oracle.argv is not an array of strings: {item['id']}")
        runtime_argv = oracle.get("runtimeArgv")
        if (not isinstance(runtime_argv, list) or len(runtime_argv) != 1
                or not isinstance(runtime_argv[0], str) or not runtime_argv[0]):
            raise SecurityError(f"oracle.runtimeArgv must contain exactly one executable: {item['id']}")
        runtime_path = shutil.which(runtime_argv[0])
        if runtime_path is None:
            raise SecurityError(f"oracle executable does not exist: {item['id']}")
        expected = oracle.get("expected")
        if not isinstance(expected, list) or not expected or not all(
                isinstance(x, dict) and isinstance(x.get("name"), str)
                and "value" in x for x in expected):
            raise SecurityError(f"oracle.expected is empty or invalid: {item['id']}")
        review = oracle.get("review")
        review_path = _inside(task_root, review)
        review_data = _json(review_path)
        if (review_data.get("oraclePath") != oracle["path"]
                or review_data.get("oracleSha256") != oracle["sha256"]
                or review_data.get("expected") != expected
                or review_data.get("verdict") != "pass"
                or not str(review_data.get("reviewedBy", "")).strip()):
            raise SecurityError(f"oracle independent-review receipt is invalid: {item['id']}")
        prepared.append({"spec": item, "cwd": cwd,
                         "command": shlex.join([runtime_path, str(oracle_path)]
                             + oracle_argv + ["--input", str(input_path),
                                              "--target-root", str(cwd)])})
    for finding_id in finding_ids:
        got = coverage.get(finding_id, set())
        if not {("reproduce", "original"), ("fix-reproduce", "current"),
                ("regression", "current"),
                ("variant", "current")} <= got:
            raise SecurityError(f"original reproduction, fix reproduction, regression, and variant are all required: {finding_id}")
    return {"spec": spec, "findings": rows, "prepared": prepared,
            "fingerprints": {"specSha256": _sha256(spec_path),
                             "findingsSha256": _sha256(findings_path),
                             "targets": target_hashes, "baseline": baseline_hashes,
                             "inputs": {x["spec"]["input"]["path"]:
                                        x["spec"]["input"]["sha256"] for x in prepared},
                             "oracles": {x["spec"]["oracle"]["path"]:
                                         x["spec"]["oracle"]["sha256"] for x in prepared},
                             "oracleReviews": {x["spec"]["oracle"]["review"]:
                                 _sha256(_inside(task_root, x["spec"]["oracle"]["review"]))
                                 for x in prepared},
                             "oracleRuntimes": {x["spec"]["id"]:
                                 _sha256(Path(shutil.which(
                                     x["spec"]["oracle"]["runtimeArgv"][0])))
                                 for x in prepared}}}


def execute(loaded, run_command):
    """Run prepared commands through the coordinator and assess JSON oracles."""
    results, passed = [], True
    for row in loaded["prepared"]:
        item = row["spec"]
        run = run_command(row["command"], row["cwd"],
                          timeout_seconds=float(item["timeoutSeconds"]))
        oracle, reason = None, None
        try:
            oracle = json.loads(run["stdout"])
        except (json.JSONDecodeError, TypeError):
            reason = "oracle-json"
        observations = oracle.get("observations") if isinstance(oracle, dict) else None
        expected = item["oracle"]["expected"]
        measured = ([{"name": x.get("name"), "value": x.get("value")}
                     for x in observations] if isinstance(observations, list)
                    and all(isinstance(x, dict) for x in observations) else None)
        ok = bool(isinstance(oracle, dict)
                  and run["exitCode"] == 0 and not run.get("timedOut")
                  and oracle.get("executionId") == item["id"]
                  and oracle.get("status") == "passed"
                  and oracle.get("inputProcessed") is True
                  and isinstance(oracle.get("checksRun"), int)
                  and not isinstance(oracle.get("checksRun"), bool)
                  and oracle["checksRun"] > 0
                  and isinstance(observations, list) and observations
                  and all(isinstance(x, dict) and x.get("passed") is True
                          for x in observations)
                  and measured == expected)
        if not ok and reason is None:
            reason = "oracle-contract"
        results.append({"executionId": item["id"], "findingId": item["findingId"],
                        "requirementId": item["requirementId"], "stage": item["stage"],
                        "run": run, "oracle": oracle, "passed": ok,
                        "reason": reason})
        passed = passed and ok
    finding_results = []
    for finding in loaded["findings"]:
        own = [x for x in results if x["findingId"] == finding["id"]]
        reproduced = next((x for x in own if x["stage"] == "reproduce"), None)
        confirmed = bool(reproduced and reproduced["passed"])
        # load() already enforces the four distinct stages.  Keeping the result
        # reducer independent of a magic count also makes each oracle axis
        # testable in isolation.
        fixed = confirmed and bool(own) and all(x["passed"] for x in own)
        finding_results.append({
            "findingId": finding["id"], "inputStatus": finding["status"],
            "inputEvidenceLevel": finding["evidenceLevel"],
            "observedStatus": "confirmed" if confirmed else "inconclusive",
            "evidenceLevel": "execution",
            "evidenceExecutionId": reproduced["executionId"] if reproduced else None,
            "fixed": fixed,
        })
    passed = passed and bool(finding_results) and all(x["fixed"] for x in finding_results)
    return {"executions": results, "executionCount": len(results),
            "findingResults": finding_results, "passed": passed}


def preflight(loaded, run_command):
    """Execute declared environment probes before any target command."""
    rows, passed = [], True
    for prepared in loaded["prepared"]:
        item = prepared["spec"]
        for group in ("prerequisites", "environmentRequirements"):
            for probe in item[group]:
                run = run_command(shlex.join(probe["argv"]), prepared["cwd"],
                                  timeout_seconds=min(float(item["timeoutSeconds"]), 30.0))
                ok = (run["exitCode"] == probe["expectedExit"]
                      and not run.get("timedOut"))
                rows.append({"executionId": item["id"], "group": group,
                             "name": probe["name"], "run": run, "passed": ok})
                passed = passed and ok
    return {"probes": rows, "probeCount": len(rows), "passed": passed and bool(rows)}
