/** Retain the complete evaluation tag population, answer locations, and Git binding. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check_eval_cases, check_no_constant_assertions, check_total, type Result } from '../skills/_suite_lib.js';
import { yamlTags } from '../scripts/eval_tags.js';
import { ROOT } from './_fixtures.js';
export const TAG = 'ablation-discriminating';
export const DISCRIMINATING = new Set<string>([
  "discriminating/audit-priority",
  "discriminating/cleanup-axes",
  "discriminating/deck-design-slop",
  "discriminating/diagram-connector-rules",
  "discriminating/hwpx-format-units",
  "regression/humanize-taxonomy-recall"
]);
export const ANSWER_TOKENS: Record<string, string[]> = {
  "discriminating/hwpx-format-units": [
    "84186",
    "59528",
    "283.46",
    "7200",
    "100 HWPUNIT"
  ],
  "discriminating/diagram-connector-rules": [
    "Draw arrows before boxes",
    "6~10px",
    "Do not pass behind a third box (exceptions apply)"
  ],
  "discriminating/deck-design-slop": [
    "underspec",
    "no-constraint",
    "no-verify",
    "median",
    "Content",
    "Tables and figures",
    "Typesetting",
    "Reversals in procurement",
    "Item counts must be exact: 6, 5, 6, 4."
  ],
  "regression/humanize-taxonomy-recall": [
    "Procurement commitment register deviation",
    "Requirements traceability topology collapse",
    "Body–visual integration collapse",
    "K-1 … K-5",
    "M-1 … M-7",
    "L-1 … L-4",
    "N-1 … N-6",
    "O-1 … O-7"
  ],
  "discriminating/audit-priority": [
    "Blockers",
    "order and count must match.",
    "blocking is the default verdict and the author bears the burden of proof"
  ],
  "discriminating/cleanup-axes": [
    "There are 10 axes",
    "wrapper for a single call site",
    "The count must be exact."
  ]
};

test('evals: complete population, answer placement, and anti-constant contracts remain measured', () => {
  const results: Result[] = [];
  const check = (label: string, ok: boolean, detail = '') => { results.push([label, ok, detail]); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail && !ok ? ' — ' + detail : ''}`); };
  check_eval_cases(check, ROOT, ROOT, yamlTags, { tag: TAG, discriminating: DISCRIMINATING, answer_tokens: ANSWER_TOKENS });
  check_no_constant_assertions(check, fileURLToPath(import.meta.url));
  check_total(check, results, 129);
  const passed = results.filter(row => row[1]).length;
  console.log(`\n${passed}/${results.length} 통과`);
  assert.equal(passed, results.length, results.filter(row => !row[1]).map(row => row.join(' — ')).join('\n'));
});
