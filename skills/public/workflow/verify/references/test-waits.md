# Test waits

A test unit is **waiting** when its wall time is much larger than its CPU time.
`scripts/test_profile.js` reports such units as WAITING. Asynchronous waits are
the most common root cause of flaky tests, so removing them makes a suite faster
and more reliable at once. Numbers and sources: [test evidence](test-evidence.md).

## Diagnose which kind of wait

1. Get per-test durations from the runner and compare their sum with the unit's
   wall time.
   - Node: `node --test --test-reporter=tap FILE` (each test prints `duration_ms`)
   - Jest: `npx jest FILE --verbose`; Vitest: `npx vitest run FILE --reporter=verbose`
   - pytest: `pytest FILE --durations=0 --durations-min=0.1`
   - Go: `go test -json ./pkg` (per-test `Elapsed` on `"Action":"pass"` lines)
   - RSpec: `rspec FILE --profile 20`; Gradle and JUnit: the per-method test report
2. **Sum of tests much smaller than the unit's wall time**: something outlives the
   tests (pattern D), or the process pays startup before the first test (pattern F).
3. **One test close to the unit's wall time**: that test sleeps, backs off, or
   times out (patterns A, A2, B, C, E).

For Go, compare each package's elapsed time with the sum of its tests from
`go test -json`. A package with almost no test time and seconds of elapsed time
is paying startup, not running tests.

## Pattern A: fixed sleep to wait for something

    await new Promise((r) => setTimeout(r, 2100)); // waits the full time and is flaky under load

