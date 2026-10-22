import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { releaseFixture } from './fixtures/sdlc_release.js';
test('real contract reaches local Release, survives commit response loss and rejects stale proof', async t => {
  const { c, event, runStatus, load } = await releaseFixture(t);
  await event('complete'); const final = runStatus(c, load(c, 'change'));
  assert.equal(final.runComplete, true); assert.equal(final.disposition, 'satisfied');
  assert.equal(final.projections.R1['checks-passed'].state, 'pass');
  assert.equal(final.projections.R1['review-approved'], 'pass'); assert.equal(final.projections.R1.accepted, 'pass');
  assert.deepEqual(final.notApplicable.map((x: any) => x.gate), ['push', 'pr', 'ship']);
  writeFileSync('app.cjs', 'module.exports=3;'); assert.equal(runStatus(c, load(c, 'change')).runComplete, false);
});
