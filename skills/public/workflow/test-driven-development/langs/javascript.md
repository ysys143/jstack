# TDD Guide: JavaScript

## Framework Selection

| Situation | Recommendation | Reason |
|------|------|------|
| Vite-based project | **Vitest** | Same setup pipeline, native ESM/TS |
| New project (Vite irrelevant) | **Vitest** | Faster, less configuration |
| React Native | **Jest** (Required) | No alternative |
| Legacy codebase | Keep **Jest** | Migration risk > benefit |

State of JS 2025: Vitest surpasses Jest in developer satisfaction for the first time.
Performance: Vitest is faster than 30~70% in the same test suite, and reduces memory by about 35%.
API: Vitest is compatible with the Jest API 95% — most can be drop-in replacements.

## File Structure

**Co-location Preference** (Unit/Component Testing):
```
src/
    services/
        checkoutService.js
        checkoutService.test.js    # colocated with source
    components/
        Button.jsx
        Button.test.jsx
tests/
    integration/
        checkout.test.js           # module-boundary integration test
    e2e/
        checkout.e2e.test.js       # E2E
```

Co-location Reason:
- Orphan testing is immediately visible when source is deleted
- Reduced file navigation friction
- React official documentation is also recommended

Filename: `*.test.js` or `*.spec.js` (Team Convention Unification)

## AAA Pattern

```javascript
describe('CheckoutService', () => {
  let service
  let mockPg

  beforeEach(() => {
    mockPg = { charge: vi.fn().mockResolvedValue({ status: 'ok' }) }
    service = new CheckoutService(mockPg)
    vi.clearAllMocks()
  })

  it('should return discounted price when valid coupon applied', async () => {
    // Arrange
    const order = { amount: 10000 }
    const coupon = 'SALE10'

    // Act
    const result = await service.checkout(order, coupon)

    // Assert
    expect(result.finalAmount).toBe(9000)
    expect(mockPg.charge).toHaveBeenCalledWith(9000)
  })
})
```

## Mock Strategy

3Clear distinction of the purpose of each mock tool:

| Tool | Purpose | Automatic Recovery | Timing |
|------|------|-----------|-----------|
| `vi.fn()` / `jest.fn()` | Independent mock functions | Manual | Callbacks, injected dependencies |
| `vi.mock()` / `jest.mock()` | Entire module replacement | Automatic (file unit) | External dependencies (API, DB, fs) |
| `vi.spyOn()` / `jest.spyOn()` | Existing method wrapping | `mockRestore()` | Maintain actual behavior while monitoring/overriding |

**What not to mock (Testing Library philosophy):**
- Component internal state
- private/internal methods
- Implementation details

Kent C. Dodds' Failure Modes 2:
1. Test breakage in safe refactoring (false failure)
2. Actual behavior broken but test passes (false pass)

```javascript
// vi.spyOn (restorable and narrow; recommended)
vi.spyOn(userRepo, 'findById').mockResolvedValue({ id: 1, name: 'Alice' })

// vi.mock (entire module; for external modules)
vi.mock('../utils/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(true)
}))

// Simulate an exception
mockPg.charge.mockRejectedValue(new Error('timeout'))
```

**`vi.mock` hoisting warning:**
the factory function is hoisted to the top of the file — outside variables cannot be referenced.
`mock` variable names starting with this are exceptions:
```javascript
const mockUser = { id: 1 }  // 'mock' prefix: hoisting allowlist
vi.mock('./api', () => ({ getUser: vi.fn().mockReturnValue(mockUser) }))
```

## Data-Driven Testing

```javascript
// it.each — one test with several inputs (default pattern)
it.each([
  [10000, 'SALE10', 9000],
  [10000, 'EXPIRED', null],
  [4900,  'MIN5000', null],
])('checkout(%i, %s) -> %s', async (amount, coupon, expected) => {
  if (expected === null) {
    await expect(service.checkout({ amount }, coupon)).rejects.toThrow()
  } else {
    const result = await service.checkout({ amount }, coupon)
    expect(result.finalAmount).toBe(expected)
  }
})

// describe.each — run the entire suite under several configurations
describe.each([
  { locale: 'ko', currency: '₩' },
  { locale: 'en', currency: '$' },
])('formatter [$locale]', ({ locale, currency }) => {
  it('formats price correctly', () => { ... })
  it('formats date correctly', () => { ... })
})
```

