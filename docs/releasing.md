# Releasing jstack

A jstack release is a checked local marketplace and an npm tarball attached to a
GitHub release of this repository. Nothing is published to npm, and there is no
hosted remote marketplace. Releases bump the patch number while jstack is in its
early stage.

## Freeze, build and validate once

1. Start from a clean checkout of the release commit on `master`, with the version
   in `packaging/product.json`, `package.json`, `package-lock.json`, `README.md` and the
   top `CHANGELOG.md` entry already set.
2. Build into a fresh directory outside the source checkout and verify the inventory,
   tarball and marketplace before review:

```sh
set -eu
JSTACK_RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jstack-release.XXXXXX")"
export JSTACK_RELEASE_DIR
npm ci --ignore-scripts
npm run build
node dist/packaging/build.js inventory --source . --output "$JSTACK_RELEASE_DIR/inventory.json"
cmp packaging/package-files.json "$JSTACK_RELEASE_DIR/inventory.json"
npm pack --pack-destination "$JSTACK_RELEASE_DIR"
node dist/packaging/release.js --source . --output "$JSTACK_RELEASE_DIR/marketplace"
node dist/packaging/release.js --check "$JSTACK_RELEASE_DIR/marketplace"
node dist/packaging/build.js check "$JSTACK_RELEASE_DIR/marketplace/plugins/jstack"
```

These commands create checked local candidates; they do not publish them. Review
any inventory difference instead of replacing the reviewed manifest automatically.
Record the filename `npm pack` prints, unpack that exact tarball into a fresh
directory, and verify its CLI version, bundled receipt, integrity and installation
without the source checkout. The marketplace and the tarball must name the same
version and canonical source digest.

3. Check native discovery and installed bytes with the host probe:

```sh
node dist/packaging/host_probe.js \
  --package "$JSTACK_RELEASE_DIR/marketplace/plugins/jstack" \
  --output "$JSTACK_RELEASE_DIR/host-probe" --host both
```

The probe uses isolated homes and does not prove model execution or hook trust.
`lifecycle_probe.js --previous OLD_PACKAGE --package NEW_PACKAGE --output NEW_DIR`
needs a checked predecessor; record when none exists, as for the first release.

   Run each imported Claude Code mod's own tests in the engine harness, from the built
   package, with an empty configuration directory (no sign-in is needed):

```sh
for mod in "$JSTACK_RELEASE_DIR"/marketplace/plugins/jstack/payload/mods/*/; do
  CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin test "$mod"
done
```

   This needs Claude Code 2.1.287 or later. CI runs only the tests that need no engine
   harness, so record each mod's pass and fail counts; any failure blocks the release.
   Then validate the built plugin as Claude Code reads it, which also checks the hook
   module it loads:
   `claude plugin validate "$JSTACK_RELEASE_DIR/marketplace/plugins/jstack"`.

4. Run the full contracts as `.github/workflows/validate.yml` does, including its
   isolated specialist dependencies:
   `node dist/packaging/run_contracts.js --deletion --output NEW_DIR`. A run without
   `--deletion` records `full-no-deletion`; say so in the release record.

## Package the reviewable release

Archive the checked marketplace with its root as `jstack-marketplace/`, preserving
dot-directories and file modes, as `jstack-marketplace-<version>.zip`. Extract it in a
fresh directory and rerun the release check there. Write `SHA256SUMS` for the exact
`.tgz` and `.zip`, and a `RELEASE-EVIDENCE.md` with the source commit and tree,
version, package digest, asset checksums, platform, Node and host versions, the
commands run with their results, and the known limitations.

`release.json` inside the marketplace is a receipt for local candidate construction;
`checkRelease` enforces its `remotePublished: false`. Keep it intact and record
publication outside the checked marketplace.

## Publish and roll out

1. Confirm the tag `v<version>` is unused and create it at the reviewed commit.
2. Create a **draft** GitHub release with the exact assets, checksums, notes and
   evidence.
3. Install from the draft's assets in one profile and check version, discovery,
   one real task, hook behavior and rollback.
4. Publish the release only after those checks pass.
5. Roll the same assets out to each machine and profile, recording the active
   version, package digest, host discovery and restart requirement. Synchronizing
   the source repository alone does not update installed plugin caches.

If a canary fails, stop the rollout and keep the logs and artifacts. Restore the
previous managed version with `jst rollback` where a verified predecessor exists;
the first managed install has none. For native marketplace installs, restore the
retained checked marketplace through the host's own lifecycle. Never rewrite a
published version or delete caches that live sessions use.
