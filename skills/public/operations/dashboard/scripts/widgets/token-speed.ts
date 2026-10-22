/**
 * Token speed widgets - display output token generation speed
 * tokenSpeed: session average. tokenSpeedLast: the newest response alone.
 * Both are derived from the transcript (see accountTokens in transcript-parser).
 * @handbook 3.3-widget-data-sources
 * @tested scripts/__tests__/widgets.test.ts
 */

import type { Widget } from './base.js';
import type { WidgetContext, TokenSpeedData } from '../types.js';
import { colorize, getTheme } from '../utils/colors.js';
import { ICON } from '../utils/emoji.js';
import { getTranscript } from '../utils/transcript-parser.js';

function toRate(outputTokens: number, durationMs?: number): TokenSpeedData | null {
  if (outputTokens <= 0 || !durationMs || durationMs <= 0) return null;
  const tokensPerSecond = outputTokens / (durationMs / 1000);
  return Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? { tokensPerSecond } : null;
}

function formatRate(data: TokenSpeedData): string {
  return `${Math.round(data.tokensPerSecond)} tok/s`;
}

export const tokenSpeedWidget: Widget<TokenSpeedData> = {
  id: 'tokenSpeed',
  name: 'Token Speed',

  async getData(ctx: WidgetContext): Promise<TokenSpeedData | null> {
    // Until Claude Code 2.1.132 this read stdin's context_window.total_output_tokens
    // over cost.total_api_duration_ms. 2.1.132 made the former per-response, and the
    // latter also counts subagent/side-query calls, so both halves now come from the
    // main transcript.
    const transcript = await getTranscript(ctx);
    if (!transcript) return null;
    return toRate(transcript.sessionOutputTokens, transcript.sessionRequestMs);
  },

  render(data: TokenSpeedData, _ctx: WidgetContext): string {
    return colorize(`${ICON.zap} ${formatRate(data)}`, getTheme().accent);
  },
};

export const tokenSpeedLastWidget: Widget<TokenSpeedData> = {
  id: 'tokenSpeedLast',
  name: 'Token Speed (Last Response)',

  async getData(ctx: WidgetContext): Promise<TokenSpeedData | null> {
    const transcript = await getTranscript(ctx);
    if (!transcript) return null;
    return toRate(transcript.lastRequestOutput, transcript.lastRequestDurationMs);
  },

  render(data: TokenSpeedData, ctx: WidgetContext): string {
    // Labelled so it stays distinguishable when shown next to tokenSpeed.
    return colorize(
      `${ICON.zap} ${ctx.translations.widgets.tokenSpeedLast} ${formatRate(data)}`,
      getTheme().accent
    );
  },
};
