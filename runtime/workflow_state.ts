/** Optimistic task-state writes: never hold a lock while executing a checker. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withLock, atomicWrite, assertNoLinks } from './os.js';
const scope = new AsyncLocalStorage<Map<string, string>>();
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function rememberState(file: string): void {
  if (!scope.getStore()?.has(file)) scope.getStore()?.set(file, digest(file));
}
export function writeState(file: string, data: any): void {
  assertNoLinks(file);
  withLock(file + '.lock', () => {
    const expected = scope.getStore()?.get(file);
    if (expected !== undefined && expected !== digest(file)) throw new Error('Task state changed during this operation; inspect status before retrying');
    data.revision = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).revision ?? 0 : 0) + 1;
    atomicWrite(file, Buffer.from(JSON.stringify(data) + '\n'), false);
    scope.getStore()?.set(file, digest(file));
  });
}
export async function stateOperation<T>(root: string, action: () => T | Promise<T>): Promise<T> {
  return scope.run(new Map(), async () => {
    const file = join(root, 'state.json');
    rememberState(file);
    return await action();
  });
}
