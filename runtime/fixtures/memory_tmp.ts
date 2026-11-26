import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * The temporary root for test fixtures. On Linux it is the memory filesystem when /dev/shm is mounted without noexec, as
 * on CI runners and in Docker containers, so fixtures may still hold programs and native addons that tests run. Fixture
 * writes keep their real disk syncs, but on a busy CI disk each block-device sync or metadata update can wait for a
 * long time, and files that mostly waited failed the test time budget. Elsewhere it is `fallback`, the temp directory
 * the caller used before.
 */
export function memoryTemporaryRoot(fallback = tmpdir()): string {
  if (process.platform !== 'linux') return fallback;
  try {
    return readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => { const field = line.split(' '); return field[4] === '/dev/shm' && !field[5]!.split(',').includes('noexec'); }) ? '/dev/shm' : fallback;
  } catch { return fallback; }
}
