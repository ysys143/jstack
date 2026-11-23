// Dependency-free emoji detection: hook-policies.ts loads this module on every dispatch
// for its prefilter, so it must stay free of imports and I/O. block_emoji.js re-exports
// both names as the documented interface.
// Preserve the legacy contract, including the intentionally broad technical range.
export const EMOJI_PATTERN = /[\u{1f600}-\u{1f64f}\u{1f300}-\u{1f5ff}\u{1f680}-\u{1f6ff}\u{1f700}-\u{1f77f}\u{1f780}-\u{1f7ff}\u{1f800}-\u{1f8ff}\u{1f900}-\u{1f9ff}\u{1fa00}-\u{1fa6f}\u{1fa70}-\u{1faff}\u{1f926}-\u{1f937}\u2600-\u26ff\u2700-\u27bf\u2300-\u23ff\u2b50\u3030\u303d\u3297\u3299]+/gu;
export function containsEmoji(text: string): string[] { return text.match(EMOJI_PATTERN) ?? []; }
