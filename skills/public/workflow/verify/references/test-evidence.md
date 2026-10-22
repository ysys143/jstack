# Test evidence

These figures are **cited from the sources listed below; jstack has not reproduced
them**. Use them to explain why a rule exists. They are not targets, and they are
not evidence about another project; measure the project in front of you.

## Why speed matters

- Builds a few seconds faster gave 11% faster active time and 14% faster wall
  time on small and medium changes, with no threshold below which speed stopped
  mattering; predictability mattered too [Jaspan & Green 2023].
- About 1 s keeps flow and about 10 s is the limit of focused attention
  [Nielsen]. The median IDE test run takes about 0.5 s and more than 75% finish
  within 5 s [Beller 2019]. Only 10% of interrupted programming sessions resume
  within a minute [Parnin & Rugaber 2011].
- Ten minutes is the most common "maximum acceptable" CI time [Hilton 2017];
  Shopify targets a p95 under 10 minutes [Shopify].
- With AI adoption, merged pull requests rose 98% and review time 91%, with no
  company-level gain [Faros 2025]. Google throttled model-generated migration
  changes to reviewer capacity [Google 2025]. Experienced maintainers were 19%
  slower with AI assistance in their own mature repositories [METR 2025].
- Latency bands: under a second tests feel part of editing; up to about 10 s
  people still wait on purpose; from about a minute to 10 minutes a context switch
  is likely and resuming is costly, with extra stress [Mark 2008]; past 10 minutes
  practitioners call CI too slow, changes get batched, and bisecting gets harder.
  Google's presubmit averaged about 11 minutes, and moving a nightly end-to-end
  run to every two hours cut the set of suspect changes twelvefold [SWE@Google].
- Waiting costs people and money: developers estimated a 31.6% efficiency loss
  [Stripe 2018]; an average paid GitHub Actions repository spent about $504 a
  year, 91% of it on build and test [Bouzenia & Pradel 2024]; CI energy was about
  22 kWh per Java project [Perez 2024] and about 457 tCO2e a year for GitHub
  Actions open-source usage [Saavedra 2025].
- AI adoption correlated with 7.2% lower delivery stability [DORA 2024]. Speed-up
  is bounded by 1/H, where H is the share of work that needs human judgment
  [Mathews 2026].

## Where the time goes

- Four numbers explain most suites: wall time against summed unit time, the long
  pole, the serial setup fraction, and idle waiting.
- Parallel efficiency is the summed unit time divided by wall time times workers.
- Wall time is at least max(longest unit, total / workers), and a
  longest-first schedule is within 4/3 of optimal [Graham 1969]. Speed-up is
  bounded by the serial fraction [Amdahl 1967].
- Parallel efficiency well below one means time goes to idle workers or serial
  overhead, not to test bodies. cargo-nextest gained 1.4 to 3.4 times, limited by
  long poles [nextest].
- At Shopify, 68% of CI time was setup before any test ran; fixing it moved the
  p95 from 45 to 18 minutes [Shopify].
- Asynchronous waits were the root cause in 45% of flaky-test fixes, and about a
  third of those used fixed delays [Luo 2014].
- Replacing fixed sleeps with condition waits was the fix in 54% of asynchronous
  cases in one study [Luo 2014] and 86% at Mozilla [Eck 2019]. Google forbids sleeps
  in small tests and caps test size by construction [SWE@Google].
- Caching the build environment made 74% of accelerated builds at least twice as
  fast [Gallaba 2022]. Re-running failed commands was the factor most associated
  with long CI builds [Ghaleb 2019].

## Caching

- A hermetic test's result is a pure function of its inputs' hashes
  [Mokhov 2018]; Bazel, Go, Nx, and Turborepo reuse results this way.
- CI caching was adopted by about 30% of projects, and 27% of caches went stale
  [Ghaleb 2026].

## Parallelism and isolation

- Parallelizing Java open-source suites gave an average 3.53x speed-up, yet only
  19.1% of projects with long suites parallelized at all [Candido 2017].
- Isolating every test in its own process cost 618% overhead on average
  [Bell & Kaiser 2014].
- Order dependence caused 50.5% of flaky tests in a Java study [Lam 2019] and 59%
  in Python suites [Gruber 2021]; 61% of order-dependent tests traced to static
  state [Zhang 2014]. Selection, prioritization, and parallelization broke 82% of
  suites that contain order-dependent tests [Lam 2020c].
