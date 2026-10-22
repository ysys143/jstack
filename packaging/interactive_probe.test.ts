import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROBE_MARKER, classify, highlighted, hookVerdict, probeHomeProblem, reviewCount } from './interactive_probe.js';

// Screens below are trimmed from tmux captures of Claude Code 2.1.286 and Codex 0.159.3,
// and from the Codex startup hook review source for the review modal.
// Claude Code follows its input prompt glyph with a no-break space; its menus use a plain space.
const PROMPT = String.fromCodePoint(0x276f), NBSP = String.fromCodePoint(0xa0);
const CLAUDE_READY = ` Claude Code v2.1.286\n${'-'.repeat(40)}\n${PROMPT}${NBSP}Try "edit <filepath> to..."\n${'-'.repeat(40)}\n  accept edits on (shift+tab to cycle)\n`;
const CLAUDE_TRUST = ` Accessing workspace:\n Quick safety check: Is this a project you created or one you trust?\n ${PROMPT} No, exit\n   Yes, I trust this folder\n Enter to confirm\n`;
const CODEX_LOGIN = `  >_ OpenAI Codex (v0.159.3)\n> Ask Codex to do anything\n  ? for shortcuts\n  Welcome to Codex, OpenAI's command-line coding agent\n  Sign in with ChatGPT to use Codex as part of your paid plan\n> 3. Provide your own API key\n  Press enter to continue\n`;
const CODEX_REVIEW = `  Hooks need review\n  5 hooks are new or changed.\n  Hooks can run outside the sandbox after you trust them.\n> 1. Review hooks\n  2. Trust all and continue\n  3. Continue without trusting (hooks won't run)\n`;

test('classify prefers blocking screens over prompt-like text behind them', () => {
  assert.equal(classify('claude', CLAUDE_READY), 'ready');
  assert.equal(classify('claude', CLAUDE_TRUST), 'folder-trust');
  assert.equal(classify('codex', CODEX_LOGIN), 'login');
  assert.equal(classify('codex', `${CODEX_REVIEW}\n  ? for shortcuts\n`), 'hook-review');
  assert.equal(classify('codex', '  Trust this folder? Codex can read, edit, and run files here\n> 1. Trust and continue\n  2. Quit\n'), 'folder-trust');
  assert.equal(classify('codex', 'starting'), 'other');
});

test('a Claude menu row with a plain space is not the input prompt', () => {
  assert.equal(classify('claude', ` Unexpected dialog\n${PROMPT} 1. Continue\n   2. Cancel\n`), 'other');
});

test('reviewCount reads the modal header and returns null without it', () => {
  assert.equal(reviewCount(CODEX_REVIEW), 5);
  assert.equal(reviewCount('  Hooks need review\n  1 hook is new or changed.\n'), 1);
  assert.equal(reviewCount(CLAUDE_READY), null);
});

test('highlighted matches only the row that carries the pointer', () => {
  assert.equal(highlighted(CODEX_REVIEW, 'Review hooks'), true);
  assert.equal(highlighted(CODEX_REVIEW, 'Trust all and continue'), false);
  assert.equal(highlighted(CLAUDE_TRUST, 'No, exit'), true);
  assert.equal(highlighted(CLAUDE_TRUST, 'Yes, I trust this folder'), false);
  assert.equal(highlighted(`  1. Review hooks\n${String.fromCodePoint(0x203a)} 2. Trust all and continue\n`, 'Trust all and continue'), true);
});

test('hookVerdict needs the control, the block message, and no blocked content on disk', () => {
  assert.equal(hookVerdict({ control: true, blockedWritten: false, blockMessage: true }), 'executed');
  assert.equal(hookVerdict({ control: true, blockedWritten: true, blockMessage: true }), 'not-blocked');
  assert.equal(hookVerdict({ control: true, blockedWritten: false, blockMessage: false }), 'not-exercised');
  assert.equal(hookVerdict({ control: false, blockedWritten: false, blockMessage: true }), 'not-exercised');
});

test('probeHomeProblem requires the marker and rejects personal homes, including through a link', t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-probe-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probe = join(root, 'probe'), personal = join(root, 'personal'), link = join(root, 'link');
  mkdirSync(probe); mkdirSync(personal); symlinkSync(personal, link);
  assert.match(probeHomeProblem(probe, [personal]) ?? '', /no \.jstack-interactive-probe marker/);
  writeFileSync(join(probe, PROBE_MARKER), ''); writeFileSync(join(personal, PROBE_MARKER), '');
  assert.equal(probeHomeProblem(probe, [personal, join(root, 'missing')]), null);
  assert.match(probeHomeProblem(link, [personal]) ?? '', /personal home/);
});
