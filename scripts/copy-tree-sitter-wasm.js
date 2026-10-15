#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { basename } from 'path';

import { GRAMMAR_FILES } from '../dist/server/change-kind.js';

const require = createRequire(import.meta.url);
const outDir = new URL('../dist/tree-sitter/', import.meta.url);

mkdirSync(outDir, { recursive: true });
for (const spec of GRAMMAR_FILES) {
  copyFileSync(require.resolve(spec), new URL(basename(spec), outDir));
}
