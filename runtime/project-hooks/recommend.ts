/** Read-only project check advice. Jev shadow never records setup consent or executes a checker. */
import { readState, resolveStateLocation } from './state.js';
import { fileProjectView } from './view.js';
import { normalizeRelative, selectCheckers } from './select.js';
import { compareShadow, jevSettings, type ProjectChecksState, type ShadowOptions } from '../jev.js';

export interface Recommendation {
  decision: string;
  recommendation: 'ask-user' | 'use-existing' | 'offer-setup' | 'respect-no-setup' | 'no-check';
  checkers: string[]; gaps: string[]; jevMode: string;
}
export async function recommendProjectChecks(cwd: string, paths: readonly string[], options: Partial<ShadowOptions> = {}): Promise<Recommendation> {
  jevSettings(options.env);
  const location = resolveStateLocation(cwd);
  const read = readState(location);
  const decision = read.status === 'ok' ? read.state.decision : 'undecided';
  const safePaths = paths.map(path => normalizeRelative(path));
  if (safePaths.some(path => path === undefined)) throw new Error('recommendation paths must be relative to the project and cannot escape it');
  const selection = selectCheckers(safePaths as string[], fileProjectView(location.root));
  const checkers = selection.selections.map(row => row.id);
  const gaps = selection.gaps.map(row => row.kind);
  if (decision === 'without-setup') return { decision, recommendation: 'respect-no-setup', checkers, gaps, jevMode: 'off' };
  if (!safePaths.length || (!checkers.length && gaps.every(gap => gap === 'standalone-script'))) return { decision, recommendation: 'no-check', checkers, gaps, jevMode: 'off' };
  const recommendation = decision === 'undecided' ? 'ask-user' : gaps.some(gap => gap !== 'standalone-script') ? 'offer-setup' : 'use-existing';
  const languages = [...new Set([...selection.selections.map(row => row.language), ...selection.gaps.flatMap(row => row.language ? [row.language] : [])])].sort();
  const state: ProjectChecksState = {
    point: 'project-checks', languages, projectDecision: decision,
    configuredCheckerCount: selection.selections.filter(row => row.kind === 'lint').length,
    missingManifestCount: selection.gaps.filter(row => row.kind === 'missing-manifest').length,
    missingCheckerCount: selection.gaps.filter(row => row.kind === 'no-configured-checker').length,
  };
  const shadow = await compareShadow(state, recommendation, { ...options, workspace: location.root });
  return { decision, recommendation, checkers, gaps, jevMode: shadow.mode };
}
