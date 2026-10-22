import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.ts'],
    // The standalone upstream setup/update/README snippets are intentionally not
    // shipped by jstack. Its owning contract exercises the packaged commands and
    // installer instead of these absent upstream documents.
    exclude: ['scripts/__tests__/commands-config-dir.test.ts'],
  },
  define: {
    __VERSION__: JSON.stringify('test'),
  },
});
