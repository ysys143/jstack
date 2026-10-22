/**
 * Burn rate widget - displays tokens consumed per minute (session average)
 * Consumption = input + cache write + output, summed from the transcript, over the
 * time since the transcript's first entry.
 * @handbook 3.3-widget-data-sources
 * @tested scripts/__tests__/widgets.test.ts
 */

import type { Widget } from './base.js';
import type { WidgetContext, BurnRateData } from '../types.js';
import { ICON } from '../utils/emoji.js';
import { formatTokens } from '../utils/formatters.js';
import { getTranscript } from '../utils/transcript-parser.js';

export const burnRateWidget: Widget<BurnRateData> = {
  id: 'burnRate',
  name: 'Burn Rate',

  async getData(ctx: WidgetContext): Promise<BurnRateData | null> {
    // stdin's current_usage covers the last request only (and counts cache reads), so
    // the session total comes from the transcript. See accountTokens for what counts.
    const transcript = await getTranscript(ctx);
    if (!transcript) return null;

    // Measure time over the same span as the token total: from the transcript's first
    // entry. The session.ts clock starts when a session widget first renders, so a
    // widget enabled mid-session would divide the whole history by a few seconds.
    const { sessionConsumedTokens, sessionStartTime } = transcript;
    const elapsedMinutes = sessionStartTime ? (Date.now() - sessionStartTime) / 60_000 : 0;
    if (elapsedMinutes <= 0 || sessionConsumedTokens === 0) {
      return { tokensPerMinute: 0 };
    }

    const tokensPerMinute = sessionConsumedTokens / elapsedMinutes;
    return Number.isFinite(tokensPerMinute) ? { tokensPerMinute } : null;
  },

  render(data: BurnRateData, _ctx: WidgetContext): string {
    return `${ICON.fire} ${formatTokens(Math.round(data.tokensPerMinute))}/min`;
  },
};
