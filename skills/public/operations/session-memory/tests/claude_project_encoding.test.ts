import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claude } from '../scripts/migrate_sessions.js';

test('Claude project directory names encode underscores like the host does', () => {
  assert.equal(claude.encoded('/work/graduate_school_path'), '-work-graduate-school-path');
});
