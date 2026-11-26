/** The two-entry catalog that catalog.test.ts and catalog_layout.test.ts build from. Not a test file. */
import type { SkillCatalog } from '../runtime/skill_catalog.js';

export function contract(): SkillCatalog {
  return { schemaVersion: 1, categories: ['workflow'], entries: [
    { owner: 'audit', name: 'review', visibility: 'public', category: 'workflow', aliases: ['audit'], purpose: 'Review an artifact.' },
    { owner: 'bridge', name: 'runtime-adaptation', visibility: 'support', aliases: ['bridge'], usedBy: ['audit'], when: 'When crossing runtimes.' },
  ] };
}
