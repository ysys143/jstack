# TDD Guide: Go

## Framework

- **Internal `testing` package** — No separate installation required, idiomatic Go patterns
- **testify** — assert/require/mock (`go get github.com/stretchr/testify`)
- **uber-go/mock** — gomock active fork ([WARN] `golang/mock` is archived in 2023 year 6 month)
- **vektra/mockery** — testify/mock code generator

## stdlib vs testify

| | stdlib `testing` | testify |
|--|-----------------|---------|
| assertion | `if got != want { t.Errorf(...) }` | `assert.Equal(t, want, got)` |
| continue after failure | `t.Error` | `assert.*` |
| stop after failure | `t.Fatal` | `require.*` |
| diff output | manual format | automatic diff |

**Dave Cheney's position:** Prefers stdlib. Core argument: "testify already abstracts a minimum API; reading `if got != want` is idiomatic Go."

**Community Reality:** testify is the most imported package among Go test packages (~40,000 dependency modules). Clear diff messages improve productivity in large codebases.

**Practical Rules:**
- New libraries/utilities: stdlib only (no dependencies)
- Apps requiring multiple assertions: use testify, maintain team consistency
- `assert` vs `require`: `assert` = `t.Error` (continue after failure), `require` = `t.Fatal` (stop after failure)

## Table-Driven Tests — Go Idiomatic Patterns

**Accurate Convention (Go blog, Dave Cheney):**

```go
func TestCheckout(t *testing.T) {
    tests := []struct {
        name    string
        amount  int
        coupon  string
        want    int
        wantErr bool
    }{
        {name: "valid discount", amount: 10000, coupon: "SALE10", want: 9000, wantErr: false},
        {name: "expired coupon", amount: 10000, coupon: "EXPIRED", want: 0,    wantErr: true},
        {name: "below minimum order", amount: 4900, coupon: "MIN5000", want: 0, wantErr: true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // Arrange
            mockPG := new(MockPaymentGateway)
            if !tt.wantErr {
                mockPG.On("Charge", tt.want).Return(nil)
            }
            service := NewCheckoutService(mockPG)

            // Act
            result, err := service.Checkout(tt.amount, tt.coupon)

            // Assert
            if tt.wantErr {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
                assert.Equal(t, tt.want, result.FinalAmount)
                mockPG.AssertExpectations(t)
            }
        })
    }
}
```

**Parallel Subtest (Before 1.22):**
```go
for _, tc := range tests {
    tc := tc  // loop-variable capture required before Go 1.22
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // ...
    })
}
```
Go 1.22+: Loop variable capture language specification modification -> `tc := tc` unnecessary (but harmless)

**Naming Rules:**
- Space in subtest name -> replaced with `_` in output
- Slash `/` -> interpreted as subsubtest — prohibited in names
- Run one case with `go test -run TestCheckout/valid_discount`.

**Parallel teardown pattern:**
```go
func TestGrouped(t *testing.T) {
    // setup
    t.Run("group", func(t *testing.T) {
        t.Run("Test1", parallelTest1)
        t.Run("Test2", parallelTest2)
    })
    // teardown runs after every parallel subtest finishes
}
```

## Interface-Based Mocking — Go Philosophy

Go's mocking philosophy: **small interfaces + direct test doubles first**.

Dave Cheney (SOLID Go Design): "Well-designed interfaces are small; the proverb is single method interface."

**Handwritten Spy (quii learn-go-with-tests pattern):**
```go
// Define the interface at the point of use (the consumer owns it)
type Sleeper interface {
    Sleep()
}

// Test file: handwritten implementation
type SpySleeper struct {
    Calls int
}
func (s *SpySleeper) Sleep() { s.Calls++ }

// Test
func TestCountdown(t *testing.T) {
    spy := &SpySleeper{}
    Countdown(os.Stdout, spy)
    assert.Equal(t, 4, spy.Calls)
}
```

**Quii "working without mocks" core:**
- mock: interaction testing (call count, arguments)
- fake: behavior testing (in-memory implementation) -> more realistic, stronger against refactoring
- An interface with 10 methods is a design problem before the mock problem

**when to use mock framework:**
- when the interface is large or call order verification is needed
- when using a spy becomes verbose

## uber-go/mock (gomock fork)

[WARN] `github.com/golang/mock` was **archived** in 2023 year 6 month — `go.uber.org/mock` usage:

```bash
go install go.uber.org/mock/mockgen@latest
mockgen -source=payment.go -destination=mock_payment.go
```

```go
ctrl := gomock.NewController(t)
mockPG := NewMockPaymentGateway(ctrl)
mockPG.EXPECT().Charge(gomock.Eq(9000)).Return(nil)
service := NewCheckoutService(mockPG)
_, err := service.Checkout(10000, "SALE10")
assert.NoError(t, err)
```

## testify/mock + mockery

