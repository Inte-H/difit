import { Parser } from 'web-tree-sitter';
import { expect, it, vi } from 'vitest';

it('loads a grammar only after the parser runtime is ready', async () => {
  const init = Parser.init.bind(Parser);
  vi.spyOn(Parser, 'init').mockImplementation(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return init(...args);
  });
  const { classifyChunks } = await import('./change-kind.js');

  const kinds = await classifyChunks('a.ts', 'f(); // old\n', 'f(); // new\n', [
    {
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { type: 'delete', content: 'f(); // old' },
        { type: 'add', content: 'f(); // new' },
      ],
    },
  ]);

  expect(kinds).toEqual(['comment']);
});
