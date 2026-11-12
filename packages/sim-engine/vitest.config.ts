import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: [
      // Only rewrite .js → .ts for local relative imports (not node_modules)
      {
        find: /^(?:\.\/|\.\.\/).+\.js$/,
        replacement: (id: string) => id.replace(/\.js$/, '.ts'),
      },
    ],
  },
});