- 46.5% of flaky tests were affected by available resources [Silva 2023].
- Bazel reached a 12.8x median speed-up at 16-way parallelism on long builds;
  incremental builds with a CI cache gave a median 4.22x (4.71x with Bazel's own
  cache) [Zheng 2024].

## Selection and ordering

- Ekstazi cut end-to-end time by 32% on average and 54% on long suites
  [Gligoric 2015]. In CI it selected 30.6% of tests while builds still took 76%
  of the time, and module-level selection picked every module in 65% of commits
  [Shi 2019].
- At Google, 1.23% of affected test executions found a breakage [Memon 2017]. At
  Meta, predictive selection ran three times fewer tests and caught more than
  99.9% of faulty changes [Machalica 2019].
- Developers' manual selections differed from tools in 100% of sessions and were
  too narrow 27% of the time [Gligoric 2014].
- "Recently failed, then fastest first" beat 59 prioritization techniques,
  including learned ones [Cheng 2024].
- In industry, learned selection saved 15% to 30% of compute at about 99% recall
  of faulty pull requests [Mehta 2021]; Mozilla ran 70% fewer tasks than its
  previous heuristics [Mozilla 2020]; unsafe selection from metadata alone saved
  84% of time at 90% failure recall [Elsner 2021]. Shopify required 99.94% recall
  and kept a complete run on main [Shopify].
- Coverage-based suite reduction shrank suites by 62.9% but lost up to 20.5% of
  killed mutants; reduction by killed mutants lost none at a larger size
  [Shi 2014].
- Most runs pass (98% of pre-submit runs at BMW [Schwendner 2025]), so optimize
  the time to the first failure, a measure that includes test cost. Quickest first
  is a strong baseline on real failures [Peng 2020]; failure history is the most
  valuable signal [Yaraghi 2022]. Cheap history windows (failed recently, not run
  lately, new) caught 70% to 80% of failing suites at three times the efficiency of
  random order [Elbaum 2014].
- Longest first packs workers, while fastest first surfaces failures sooner on
  one worker. With many workers, pack longest first and put recently failed tests
  at the front.
- Selection missed up to 55% of failures, while batching missed none
  [Fallahzadeh 2024].
- Batching commits with automatic bisection kept feedback time with 72% to 91%
  fewer machines [Fallahzadeh 2023].
- Every serious deployment keeps a complete run: periodic complete runs in Azure
  Test Impact Analysis, OpenClover's `fullRunEvery`, Develocity's post-merge
  remaining tests, and the complete suite on the main branch at Shopify. Checking
  three selection tools found 27 bugs in them [Zhu 2019].

## Flakiness

- About 16% of Google's tests showed some flakiness and 2% to 16% of compute went
  to reruns [Micco 2017]; 84% of pass-to-fail transitions involved a flaky test
  [Memon 2017].
- 75% to 78% of flaky tests were flaky when written [Luo 2014; Lam 2020];
  checks on new and modified tests caught 85% [Lam 2020b].
- About 170 reruns are needed for 95% confidence that a test is not flaky
  [Gruber 2021].
- 86% of Microsoft's flaky tests were flaky only in CI [Lam 2019b].
- Automatic detection and suppression took Slack's failing test jobs from 57% to
  3.85% [Slack 2022]; GitHub cut flaky builds from 9% to under 0.5% of commits
  [GitHub 2020].
- Prevalence: at Google 1.5% of executions were flaky [Micco 2017]; at Microsoft
  4.6% of tests were flaky and 14% to 52% of builds per project were affected
  [Lam 2020]; about 0.5% to 1% of open-source tests are flaky [Parry 2021].
  Microsoft's build system found no order-dependent flakes only because it always
  ran tests in the same order [Lam 2019b].
- About a third of asynchronous-wait flakes enforced ordering with a time delay,
  concurrency flakes almost always involved two threads, 47% of order-dependent
  flakes involved an external resource, and most order-dependent failures
  involved one other test [Luo 2014].
- Making flake rates visible per test lowered Spotify's flaky rate from 6% to 4%
  [Spotify 2019]. Keeping the main branch green at scale needs a queue with
  speculative builds [Ananthanarayanan 2019].
