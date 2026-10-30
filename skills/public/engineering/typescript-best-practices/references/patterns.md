# TypeScript patterns

One short example per rule in `SKILL.md`. The examples use a small task runner
so the shapes read the same in every section. Match the repository's existing
names and conventions before you copy any of this.

## Discriminated unions

Give every variant the same literal field and a different value. A state that
mixes a flag with optional fields can describe combinations nobody intended.

```ts
// Avoid: "finished" with no result, or "failed" with a result, both compile.
type Job = { finished: boolean; result?: string; reason?: string };

// Prefer: each state carries exactly the fields it can have.
type Job =
  | { kind: "queued" }
  | { kind: "done"; result: string }
  | { kind: "failed"; reason: string };
```

Pick one discriminant name for the codebase (`kind`, `type`, or `tag`).

## Branded types

Two strings that mean different things should not be interchangeable.

```ts
type TaskId = string & { readonly __brand: "TaskId" };

const TASK_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

function isTaskId(input: string): input is TaskId {
  return TASK_ID.test(input);
}

function parseTaskId(input: string): TaskId {
  if (!isTaskId(input)) throw new Error(`Invalid task id: ${input}`);
  return input;
}

function readTask(id: TaskId): void {
  /* the id was verified once, at creation */
}
```

Follow a brand shape that already exists in the repository. Brand a primitive
because two arguments could be swapped, not by reflex.

## Constructive modeling

Build the type from parts that are all legal, so no runtime check has to
restrict a loose one.

```ts
type NonEmpty<T> = [T, ...T[]];

// Avoid: every caller must remember the length check.
function pickFirst(paths: string[]): string {
  if (paths.length === 0) throw new Error("no paths");
  return paths[0];
}

// Prefer: an empty value of this type cannot be constructed.
function pickFirst(paths: NonEmpty<string>): string {
  return paths[0];
}

// Where a plain array arrives, narrow once and let the fact travel in the type.
const isNonEmpty = <T>(items: T[]): items is NonEmpty<T> => items.length > 0;
```

A range stored as `start` and `durationMs` cannot be negative the way a `start`
and `end` pair can. Derive `end` where you need it.

## Simplest total type

Do not strengthen everything. `T[]` stays when every operation on it is total.

```ts
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0); // [] gives 0, fine
```

Strengthen when the loose type forces a lie at the use site. The tells are `!`,
`items[0] as T`, and a throw that "cannot happen".

```ts
// Avoid: the compiler is told something it cannot check.
const newest = (runs: Run[]): Run => runs.at(0)!;

// Prefer: strengthen the input, or return `Run | undefined`.
const newest = (runs: NonEmpty<Run>): Run => runs[0];
```

## `unknown` over `any`

Anything from outside is `unknown` until it has been parsed. `JSON.parse`
returns `any`, so name the type you get back.

```ts
// Avoid: any flows through the whole program.
const state = JSON.parse(text);
state.jobs.length;

// Prefer: unknown forces a parse before use.
const raw: unknown = JSON.parse(text);
```

## Parse, then trust

If the repository has a schema library, define the schema once and infer the
type from it.

```ts
// With a schema library already in the repository (names vary by library):
const JobSchema = schema.object({ id: schema.string(), kind: schema.enum(["queued", "done"]) });
type Job = Infer<typeof JobSchema>;
const job = JobSchema.parse(raw);
```

Without one, write a single parse function per boundary that checks each field
and returns the domain type. Do not add a dependency for one guard.

```ts
type Config = { readonly root: string; readonly retries: number };

function parseConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) throw new Error("config must be an object");
  const root = "root" in raw ? raw.root : undefined;
  const retries = "retries" in raw ? raw.retries : undefined;
  if (typeof root !== "string" || root === "") throw new Error("config.root must be a non-empty string");
  if (typeof retries !== "number" || !Number.isInteger(retries) || retries < 0) {
    throw new Error("config.retries must be a non-negative integer");
  }
  return { root, retries };
}
```

The `in` operator narrows `raw` without a cast, and each field is checked before
it is used. Everything after the parse takes `Config`.

## No `as` casts

When you want to remove an `as`, find out why the compiler cannot infer the
type, and fix that.

- A missing discriminant: add one and switch to a discriminated union.
- A source type that is too wide, such as `Record<string, unknown>`: narrow it.
- An untyped boundary: parse it with the schema or function that owns the shape.
- A truly inexpressible case: use a brand or `satisfies`.

```ts
// Avoid
const job = value as Job;

// Prefer
const job = parseJob(value);
```

## `satisfies` instead of `as`

`satisfies` checks a value against a type without widening its literals.

```ts
// Avoid: widens, and loses the literal "fast".
const preset = { mode: "fast", retries: 2 } as Preset;

// Prefer: checked against Preset, and mode stays the literal "fast".
const preset = { mode: "fast", retries: 2 } satisfies Preset;
```

## Narrowing order

Use the first that works: a discriminant switch, then the `in` operator, then
`typeof` or `instanceof`, then a user-defined guard, then `as`.

```ts
function describe(shape: Circle | Rect): string {
  if ("radius" in shape) return `circle ${shape.radius}`; // narrowed to Circle
  return `rect ${shape.width}x${shape.height}`;
}
```

## Honest guards

A guard that does not verify what its signature claims makes the type system
lie, and the lie has a trustworthy name.

```ts
// Avoid: checks one property and claims the whole type.
function isJob(x: unknown): x is Job {
  return typeof x === "object" && x !== null && "kind" in x;
}

// Prefer: use the parse above; or check every field the type promises.
```

When the discriminant already narrows the value, skip the guard.

## Exhaustiveness

End a variant switch by assigning the value to a `never` local. Adding a variant
then fails the build at every switch that forgot it.

```ts
function label(job: Job): string {
  switch (job.kind) {
    case "queued":
      return "waiting";
    case "done":
      return job.result;
    case "failed":
      return job.reason;
    default: {
      const _exhaustive: never = job;
      return _exhaustive;
    }
  }
}
```

In a switch that returns nothing, write `void _exhaustive;` in the default arm.

## Derive, do not duplicate

When a schema file, protocol definition, or generated module owns a shape,
derive from its types.

```ts
// Avoid: a second copy of the shape that drifts when the schema changes.
type Summary = { total: number; failures: { name: string }[] };

// Prefer: pick from the generated type.
import type { RunReport } from "<generated module>";
type Summary = Pick<RunReport, "total" | "failures">;
```

## Object arguments

```ts
// Avoid: swapping the two numbers still compiles.
copyRange(source, 10, 20);

// Prefer: order no longer matters, and the call explains itself.
copyRange({ source, from: 10, to: 20 });
```

Skip this on hot paths such as parsers, tokenizers, and tight loops, where the
allocation costs more than the clarity earns.

## Boundary in practice

Parse at the edge, call a pure function, let a thin shell do the effects.

```ts
// Pure: data in, data out. Testable without the file system.
export function selectRetries(config: Config, job: Job): number {
  return job.kind === "failed" ? config.retries : 0;
}

// Shell: touches the world, then hands typed data to the pure function.
export function main(argv: string[]): number {
  const config = parseConfig(JSON.parse(readFileSync(argv[0], "utf8")));
  console.log(String(selectRetries(config, { kind: "queued" })));
  return 0;
}
```

For persisted state, include a version in the blob and catch a failed parse
where the file is read, so a corrupt file is an expected branch.