`it.each`: When only the input data is different.
`describe.each`: When running the same test suite in multiple settings/implementations.
`%s`/`%i`/`$var` tokens are required in the title — otherwise, only `[1]` and `[2]` are shown in the CI failure log.

## Asynchronous Testing

```javascript
// WRONG: the assertion never runs, so the test always passes
test('fetches data', () => {
  fetchData().then(data => expect(data).toBe('foo'))
})

// CORRECT: always return or await
test('fetches data', async () => {
  const data = await fetchData()
  expect(data).toBe('foo')
})

// Guard: ensure that an assertion actually ran
test('async error handling', async () => {
  expect.hasAssertions()  // fail when zero assertions run
  await expect(failingOperation()).rejects.toThrow('expected error')
})

// Do not mix a done callback with return or await
```

## __mocks__ directory

```
src/
    __mocks__/
        axios.js              # node_modules mock (jest.mock('axios') still required)
    utils/
        __mocks__/
            email.js          # local-module mock (no jest.mock('./utils/email') call needed)
```

When to use `__mocks__`:
- Reuse the same mock in multiple test files
- Stable external module interface

When to use inline factory:
- Different actions for each test
- One-time override

`__mocks__` The directory name is case-sensitive (quietly fail in Linux `__MOCKS__`).

## Execution Command

```bash
# Vitest
npx vitest              # watch mode
npx vitest run          # one-shot CI run
npx vitest run -t "checkout"

# Jest
npx jest --watch
npx jest --bail         # stop at the first failure
npx jest --coverage
```

## Coverage

```javascript
// vitest.config.js
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',        // faster than Istanbul; same precision in Vitest 3.2+
      include: ['src/**/*.js'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: -10      // negative value = maximum allowed uncovered statements
      }
    }
  }
})
```

**V8 vs Istanbul Warning:** V8 only aggregates explicit else $\rightarrow$ reports higher than Istanbul in the same code.
There is no meaning in comparing the threshold between the two providers.

## diff coverage — gate only for new code

`thresholds` is the **floor of the entire repository**. The floor holds legacy hostage —
Since a PR in the repository currently 42% cannot create 80%, the team escapes by lowering numbers or allowing negative values like `statements: -10`. The place that requires a gate is not the repository but **the line this change added**. Since tests that have already seen red must already cover those lines, 90% is not a harsh figure.

We measure it with diff coverage from the lcov report.

Requires Node.js 20+.

```bash
git fetch origin main

npx vitest run --coverage --coverage.reporter=lcov   # coverage/lcov.info
# With Jest: npx jest --coverage --coverageReporters=lcov

uvx diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=90   # diff-cover 9+ reads LCOV

node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/test_gates.js diff-coverage \
    --diff <(git diff -U0 "$(git merge-base origin/main HEAD)"...HEAD) \
    --coverage coverage/lcov.info --fail-under 90
```

**In fast loops, `--changedSince` is used.** `npx jest --changedSince=origin/main`
`npx vitest related` only runs tests on the changed files to shorten the red-green rotation.
However, this is **not a gate** — it only reduces the execution target and does not re-measure coverage.

**Caution when applying diff gates with V8 provider:** V8 only aggregates explicit `else`, so it appears higher than Istanbul on the same line. After setting the gate value and changing the provider, the threshold quietly loosens or tightens — changing the provider redefines the threshold.

**If there are no executable new lines, it passes.** If a PR with only type declaration, comments, and `package.json` changed is dropped to 0%, the gate is ignored in one week.

## Anti-pattern

```javascript
// [X] overuse snapshots
// Large snapshots invite delete-and-rerecord cycles after failures; that is not testing.
// Use snapshots only for small, stable structures.

// [X] test implementation details
expect(component.state.isLoading).toBe(false)  // internal state
expect(service._calculateDiscount).toHaveBeenCalled()  // private method

// [X] excessive mocking
// Mocking five of six dependencies tests only the mock wiring.

// [X] asynchronous test without an assertion
test('runs', () => { asyncFn() })  // always passes

// [X] mix done and return
test('async', (done) => {
  return asyncFn().then(() => done())  // Jest reports an error
})
```
