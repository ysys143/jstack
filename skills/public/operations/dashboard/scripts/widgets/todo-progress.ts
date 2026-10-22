/**
 * Todo progress widget - displays current task and completion rate
 * @handbook 3.3-widget-data-sources
 * @tested scripts/__tests__/widgets.test.ts
 */

import type { Widget } from './base.js';
import type { WidgetContext, TodoProgressData } from '../types.js';
import { colorize, getColorForPercent, getTheme } from '../utils/colors.js';
import { getTranscript, extractTodoOrTaskProgress } from '../utils/transcript-parser.js';
import { calculatePercent, truncate } from '../utils/formatters.js';

export const todoProgressWidget: Widget<TodoProgressData> = {
  id: 'todoProgress',
  name: 'Todo Progress',

  async getData(ctx: WidgetContext): Promise<TodoProgressData | null> {
    const transcript = await getTranscript(ctx);
    if (!transcript) return null;

    const progress = extractTodoOrTaskProgress(transcript);

    if (!progress || progress.total === 0) return null;

    return progress;
  },

  render(data: TodoProgressData, ctx: WidgetContext): string {
    const { translations: t } = ctx;
    const theme = getTheme();

    const percent = calculatePercent(data.completed, data.total);
    const color = getColorForPercent(100 - percent); // Invert: lower completion = more red

    // Format: ✓ Task name [3/5] when current task exists, otherwise ✓ 3/5
    if (data.current) {
      const taskName = truncate(data.current.content, 15);
      return `${colorize('✓', theme.safe)} ${taskName} [${data.completed}/${data.total}]`;
    }

    // All done or no current task
    return colorize(
      `${t.widgets.todos}: ${data.completed}/${data.total}`,
      data.completed === data.total ? theme.safe : color
    );
  },
};