- Models repaired known-cause flakiness moderately well: 57% to 59% of cases
  [Chen 2024], 47.6% with 51.8% of fixes accepted [Li 2025], and 51% to 83% of
  repairs expected to pass [Fatima 2024].
- 24% of flaky-test fixes touched the code under test and 94% of those fixed a
  real bug [Luo 2014]; about one in six newly flaky Google tests exposed a real bug
  [Micco 2017].
- Models classified flakiness from test code alone at near-random accuracy
  [Berndt 2025].

## Agents

- Agents re-executed tests in 49.7% to 83.0% of tasks, driven by unknown runners
  and truncated or ambiguous output; written skills cut agent cost by 7.9% to
  41.7% [Hu 2026].
- Frontier models cheated on about half of tasks whose tests contradicted the
  specification; an explicit "the tests are wrong" option cut one model's rate
  from 54% to 9% [ImpossibleBench 2025].
- 80.2% of test changes in agent pull requests had weak or no assertions
  [Banik 2026]. Tests written by agents mid-task did not raise resolution rates
  and cost 9% to 20% more tokens [Chen 2026].
- 7.8% of SWE-bench patches that passed the modified test files failed the
  complete suite [Wang 2026b].
- Trimming logs to the relevant lines kept diagnosis accuracy with 4.5 times
  fewer tokens [LogSage 2025].
- Short, command-first context files helped; long ones added cost without
  improving success [Gloaguen 2026; Lulla 2026].
- Controlled trials showed 21% to 56% speed-ups on well-specified tasks
  [Peng 2023; Paradis 2024]. Other data disagree: faster reviews as AI use rose
  [Jellyfish 2025], a later estimate of about 18% speed-up with a wide interval
  [METR 2026], and AI review that cut cycle time 30.8% in one company
  [Atlassian 2026] but added 42% closure time in another [Cihan 2025]. Where
  verification is fast and automated, AI speeds delivery up; where it is slow or
  manual, the cost moves to reviewers.
- Verification selects among cheap generations: tests discarded about 99% of
  AlphaCode's samples [Li 2022].
- Weak tests inflate results: removing weak-test and leaked-solution tasks cut one
  agent's SWE-bench score from 12.47% to 3.97% [SWE-Bench+ 2024], running only the
  modified test files inflated success by 6.2 points [Wang 2026b], and hardening
  tests changed leaderboard rankings [UTBoost 2025].
- OpenAI stopped reporting SWE-bench Verified after finding flawed tests in
  59.4% of audited tasks [OpenAI 2026].
- 8.2% of commits in projects with snapshot tests had to update snapshots
  [Fujita 2023].
- Reward hacking on tests is documented: special-casing, editing tests,
  `sys.exit(0)`, and patching `conftest.py` [METR 2025b; Baker 2025]; learned
  hacks generalized to broader misbehavior [MacDiarmid 2025].
- Agent-written tests left error paths untested 67% to 86% of the time
  [Dipongkor 2026], and model-written oracles tended to encode the current rather
  than the expected behavior [Konstantinou 2024]. Meta landed generated tests only
  after filtering for builds, reliable passes, and added coverage [Alshahwan 2024],
  and targeted specific faults with mutation-guided generation [Meta 2025].
  Filtering low-value mutants raised the usefulness of diff-based mutation testing
  from 20% to 80% at Google [Petrović 2021].
- Writing tests from the specification before the code improved generated code
  [Mathews & Nagappan 2024]. Throttling changes to review capacity keeps batches
  reviewable [DORA 2025; Google 2025].

## Targets

| Loop | Target | Basis |
|---|---|---|
| Save to affected tests | 1 s typical, 10 s at worst | [Nielsen; Beller 2019] |
| Complete local suite or agent gate | 1 to 2 minutes | Below the task-switch interval of about six minutes [Meyer 2014]; an inference |
| Blocking pre-merge CI | p95 10 minutes, median 5 minutes | [Hilton 2017; Shopify] |
| Post-merge broad suites | 1 to 2 hours, bisected automatically | [SWE@Google; Fallahzadeh 2023] |
| Flaky test runs | under 1% (stretch 0.15%) | [SWE@Google] |
| Unit tests with fixed sleeps | none | [Luo 2014; SWE@Google] |

These are starting points, not requirements; a repository sets its own budgets
from its measurements.

## Open problems

- Cheap expected-behavior oracles for agent-written code (specification-derived,
  property-based, differential, mutation-guided); model-written oracles still
  mirror the implementation.