Wait for the **condition** with a generous deadline. The deadline is an upper
bound, not the expected time.

    async function waitFor(check, { timeout = 5000, interval = 10 } = {}) {
      const end = Date.now() + timeout;
      for (;;) {
        try { return await check(); } catch (e) { if (Date.now() > end) throw e; }
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    await waitFor(() => assert.equal(cache.flushed, 1));

- JavaScript libraries: testing-library `waitFor`, `vi.waitFor`.
- Python: poll against a `time.monotonic()` deadline; with asyncio,
  `await asyncio.wait_for(event.wait(), 5)`.
- JVM: Awaitility `await().atMost(Duration.ofSeconds(5)).until(() -> cache.flushed() == 1);`
- Go: testify `require.Eventually(t, func() bool { return c.Flushed() == 1 }, 5*time.Second, 10*time.Millisecond)`,
  or a channel that the code signals.
- Browser end-to-end: Playwright web-first assertions wait automatically
  (`await expect(locator).toBeVisible()`); never `page.waitForTimeout(ms)`.
  Capybara `expect(page).to have_content(...)` waits; Cypress `cy.get(...).should(...)`
  retries; never `cy.wait(2000)`.
- A process that must be gone: record its pid and wait until it no longer exists,
  with a deadline shorter than the event the test rules out.

## Pattern A2: doing N slow things to test a limit

To check "the list keeps at most N" or "the 1000th call is rejected", tests often
repeat the slow operation N times. Start at the limit instead: fill the state
directly to N, perform the operation once, and assert what one more does (the
oldest entry dropped, the call rejected). The test is faster and states the limit
more sharply. Doing N expensive operations tests the loop, not the limit.

## Pattern B: waiting out a real interval or timeout

The code flushes every 20 s, debounces for 5 s, or expires after 30 s, and the
test waits that long.

Fix 1: **control the clock**, which is fast and deterministic.

| Runner | Fake timers |
|---|---|
| Node `node:test` | `t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }); t.mock.timers.tick(20_000);` |
| Jest | `jest.useFakeTimers(); jest.advanceTimersByTime(20_000);` (`await jest.advanceTimersByTimeAsync(ms)` when promises are involved) |
| Vitest | `vi.useFakeTimers(); vi.advanceTimersByTime(20_000);`, `await vi.advanceTimersByTimeAsync(ms)`, `vi.setSystemTime(date)` |
| sinon | `const clock = sinon.useFakeTimers(); clock.tick(20_000);` |
| Playwright | `await page.clock.install(); await page.clock.fastForward("00:20");` |
| Python | `time-machine` (`time_machine.travel(dt, tick=False)`) or `freezegun` (`@freeze_time(...)`) for wall-clock time; inject a clock or scheduler for timers |
| Go | inject a clock interface; Go 1.25 and later: `synctest.Test(t, func(t *testing.T) { ... })` runs code with a fake clock in a bubble |
| JVM | inject `java.time.Clock` (`Clock.fixed(...)` or a mutable test clock); schedulers take the clock |
| Rust (tokio) | `#[tokio::test(start_paused = true)]`, then `tokio::time::advance(Duration::from_secs(20)).await` |
| Rails | `travel_to(time) { ... }` (ActiveSupport TimeHelpers); `travel 20.seconds` |

Fix 2: **make the interval a parameter** and shorten it in tests (an environment
variable such as `FLUSH_MS=500`, or a constructor option). Use this when the code
runs in a child process that fake timers cannot reach. A test of a timeout keeps
the behavior it verifies and shortens only the configured duration.

## Pattern C: retry with backoff triggered by the test

A mock that throws a network error or returns a retryable status (502, 503, 504,
or 429) makes the client wait through its backoff (for example 0.5, 1, 2, and
more seconds) before giving up.

- Simulate the failure the test means. "The load failed" is usually an HTTP
  error the client does not retry, such as `new Response("{}", { status: 500 })`
  when only 502 to 504 are retried. Throw only to test the retry itself.
- Inject the delays: `getJson(path, { delays: [0, 0, 0] })`, or `retries: 0` in
  the test client (`urllib3.Retry(total=0)`, `axios-retry` with `retries: 0`,
  the OkHttp retry interceptor turned off).
- With fake timers, advance through the backoff.

## Pattern D: a finished test process that does not exit

The tests pass in milliseconds, but the process lives 5 to 30 s longer, or
forever. Something keeps the event loop or interpreter alive: a `setInterval` or
`setTimeout` scheduled by application code (metrics flush, polling, debounce), an
open socket or server, a database pool, a child process, a non-daemon thread, or
a pending promise.

Find it:

- Jest: `npx jest --detectOpenHandles FILE`
- Node: `npx why-is-node-running`, or log `process.getActiveResourcesInfo()` in an `after` hook
- Python: `threading.enumerate()` at session end; `faulthandler.dump_traceback_later(10)` shows where it hangs
- Go: `go.uber.org/goleak` (`defer goleak.VerifyNone(t)`)
- JVM: a thread dump (`jstack PID`) of the hanging fork

Fix, in order of preference:

1. **Stop it in teardown**: close the server, pool, or socket; cancel the timer.
2. **Do not let background timers hold a process** in application code:
   `setTimeout(...).unref?.()` (a no-op in browsers), `threading.Thread(daemon=True)`,
   a daemon `Timer`. A background flush or poll is never a reason for a process to
   stay alive.
3. **In test setup, for code that cannot change** (for example a browser
   application under a Node test runner): wrap `setTimeout` and `setInterval` so
   timers of one second or longer are unref'd, and keep one ref'd handle until the
   file's tests finish (`after(() => clearInterval(keepAlive))`), so tests that
   await a long timer still work. Guard the fix with a regression test: a fixture
   that leaves 30 s timers behind must exit within a few seconds.

Never force an exit (`--forceExit` in Jest, `--exit` in Mocha,
`--test-force-exit` in Node, `os._exit` in conftest). It hides leaks that can also
leak state between tests.

## Pattern E: real network, DNS, or service startup

- Calls to real hosts are slow, flaky, and not isolated. Replace them with a local
  fake server on port 0 (`http.createServer().listen(0)`, `httptest.NewServer`,
  `pytest-httpserver`, WireMock on a dynamic port) or a stub.
- DNS lookups for unresolvable hosts can take seconds. Use `127.0.0.1` or names
  under `.invalid` or `.test`.
- Go: `httptest.Server.CloseClientConnections()` does not close hijacked
  connections (WebSocket, `Hijacker`). A test that drops the connection this way
  waits for the client's timeout instead and may pass on the wrong error. Make the
  fake handler return or close the connection itself.
- Starting a database, browser, or container for every test: start it **once per
  worker** and isolate by schema, transaction rollback, or temp dir.
  Testcontainers: one container per JVM or worker; Playwright: one browser per
  worker and one context per test.

## Pattern F: slow imports and startup

Each test process pays interpreter start, transpilation, and imports.

- Go: on macOS, the first launch of every freshly linked test binary is scanned
  by the operating system (about 0.4 s, far more when many queue at once). Do not
  defeat Go's test cache with `-count=1` on hermetic tests; unchanged packages then
  cost nothing. Keep `-count=1` for flake hunting and tests that touch the outside
  world.
- Node and TypeScript: use a fast transpiler (tsx, esbuild, swc); Vitest can use
  `NODE_COMPILE_CACHE`; avoid jsdom where the node environment suffices.
- Python: `python -X importtime -c "import yourpkg" 2> import.log` finds heavy
  imports; import lazily on hot paths.
- JVM: reuse forks (Surefire `reuseForks=true`); use the Gradle daemon and
  configuration cache.
- Rails: Spring or bootsnap.
- A computation that every test repeats, such as a source scan run by each test
  in a group, belongs in a shared fixture computed once per process.

## Lint against regressions

Run `node scripts/test_smells.js PATHS` in CI or a pre-commit hook and fail on
new `sleep` hits in unit-test directories. Allow an exception only with an inline
justification next to the line.
