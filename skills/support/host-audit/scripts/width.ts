/**
 * Terminal display width as Claude Code measures listing text (`Bun.stringWidth` with ambiguous characters narrow), counted per grapheme cluster:
 * a cluster is 2 when it holds an East Asian wide or fullwidth character, an emoji with default emoji presentation, an emoji made wide by VS16 (U+FE0F) or a keycap,
 * or a regional-indicator pair; 0 when it holds only zero-width, format and combining characters; otherwise 1.
 * Text-presentation symbols without VS16 (a check mark, a warning sign, a heart, a trade mark) are 1, and a skin tone or ZWJ family is one cluster.
 */
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2630, 0x2637], [0x268a, 0x268f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16ff6], [0x17000, 0x18dff],
  [0x1aff0, 0x1affe], [0x1b000, 0x1b2ff], [0x1d300, 0x1d376], [0x1f200, 0x1f265], [0x1fa70, 0x1faff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];
/** Zero width: combining marks, format characters (zero-width space and joiners, BOM, word joiner) and the Hangul medial and final jamo that only join a leading one. */
const ZERO = /[\p{Mn}\p{Me}\p{Cf}\u1160-\u11ff\ud7b0-\ud7ff]/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u, EMOJI = /\p{Emoji}/u, SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const isWide = (code: number): boolean => WIDE.some(([low, high]) => code >= low && code <= high);

function clusterWidth(cluster: string): number {
  let visible = false, regional = 0, emoji = false, selector = false;
  for (const char of cluster) {
    const code = char.codePointAt(0)!;
    if (code === 0x20e3) return 2;
    if (code === 0xfe0f) { selector = true; continue; }
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || ZERO.test(char)) continue;
    if (code >= 0x1f1e6 && code <= 0x1f1ff) { if (++regional === 2) return 2; visible = true; continue; }
    if (isWide(code) || EMOJI_PRESENTATION.test(char)) return 2;
    if (EMOJI.test(char) && !(code === 0x23 || code === 0x2a || (code >= 0x30 && code <= 0x39))) emoji = true;
    visible = true;
  }
  return selector && emoji ? 2 : visible ? 1 : 0;
}
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of SEGMENTER.segment(text)) width += clusterWidth(segment);
  return width;
}