- A standard score for how strongly a change is verified; coverage can be gamed.
- Detecting reward hacking in real repositories beyond "did the diff touch tests".
- Test selection for agent inner loops; predicting test results without execution
  is not yet reliable [Hora 2024].
- Idle waiting as a first-class metric: no study quantifies how much of real
  suites' wall time is idle, although waits are the top root cause of flakiness.
- The cost-optimal mix of inner-loop, pre-merge, and post-merge testing for many
  parallel agents.

## Reported cases

The source listed in this skill's NOTICE reports two cases. They are single
observations, not benchmarks.

- A TypeScript monorepo (about 900 tests) went from about 12 minutes to about
  24 seconds without removing tests. About 85% to 90% of its time was idle: app
  timers held finished test processes open, mocked failures triggered retry
  backoff, and one test slept through a 20 s interval. Parallelism alone gave
  12 to 2 minutes; removing the waits first removed the idle long pole. Its
  existing dependency-based selector chose 56 of 59 and 54 of 61 files for a small
  diff because of hub modules.
- A Go service suite went from about 15 s to about 1 s. After the waits were
  removed, packages spent seconds before their first test on first-launch
  executable scanning; keeping Go's test cache instead of `-count=1` removed it.
  Two of three slow tests had been passing for the wrong reason or with weaker
  assertions than they could have had, and a slow "performance" test exposed a
  real product defect.

## Sources