```go
// Mock definition
type MockDB struct{ mock.Mock }

func (m *MockDB) Save(user User) error {
    return m.Called(user).Error(0)
}

// Test
func TestSave(t *testing.T) {
    db := &MockDB{}
    db.On("Save", someUser).Return(nil)
    service := NewUserService(db)
    err := service.CreateUser(someUser)
    assert.NoError(t, err)
    db.AssertExpectations(t)
}
```

**uber-go/mock vs testify/mock:**
- uber-go/mock: compile-time type safety, enforced call order, preferred by Google/large enterprise codebases
- testify/mock + mockery: broader community, consistency for teams using testify

## File Structure

**White-box (internal, `package foo`):**
```go
// user_test.go
package user  // same package name; can access unexported members
```

**Black-box (external, `package foo_test`):**
```go
// user_test.go
package user_test  // _test suffix; public API only
import "yourmodule/user"
```

Library packages prefer `package foo_test` — tested from the external consumer's perspective.
Both methods can be used in the same directory.

```
checkout/
    service.go
    service_test.go      # package checkout (white-box, unit)
    service_api_test.go  # package checkout_test (black-box, API contract)
```

## Coverage

```bash
go test -cover ./...                    # percentages by package
go test -coverprofile=c.out ./...       # save profile
go tool cover -func=c.out               # analyze by function
go tool cover -html=c.out               # browser view
go test -count=1 -cover ./...           # ignore cache
```

**Go Blog (Rob Pike) Statement:** Coverage is the starting point for finding untested code. The number itself is not a quality indicator. There is no official target percentage — focus on error paths and boundary condition coverage.

## diff coverage — gate only for new code

If you set the absolute coverage % as a CI gate, **legacy debt becomes hostage**. A single PR cannot create 80% in the repository 43%, so the gate is turned off, and an off gate is no gate. Conversely, this change **newly added line** must already be covered by a test that failed in Phase 3. Therefore, the gate is based on the **diff**, not the whole thing. It does not conflict with Rob Pike's view ("the number itself is not a quality indicator")—because what is measured is **whether this change came without tests**, not the repository's report card.

The baseline is the merge point. If you set it to `origin/main..HEAD`, it calculates your diff up to the line of another branch, as much as it is behind.

Requires Node.js 20+.

```bash
git fetch origin main
BASE=$(git merge-base origin/main HEAD)

go test -covermode=atomic -coverprofile=cover.out ./...

# (a) This skill's checker reads coverprofile directly
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/test_gates.js diff-coverage \
    --diff <(git diff -U0 "$BASE"...HEAD) \
    --coverage cover.out --fail-under 90

# (b) Convert to Cobertura to use diff-cover
go install github.com/boumenot/gocover-cobertura@latest
gocover-cobertura < cover.out > coverage.xml
diff-cover coverage.xml --compare-branch=origin/main --fail-under=90
```

`go tool cover -func=cover.out` is **function-level summary** and cannot be the input to diff gate — knowing only that a single function has 60% does not allow me to know whether the line I entered is in 60%.
Pass the original profile (`cover.out`) as is.

Two judging rules —

- **If there are no executable new lines, it passes.** If a PR with only changed generated code is dropped as 0% from `go.mod` comments, the gate is ignored in one go.
- **Line movement is not new.** Track name changes with `git diff -M`, and if a bulk move commit was removed from the gate, state the reason in the PR body.

## Race Detector

```bash
go test -race ./...       # all tests plus race detection
go run -race main.go
```

Go Team Recommendation:
- Always run in the CI pipeline
- Run in integration/load tests (requires concurrent code paths)
- Canary deployment on some production servers (~10x CPU/memory overhead)

race detector detects only races triggered at runtime — actual workload is important.

## Helper and fixture

```go
// TestMain — package-wide setup and teardown
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}

// t.Cleanup — clean up after each test
func TestSomething(t *testing.T) {
    db := setupDB(t)
    t.Cleanup(func() { db.Close() })
}
```

## Anti-pattern

```go
// [X] wait for a goroutine with time.Sleep (flaky test)
time.Sleep(100 * time.Millisecond)
// CORRECT: inject a channel, sync.WaitGroup, or Sleeper interface

// [X] omit loop-variable capture before Go 1.22
for _, tc := range tests {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        use(tc)  // tc is overwritten by the loop's final value
    })
}
// CORRECT: add tc := tc

// [X] share state between tests through a global
var globalService *CheckoutService  // test-order dependent

// [X] init() in test files
// Execution order is unclear; use TestMain

// [X] omit Close after httptest.NewServer
ts := httptest.NewServer(handler)
// Omitting defer ts.Close() leaks a goroutine

// [X] continue using golang/mock (archived)
// import "github.com/golang/mock/gomock"
// CORRECT: "go.uber.org/mock/gomock"

// [X] use http.DefaultClient with a TLS test server
resp, _ := http.Get(ts.URL)  // certificate error
// CORRECT: use ts.Client(), which is configured with the test certificate
```
