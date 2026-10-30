---
name: benchmark-checklist
description: "Vet a performance measurement before you report or act on it. Triggers: 벤치마크, 성능 수치."
---

# Benchmark checklist — explain the number before you ship it

A run can produce a number without measuring the work. This skill is the check
you make before you report or act on a measured speedup, regression, throughput,
latency, or eval score: a PR's before and after, a regression claim, a harness
you will rerun, or a choice between libraries or settings. Answer every question
below with evidence from a run. A guess from reading the code is not evidence.

## Decide before you run

- **Write the claim you expect to make, in the words you would ship**
  ("export is 30% faster at p50 on the 60k-row dataset"). The questions below
  test that sentence, and a number with no sentence behind it cannot fail.
- **Name the result that would change a decision, and the noise floor.** If the
  run-to-run spread is larger than that result, stop and fix the measurement
  before you collect more runs.
- **Read the measuring script.** Note what it times, what it counts, and what it
  ignores.
- **Check the machine.** Read the load average (`uptime`) and the core count
  (`nproc`, or `sysctl -n hw.ncpu` on macOS). If something else is running, find
  out what. If you cannot stop it, interleave the sides so both see the same
  noise, and say so in the report.

## A quick ballpark

When the user asked for a rough figure, one run is enough. Still answer
questions 4 and 7, and say it was one run. Skip the rest unless that run looks
wrong. A choice between options is never a ballpark.

## The seven questions

1. **Why not double?** Name the limiter: a core, a lock, the disk, the network,
   or the load generator. Take it from a profile or system counters recorded in
   a run you do not report, because profilers and tracers slow the work.
   Per-process CPU (`top`, `pidstat`), a runtime profiler (`node --cpu-prof`,
   `py-spy`, `perf`), I/O wait, and syscall counts (`strace -c` on Linux) are the
   usual sources. Map the hot spot to source. If the load generator saturates
   first, you measured the load generator. When a change did not move the
   number, the limiter says why, so find it before you call the change useless.
2. **Was it tuned?** Run every side the way production runs it: release builds,
   production flags and environment, batching and transaction settings,
   connection pools, caches as warm or as cold as production sees them, and the
   same versions and data. A side left on defaults means you compared
   configurations, not implementations. A limiter that is a setting (a commit
   per row, a debug build, a missing index) marks that side as untuned: tune it
   and measure again before you name a winner. If you cannot tune it, name no
   winner from that run. When the user is choosing what to adopt, narrowing the
   claim to "as it ships today" does not repair this, because they adopt the
   option along with its tuning.
3. **Did it break limits?** Do the arithmetic. Compare bytes per second with disk
   and network bandwidth, operations per second times cost per operation with
   your cores, and the time saved with the time the changed piece took. Removing
   a piece that is 10% of the run makes the run at most about 11% faster. A
   result beyond a limit measured something other than the work: a cache, a
   no-op, or a bug.
4. **Did it error?** Count failures and non-success responses, and check that the
   outputs are correct, not only present. Rejections are often fast, while
   timeouts and retries are slow, so errors push the number in either direction.
   If the script does not count errors, add the count.
5. **Does it reproduce?** Run each side at least 5 times, alternating (A, B, A,
   B) so warmup, lazy initialization, caches, and drift favor neither. Report the
   median and the range. A gap smaller than the run-to-run spread is no
   measurable difference. When the call is close, use a rank-sum test or the
   harness's own statistics.
6. **Does it matter?** Next to any micro result, measure the end-to-end path a
   user waits on, with realistic data sizes and concurrency, and give the micro
   result as a share of that whole. A helper that takes 1% of a request makes the
   request at most 1% faster, however fast the helper gets.
7. **Did it even happen?** Confirm the work ran inside the timed region: the
   request reached the server, the rows were written, the bytes were read, and
   the code used the result. Lazy code (generators nobody iterates, promises
   nobody awaits, results a compiler can discard) and timeouts yield numbers for
   work that never happened.

## Eval results

An eval score is a measured number too. Ask the same of the trials: did every
run attempt the task, does the gap hold across trials and across models, and
does the scenario matter to the decision. A score you cannot explain is a
reading, not a finding.

## Report

- Lead with the verdict: faster, slower, no measurable difference, or
  inconclusive.
- Give the number with its unit, the run count, the range, and the limiter. For
  example: "p50 41 ms → 33 ms, median of 7 runs per side, range 32 to 35 ms
  after, bound by JSON parsing on one core."
- Call the verdict **inconclusive** when you claim a difference but cannot name
  the limiter, when a side ran untuned, or when you could not check questions 4
  and 7. Name the gap that stopped you.
- Keep a PR body to one primary number. Put the runs, the range, and the limiter
  evidence in a linked artifact or notes file.

## A harness you will rerun

Before a measuring harness is frozen, vet it with these questions once. Then make
it print its error count and a count of the work it actually did, as the `verify`
skill's validation-cost reference asks. Every later keep-or-revert decision then
checks questions 4 and 7 without extra effort.

## Boundaries

| Task | Owner |
|---|---|
| Rules for faster React and Next.js code | `react` skill |
| Slow validation, CI setup cost, or whether to keep a validation change | `verify` skill |
| Deciding whether finished work is complete | `verify` skill |

When `react-performance` tells you to measure before and after, run this
checklist on that measurement.

## Limits (stated)

- This skill names the gaps in a measurement. It does not make a number true
- It supplies no benchmark harness and installs no profiler. A question that
  cannot be answered here is reported as unanswered, and the verdict is
  inconclusive
