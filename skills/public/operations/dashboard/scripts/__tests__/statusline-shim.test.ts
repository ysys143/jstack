/**
 * @handbook 8.1-test-structure
 * @covers scripts/statusline-shim.mjs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
// @ts-expect-error - dependency-free .mjs shim, no type declarations by design
import { pluginsDirsFor, resolveLatestDist, resolveDashboard, dataIdFor } from '../statusline-shim.mjs';

/** Create a dashboard build at the jstack package subpath. */
function makeVersion(cacheRoot: string, version: string, withDist = true): void {
  const dir = withDist ? path.join(cacheRoot, version, 'payload', 'skills', 'dashboard', 'dist') : path.join(cacheRoot, version);
  mkdirSync(dir, { recursive: true });
  if (withDist) writeFileSync(path.join(dir, 'index.js'), 'export {};');
}

describe('statusline-shim', () => {
  let tmpDir: string;
  let cacheRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'shim-test-'));
    cacheRoot = path.join(tmpDir, 'plugins', 'cache', 'sample-marketplace', 'sample-plugin');
    mkdirSync(cacheRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveLatestDist', () => {
    it('picks the newest version by numeric semver, not string order', () => {
      makeVersion(cacheRoot, '1.9.0');
      makeVersion(cacheRoot, '1.31.1');
      makeVersion(cacheRoot, '1.29.0');

      expect(resolveLatestDist(cacheRoot)).toBe(
        path.join(cacheRoot, '1.31.1', 'payload', 'skills', 'dashboard', 'dist', 'index.js')
      );
    });

    it('ignores directories without dist/index.js', () => {
      makeVersion(cacheRoot, '1.31.1');
      makeVersion(cacheRoot, '1.32.0', false);

      expect(resolveLatestDist(cacheRoot)).toBe(
        path.join(cacheRoot, '1.31.1', 'payload', 'skills', 'dashboard', 'dist', 'index.js')
      );
    });

    it('ignores non-semver directory names', () => {
      makeVersion(cacheRoot, '1.31.1');
      makeVersion(cacheRoot, 'unknown');
      makeVersion(cacheRoot, '2.0');

      expect(resolveLatestDist(cacheRoot)).toBe(
        path.join(cacheRoot, '1.31.1', 'payload', 'skills', 'dashboard', 'dist', 'index.js')
      );
    });

    it('returns null when no version has a build', () => {
      expect(resolveLatestDist(cacheRoot)).toBeNull();
    });

    it('returns null when the cache directory does not exist', () => {
      expect(resolveLatestDist(path.join(tmpDir, 'nope'))).toBeNull();
    });
  });

  describe('pluginsDirsFor', () => {
    it('uses the shim config directory without crossing to another home', () => {
      const shim = path.join(
        tmpDir, 'plugins', 'data', 'sample-plugin-sample-marketplace', 'statusline.mjs'
      );
      expect(pluginsDirsFor(shim, { CLAUDE_CONFIG_DIR: '/another/home' }).dirs).toEqual([path.join(tmpDir, 'plugins')]);
      expect(dataIdFor('sample-plugin@sample-marketplace')).toBe('sample-plugin-sample-marketplace');
    });
  });

  describe('CLI entry point', () => {
    let shimPath: string;

    beforeEach(() => {
      shimPath = path.join(
        tmpDir, 'plugins', 'data', 'sample-plugin-sample-marketplace', 'statusline.mjs'
      );
      mkdirSync(path.dirname(shimPath), { recursive: true });
      copyFileSync('scripts/statusline-shim.mjs', shimPath);
    });

    it('exits 0 with no output when cache directory does not exist', () => {
      const result = execFileSync('node', [shimPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(result).toBe('');
    });

    it('exits 0 silently when resolved dist/index.js throws on evaluation', () => {
      makeVersion(cacheRoot, '1.0.0');
      const distPath = path.join(cacheRoot, '1.0.0', 'payload', 'skills', 'dashboard', 'dist', 'index.js');
      writeFileSync(distPath, "throw new Error('boom');");

      const result = execFileSync('node', [shimPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(result).toBe('');
    });

    it('runs and outputs when resolved dist/index.js is valid', () => {
      makeVersion(cacheRoot, '1.0.0');
      const distPath = path.join(cacheRoot, '1.0.0', 'payload', 'skills', 'dashboard', 'dist', 'index.js');
      writeFileSync(distPath, "console.log('valid');");

      const result = execFileSync('node', [shimPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(result).toBe('valid\n');
    });

    it('runs and outputs when invoked through a symlinked config root (dotfiles layout)', () => {
      // Mirrors `ln -s ~/dotfiles/claude ~/.claude`: the shim's real files live under
      // <real>/plugins/..., and a symlink stands in for the config root that is actually
      // on the invoking path. Node's ESM loader resolves import.meta.url to the realpath,
      // while process.argv[1] keeps the literal (symlinked) path the shim was invoked with.
      const realRoot = path.join(tmpDir, 'dotfiles-claude');
      const realShimPath = path.join(
        realRoot, 'plugins', 'data', 'sample-plugin-sample-marketplace', 'statusline.mjs'
      );
      mkdirSync(path.dirname(realShimPath), { recursive: true });
      copyFileSync('scripts/statusline-shim.mjs', realShimPath);

      const realCacheRoot = path.join(realRoot, 'plugins', 'cache', 'sample-marketplace', 'sample-plugin');
      makeVersion(realCacheRoot, '1.0.0');
      writeFileSync(path.join(realCacheRoot, '1.0.0', 'payload', 'skills', 'dashboard', 'dist', 'index.js'), "console.log('via-symlink');");

      const linkedRoot = path.join(tmpDir, 'claude-config');
      symlinkSync(realRoot, linkedRoot, 'dir');
      const linkedShimPath = path.join(
        linkedRoot, 'plugins', 'data', 'sample-plugin-sample-marketplace', 'statusline.mjs'
      );

      const result = execFileSync('node', [linkedShimPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(result).toBe('via-symlink\n');
    });

    it('exits 0 with no output when argv[1] does not exist on disk (realpathSync throws)', () => {
      // Reproduces the isInvokedDirectly() catch branch: realpathSync on a nonexistent
      // argv[1] must degrade to false, not crash. A runner script overrides argv[1] to a
      // bogus path before importing the real shim, so `node` itself never has to resolve
      // that bogus path as its entry file.
      makeVersion(cacheRoot, '1.0.0');
      writeFileSync(path.join(cacheRoot, '1.0.0', 'payload', 'skills', 'dashboard', 'dist', 'index.js'), "console.log('should-not-run');");

      const runnerPath = path.join(tmpDir, 'runner.mjs');
      const shimUrl = pathToFileURL(shimPath).href;
      writeFileSync(
        runnerPath,
        `process.argv[1] = '/definitely/does/not/exist/statusline.mjs';\n` +
          `await import(${JSON.stringify(shimUrl)});\n`
      );

      const result = execFileSync('node', [runnerPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(result).toBe('');
    });
  });
});
