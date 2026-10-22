// Node stand-in for the parts of Claude Code's 'claude-code/testing' kit that a mod's
// pure-logic tests use. A test whose body takes the engine harness ($, on) is skipped
// with a reason: only `claude plugin test` can run it. The matchers follow the engine
// kit on the cases hosts/claude/mods/stack-viewer.test.ts pins.
import assert from 'node:assert/strict';
import { describe as nodeDescribe, test as nodeTest } from 'node:test';

export const HARNESS_SKIP = 'needs the Claude Code engine harness; run claude plugin test';
export const describe = (name, fn) => nodeDescribe(name, fn);
/** test(name, body) or test(name, options, body); the body is always the last argument. Of the engine's
 * options only timeoutMs applies outside the harness; plugins and options configure the harness itself. */
export const test = (name, ...args) => {
  const body = args.at(-1);
  if (typeof body !== 'function') throw new TypeError(`test ${name}: the last argument must be the test body`);
  const options = args.length > 1 && isObject(args[0]) ? args[0] : {};
  if (body.length > 0) return nodeTest(name, { skip: HARNESS_SKIP }, () => {});
  return nodeTest(name, { timeout: options.timeoutMs }, body);
};

function isObject(value) {
  return value !== null && typeof value === 'object';
}
const both = (a, b, type) => a instanceof type && b instanceof type;
const either = (a, b, type) => a instanceof type || b instanceof type;
/** toEqual: recursive equality that ignores properties whose value is undefined. */
export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (either(a, b, RegExp)) return both(a, b, RegExp) && String(a) === String(b);
  if (either(a, b, Date)) return both(a, b, Date) && Object.is(a.getTime(), b.getTime());
  if (either(a, b, Map)) return both(a, b, Map) && a.size === b.size && [...a].every(([key, value]) => b.has(key) && equal(value, b.get(key)));
  if (either(a, b, Set)) return both(a, b, Set) && a.size === b.size && [...a].every(value => b.has(value) || [...b].some(other => equal(value, other)));
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const keys = o => Object.keys(o).filter(k => o[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every(k => equal(a[k], b[k]));
}
/** toMatchObject: every expected property matches; arrays match element by element at equal length. */
export function subset(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((x, i) => subset(actual[i], x));
  if (!isObject(expected) || expected instanceof RegExp || expected instanceof Date || expected instanceof Map || expected instanceof Set) return equal(actual, expected);
  return isObject(actual) && Object.keys(expected).every(k => subset(actual[k], expected[k]));
}
const show = value => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function matchers(actual, negate) {
  const check = (pass, message) => assert.ok(negate ? !pass : pass, (negate ? 'not ' : '') + message);
  // Like the engine kit, a value of the wrong type simply does not match, so the negated form passes.
  return {
    toBe: expected => check(Object.is(actual, expected), `toBe ${show(expected)}, got ${show(actual)}`),
    toEqual: expected => check(equal(actual, expected), `toEqual ${show(expected)}, got ${show(actual)}`),
    toMatchObject: expected => check(isObject(actual) && subset(actual, expected), `toMatchObject ${show(expected)}, got ${show(actual)}`),
    toContain: item => check(typeof actual === 'string' ? actual.includes(item) : actual != null && typeof actual[Symbol.iterator] === 'function' && Array.from(actual).includes(item), `toContain ${show(item)}, got ${show(actual)}`),
    toMatch: pattern => check(typeof actual === 'string' && (typeof pattern === 'string' ? actual.includes(pattern) : pattern.test(actual)), `toMatch ${pattern}, got ${show(actual)}`),
    toBeDefined: () => check(actual !== undefined, `toBeDefined, got ${show(actual)}`),
    toBeUndefined: () => check(actual === undefined, `toBeUndefined, got ${show(actual)}`),
    toBeFalsy: () => check(!actual, `toBeFalsy, got ${show(actual)}`),
  };
}
export const expect = actual => Object.assign(matchers(actual, false), { not: matchers(actual, true) });