- [Alshahwan 2024] Automated Unit Test Improvement using Large Language Models at Meta (TestGen-LLM). FSE Industry. https://arxiv.org/abs/2402.09171
- [Amdahl 1967] Amdahl. Validity of the Single Processor Approach to Achieving Large Scale Computing Capabilities. AFIPS. https://dl.acm.org/doi/10.1145/1465482.1465560
- [Ananthanarayanan 2019] Ananthanarayanan et al. Keeping Master Green at Scale. EuroSys. https://www.masoud.io/docs/eurosys19.pdf
- [Atlassian 2026] RovoDev Code Reviewer. ICSE-SEIP. https://arxiv.org/html/2601.01129v2
- [Baker 2025] Monitoring Reasoning Models for Misbehavior. https://arxiv.org/abs/2503.11926
- [Banik 2026] All Smoke, No Alarm: Oracle Signals in Agent-Authored Test Code. https://arxiv.org/pdf/2606.18168
- [Bell & Kaiser 2014] Bell, Kaiser. Unit Test Virtualization with VMVM. ICSE. https://jonbell.net/publications/vmvm
- [Beller 2019] Beller et al. Developer Testing in the IDE. TSE. https://gousios.org/pub/developer-testing-in-IDE.pdf
- [Berndt 2025] Can We Classify Flaky Tests Using Only Test Code? https://arxiv.org/abs/2602.05465
- [Bouzenia & Pradel 2024] Resource Usage and Optimization Opportunities in Workflows of GitHub Actions. ICSE. https://software-lab.org/publications/icse2024_workflows.pdf
- [Candido 2017] Candido, Melo, d'Amorim. Test Suite Parallelization in Open-Source Projects. ASE. https://damorim.github.io/publications/candido-etal-ase17.pdf
- [Chen 2024] Chen, Jabbarvand. Neurosymbolic Repair of Test Flakiness (FlakyDoctor). ISSTA. https://arxiv.org/abs/2404.09398
- [Chen 2026] Rethinking the Value of Agent-Generated Tests. https://arxiv.org/html/2602.07900v2
- [Cheng 2024] Cheng et al. Revisiting Test-Case Prioritization on Long-Running Test Suites. ISSTA. https://mir.cs.illinois.edu/marinov/publications/ChengETAL24LongRTP.pdf
- [Cihan 2025] Automated Code Review in Practice. ICSE-SEIP. https://arxiv.org/abs/2412.18531
- [Dipongkor 2026] Test Coverage Analysis of Agentic Pull Requests. https://arxiv.org/html/2607.18057v1
- [DORA 2024] Accelerate State of DevOps 2024. https://dora.dev/research/2024/dora-report/
- [DORA 2025] State of AI-assisted Software Development. https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report
- [Eck 2019] Eck et al. Understanding Flaky Tests: The Developer's Perspective. ESEC/FSE. https://arxiv.org/pdf/1907.01466
- [Elbaum 2014] Elbaum, Rothermel, Penix. Techniques for Improving Regression Testing in Continuous Integration Development Environments. FSE. https://cs.uwaterloo.ca/~m2nagapp/courses/CS846/1171/papers/elbaum_fse14.pdf
- [Elsner 2021] Elsner et al. Empirically Evaluating Readily Available Information for Regression Test Optimization. ISSTA. https://conf.researchr.org/details/issta-2021/issta-2021-technical-papers/15/Empirically-Evaluating-Readily-Available-Information-for-Regression-Test-Optimization
- [Fallahzadeh 2023] Accelerating Continuous Integration with Parallel Batch Testing. ESEC/FSE. https://arxiv.org/pdf/2308.13129
- [Fallahzadeh 2024] Fallahzadeh, Rigby, Adams. Contrasting Test Selection, Prioritization, and Batch Testing at Scale. EMSE. https://mcislab.github.io/publications/2025/emse_scale.pdf
- [Faros 2025] The AI Productivity Paradox. https://www.faros.ai/blog/ai-software-engineering
- [Fatima 2024] Fatima, Hemmati, Briand. FlakyFix: Using Large Language Models for Predicting Flaky Test Fix Categories and Test Code Repair. TSE. https://arxiv.org/abs/2307.00012
- [Fujita 2023] Fujita, Kashiwa, Lin, Iida. An Empirical Study on the Use of Snapshot Testing. ICSME. https://sdlab.naist.jp/en/post/fujita-icsme2023/
- [Gallaba 2022] Accelerating Continuous Integration by Caching Environments and Inferring Dependencies. TSE. https://rebels.cs.uwaterloo.ca/papers/tse2020_gallaba.pdf
- [Ghaleb 2019] An Empirical Study of the Long Duration of Continuous Integration Builds. EMSE. https://danielcalencar.github.io/journal%20papers/2019/05/01/emse-19-taher.html
- [Ghaleb 2026] The Promise and Reality of CI Caching. https://arxiv.org/abs/2601.19146
- [GitHub 2020] Reducing Flaky Builds by 18x. https://github.blog/engineering/engineering-principles/reducing-flaky-builds-by-18x/
- [Gligoric 2014] Gligoric et al. Manual and Automated Test Selection. ISSTA. https://users.ece.utexas.edu/~gligoric/papers/GligoricETAL14ManualRTS.pdf
- [Gligoric 2015] Gligoric, Eloussi, Marinov. Practical Regression Test Selection with Dynamic File Dependencies. ISSTA. https://users.ece.utexas.edu/~gligoric/papers/GligoricETAL15Ekstazi.pdf
- [Gloaguen 2026] Evaluating AGENTS.md. https://arxiv.org/abs/2602.11988
- [Google 2025] How is Google Using AI for Internal Code Migrations? https://arxiv.org/html/2501.06972v1
- [Graham 1969] Graham. Bounds on Multiprocessing Timing Anomalies. SIAM J. Appl. Math. https://people.irisa.fr/Sophie.Pinchinat/AA/Graham1969SIAM.pdf
- [Gruber 2021] Gruber et al. An Empirical Study of Flaky Tests in Python. ICST. https://arxiv.org/pdf/2101.09077
- [Hilton 2017] Hilton et al. Trade-offs in Continuous Integration. FSE. https://mir.cs.illinois.edu/marinov/publications/HiltonETAL17TradeOffsInCI.pdf
- [Hora 2024] Predicting Test Results without Execution. FSE IVR. https://2024.esec-fse.org/details/fse-2024-ideas--visions-and-reflections/19/Predicting-Test-Results-without-Execution
- [Hu 2026] Analyzing and Mitigating Cost-Inefficient Behaviors in Coding Agents. https://arxiv.org/html/2609.30725
- [ImpossibleBench 2025] Zhong, Raghunathan, Carlini. ImpossibleBench. https://arxiv.org/html/2510.20270v1
- [Jaspan & Green 2023] Jaspan, Green. Developer Productivity for Humans, Part 4: Build Latency, Predictability, and Developer Productivity. IEEE Software. https://research.google/pubs/developer-productivity-for-humans-part-4-build-latency-predictability-and-developer-productivity/
- [Jellyfish 2025] AI impact data. https://jellyfish.co/blog/ai-impact-data-june-2025/
- [Konstantinou 2024] Do LLMs Generate Test Oracles that Capture the Actual or the Expected Program Behaviour? https://arxiv.org/abs/2410.21136
- [Lam 2019] Lam et al. iDFlakies. ICST. https://taoxie.cs.illinois.edu/publications/icst19-idflakies.pdf
- [Lam 2019b] Lam et al. Root Causing Flaky Tests in a Large-Scale Industrial Setting. ISSTA. https://mir.cs.illinois.edu/winglam/publications/2019/LamETAL19RootFinder.pdf
- [Lam 2020] Lam et al. A Study on the Lifecycle of Flaky Tests. ICSE. https://mir.cs.illinois.edu/winglam/publications/2020/LamETAL20FaTB.pdf
- [Lam 2020b] Lam et al. A Large-Scale Longitudinal Study of Flaky Tests. OOPSLA. https://mir.cs.illinois.edu/winglam/publications/2020/LamETAL20OOPSLA.pdf
- [Lam 2020c] Lam et al. Dependent-Test-Aware Regression Testing Techniques. ISSTA. https://taoxie.cs.illinois.edu/publications/issta20-dependtest.pdf
- [Li 2022] Competition-Level Code Generation with AlphaCode. Science. https://arxiv.org/abs/2203.07814
- [Li 2025] Li, Behrang, Shi, Liu. FlakyGuard: Automatically Fixing Flaky Tests at Industry Scale. https://arxiv.org/abs/2511.14002
- [LogSage 2025] LogSage. https://arxiv.org/abs/2506.03691
- [Lulla 2026] On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents. https://arxiv.org/abs/2601.20404
- [Luo 2014] Luo, Hariri, Eloussi, Marinov. An Empirical Analysis of Flaky Tests. FSE. https://mir.cs.illinois.edu/marinov/publications/LuoETAL14FlakyTestsAnalysis.pdf
- [MacDiarmid 2025] Natural Emergent Misalignment from Reward Hacking in Production RL. https://arxiv.org/abs/2511.18397
- [Machalica 2019] Machalica et al. Predictive Test Selection. ICSE-SEIP. https://arxiv.org/abs/1810.05286
- [Mark 2008] Mark, Gudith, Klocke. The Cost of Interrupted Work: More Speed and Stress. CHI. https://ics.uci.edu/~gmark/chi08-mark.pdf
- [Mathews & Nagappan 2024] Test-Driven Development for Code Generation. ASE. https://arxiv.org/abs/2402.13521
- [Mathews 2026] Amdahl's Law for AI Agents. https://electric.ax/blog/2026/02/19/amdahls-law-for-ai-agents
- [Mehta 2021] Mehta et al. Data-Driven Test Selection at Scale. FSE Industry. https://2021.esec-fse.org/details/fse-2021-industry/2/Data-Driven-Test-Selection-at-Scale
- [Memon 2017] Memon et al. Taming Google-Scale Continuous Testing. ICSE-SEIP. https://research.google.com/pubs/archive/45861.pdf
- [Meta 2025] Mutation-Guided LLM-based Test Generation at Meta (ACH). https://arxiv.org/abs/2501.12862
- [METR 2025] Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity. https://arxiv.org/abs/2507.09089
- [METR 2025b] Recent Frontier Models Are Reward Hacking. https://metr.org/blog/2025-06-05-recent-reward-hacking/
- [METR 2026] Uplift update. https://metr.org/blog/2026-02-24-uplift-update/
- [Meyer 2014] Meyer et al. Software Developers' Perceptions of Productivity. FSE. https://thomas-zimmermann.com/publications/files/meyer-fse-2014.pdf
- [Micco 2017] Micco. The State of Continuous Integration Testing at Google. ICST keynote. http://aster.or.jp/conference/icst2017/program/jmicco-keynote.pdf
- [Mokhov 2018] Mokhov, Mitchell, Peyton Jones. Build Systems à la Carte. ICFP. https://www.microsoft.com/en-us/research/wp-content/uploads/2018/03/build-systems.pdf
- [Mozilla 2020] Testing Firefox More Efficiently with Machine Learning. https://hacks.mozilla.org/2020/07/testing-firefox-more-efficiently-with-machine-learning/
- [nextest] cargo-nextest benchmarks. https://nexte.st/docs/benchmarks/
- [Nielsen] Nielsen. Response Times: The 3 Important Limits. https://www.nngroup.com/articles/response-times-3-important-limits/
- [OpenAI 2026] Introducing SWE-bench Verified, and its retirement. https://openai.com/index/introducing-swe-bench-verified/
- [Paradis 2024] How Much Does AI Impact Development Speed? An Enterprise-Based Randomized Controlled Trial. https://arxiv.org/abs/2410.12944
- [Parnin & Rugaber 2011] Parnin, Rugaber. Resumption Strategies for Interrupted Programming Tasks. Software Quality Journal. https://chrisparnin.me/pdf/parnin-sqj11.pdf
- [Parry 2021] Parry, Kapfhammer, Hilton, McMinn. A Survey of Flaky Tests. TOSEM. https://eprints.whiterose.ac.uk/id/eprint/230095/1/parry2021.pdf
- [Peng 2020] Peng, Shi, Zhang. Empirically Revisiting and Enhancing IR-Based Test-Case Prioritization. ISSTA. https://sites.utexas.edu/august/wp-content/uploads/sites/5034/2020/08/ISSTA2020-tcp.pdf
- [Peng 2023] The Impact of AI on Developer Productivity: Evidence from GitHub Copilot. https://arxiv.org/abs/2302.06590
- [Perez 2024] Perez et al. Software Frugality in an Accelerating World: the Case of Continuous Integration. https://arxiv.org/pdf/2410.15816
- [Petrović 2021] Practical Mutation Testing at Scale: A View from Google. TSE. https://arxiv.org/pdf/2102.11378
- [Saavedra 2025] Environmental Impact of CI/CD Pipelines. https://arxiv.org/pdf/2510.26413
- [Schwendner 2025] Practical Pipeline-Aware Regression Test Optimization. https://arxiv.org/pdf/2501.11550
- [Shi 2014] Shi, Gyori, Gligoric, Zaytsev, Marinov. Balancing Trade-Offs in Test-Suite Reduction. FSE. https://mir.cs.illinois.edu/awshi2/publications/FSE2014.pdf
- [Shi 2019] Shi, Zhao, Marinov. Understanding and Improving Regression Test Selection in Continuous Integration. ISSRE. https://mir.cs.illinois.edu/marinov/publications/ShiETAL19RTSinCI.pdf
- [Shopify] Faster Shopify CI. https://shopify.engineering/faster-shopify-ci
- [Silva 2023] Silva et al. The Effects of Computational Resources on Flaky Tests. https://arxiv.org/abs/2310.12132
- [Slack 2022] Handling Flaky Tests at Scale. https://slack.engineering/handling-flaky-tests-at-scale-auto-detection-suppression/
- [Spotify 2019] Palmer. Test Flakiness: Methods for Identifying and Dealing with Flaky Tests. https://engineering.atspotify.com/2019/11/test-flakiness-methods-for-identifying-and-dealing-with-flaky-tests
- [Stripe 2018] The Developer Coefficient. https://stripe.com/files/reports/the-developer-coefficient.pdf
- [SWE-Bench+ 2024] Aleithan et al. SWE-Bench+. https://arxiv.org/abs/2410.06992
- [SWE@Google] Winters, Manshreck, Wright. Software Engineering at Google, chapters 11 to 14 and 23. https://abseil.io/resources/swe-book/html/ch11.html
- [UTBoost 2025] UTBoost. https://arxiv.org/abs/2506.09289
- [Wang 2026b] Are "Solved Issues" in SWE-bench Really Solved Correctly? ICSE. https://arxiv.org/abs/2503.15223
- [Yaraghi 2022] Scalable and Accurate Test Case Prioritization in Continuous Integration Contexts. TSE. https://arxiv.org/abs/2109.13168
- [Zhang 2014] Zhang et al. Empirically Revisiting the Test Independence Assumption. ISSTA. https://dada.cs.washington.edu/research/tr/2014/01/UW-CSE-14-01-01.PDF
- [Zheng 2024] Zheng, Adams, Hassan. Does Using Bazel Help Speed Up Continuous Integration Builds? EMSE. https://arxiv.org/pdf/2405.00796
- [Zhu 2019] Zhu et al. A Framework for Checking Regression Test Selection Tools. ICSE. https://users.ece.utexas.edu/~gligoric/papers/ZhuETAL19RTSCheck.pdf
