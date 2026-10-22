#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Build script for claude-dashboard
 * @handbook 8.3-dist-commit
 */

/**
 * Read and parse JSON file with error handling
 */
function readJsonFile(filePath, description) {
  if (!existsSync(filePath)) {
    throw new Error(`${description} not found: ${filePath}`);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse ${description}: ${error.message}`);
  }
}

/**
 * Write JSON file with error handling
 */
function writeJsonFile(filePath, data, description) {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  } catch (error) {
    throw new Error(`Failed to write ${description}: ${error.message}`);
  }
}

async function main() {
  try {
    // Read version from package.json (single source of truth)
    const pkg = readJsonFile('./package.json', 'package.json');
    const version = pkg.version;

    if (!version) {
      throw new Error('Version not found in package.json');
    }

    // Common build options
    const commonOptions = {
      bundle: true,
      platform: 'node',
      format: 'esm',
      define: {
        __VERSION__: JSON.stringify(version),
      },
    };

    // Build main statusline entry point
    await build({
      ...commonOptions,
      entryPoints: ['scripts/statusline.ts'],
      outfile: 'dist/index.js',
    });

    console.log(`✓ Built dist/index.js with version ${version}`);

    // Build check-usage entry point
    await build({
      ...commonOptions,
      entryPoints: ['scripts/check-usage.ts'],
      outfile: 'dist/check-usage.js',
    });

    console.log(`✓ Built dist/check-usage.js with version ${version}`);

    // --- Local change -----------------------------------------
    // Upstream synchronized .claude-plugin/plugin.json and marketplace.json
    // with package.json here. We exclude both files: our manifests already
    // exist, and two marketplaces do not merge (plan section 1.7).
    //
    // Keeping that step exits 1 after both bundles are complete because the
    // manifests are absent. This prevents enforcing build reproducibility
    // (byte-identical committed bundles) through exit status. The version from
    // package.json is already embedded in both bundles.
    //
    // Separate axes bind versions: UPSTREAM.sha256 fixes the imported version,
    // while our plugin.json owns the jstack version.
    console.log(`[OK] Bundles carry version ${version} (local change: manifest sync dropped)`);
    // --- End local change -----------------------------------------------------
  } catch (error) {
    console.error(`✗ Build failed: ${error.message}`);
    process.exit(1);
  }
}

main();
